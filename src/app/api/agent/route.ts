import { convertToModelMessages, streamText, type UIMessage } from 'ai';
import { orchestratorConfig } from '@/agent/orchestrator';
import { preprocessAttachments } from '@/lib/attachments';
import { appendRunEvent, createRun, finishRun } from '@/lib/storage';

export const runtime = 'nodejs'; // 工具用 node:fs，需 nodejs 运行时
export const maxDuration = 600; // best-of-N + revise 多张生图，放宽超时（生产部署需对应平台上限）
const RUN_IMAGE_LIMIT = 16;
const CONTEXT_RECENT_MESSAGES = Number(process.env.RHEMOS_CONTEXT_RECENT_MESSAGES ?? 8);
const OLD_USER_TEXT_LIMIT = Number(process.env.RHEMOS_CONTEXT_OLD_USER_CHARS ?? 1800);
const OLD_ASSISTANT_TEXT_LIMIT = Number(process.env.RHEMOS_CONTEXT_OLD_ASSISTANT_CHARS ?? 700);

// 防 Anthropic/Gateway 400：多轮历史里 tool 调用的入参若不是对象（空参工具回传后常变成 ""/undefined/数组），
// 会触发 "tool_use.input: Input should be a valid dictionary"。强制成 {}，并同时覆盖 input 与 args 两种字段名
// （AI SDK v5→v6 把 args 改名 input 的遗留，序列化时可能读 args），双保险。
function sanitizeToolInputs(messages: Array<{ role?: string; content?: unknown }>): number {
  let fixed = 0;
  for (const m of messages) {
    if (!Array.isArray(m.content)) continue;
    for (const part of m.content as Array<Record<string, unknown>>) {
      if (!part || (part.type !== 'tool-call' && part.type !== 'tool_use' && part.type !== 'dynamic-tool')) continue;
      // 实测 input 常是空字符串 ""（空参工具回传）；也兜底 args（v5 遗留字段名）、null、数组、缺失
      for (const key of ['input', 'args'] as const) {
        const v = part[key];
        if (v !== undefined && (typeof v !== 'object' || v === null || Array.isArray(v))) {
          part[key] = {};
          fixed++;
        }
      }
      if (part.input === undefined && part.args === undefined) {
        part.input = {};
        fixed++;
      }
    }
  }
  return fixed;
}

const validProjectId = (id: unknown): id is string => typeof id === 'string' && /^[\w-]+$/.test(id);

function summarizeOutput(output: unknown): unknown {
  if (!output || typeof output !== 'object') return output;
  const o = output as Record<string, unknown>;
  if (o._kind === 'choices') {
    const questions = Array.isArray(o.questions) ? o.questions : [];
    return { kind: 'choices', questions: questions.length };
  }
  if (o._kind === 'layout') {
    const layout = o.layout as { zones?: unknown[]; length?: unknown; width?: unknown; openings?: unknown } | undefined;
    return {
      kind: 'layout',
      length: layout?.length,
      width: layout?.width,
      openings: layout?.openings,
      zones: Array.isArray(layout?.zones) ? layout.zones.length : 0,
      ruleIssues: Array.isArray(o.ruleIssues) ? o.ruleIssues.length : 0,
    };
  }
  if (Array.isArray(o.assets)) {
    return {
      type: o.type,
      recommendedId: o.recommendedId,
      assets: o.assets.length,
      issues: Array.isArray(o.issues) ? o.issues.length : 0,
    };
  }
  if (o.done) return { done: o.done, delivered: Array.isArray(o.delivered) ? o.delivered.length : 0, gaps: Array.isArray(o.gaps) ? o.gaps.length : 0 };
  if (o.error) return { error: o.error };
  return o;
}

type PartLike = Record<string, unknown>;
const TOOL_SUMMARY_MAX = 900;

function isToolPart(part: unknown): part is PartLike {
  if (!part || typeof part !== 'object') return false;
  const type = (part as { type?: unknown }).type;
  return typeof type === 'string' && type.startsWith('tool-');
}

function shortJson(value: unknown, max = TOOL_SUMMARY_MAX): string {
  let s: string;
  try {
    s = JSON.stringify(value);
  } catch {
    s = String(value);
  }
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

function compactTextPart(part: unknown, limit: number): { part: unknown; compacted: boolean } {
  if (!part || typeof part !== 'object' || (part as { type?: unknown }).type !== 'text') return { part, compacted: false };
  const text = (part as { text?: unknown }).text;
  if (typeof text !== 'string' || text.length <= limit) return { part, compacted: false };
  return {
    part: {
      ...part,
      text: `${text.slice(0, limit)}…\n【旧消息已按上下文预算截断；准确项目事实请调用 read_project_state。】`,
    },
    compacted: true,
  };
}

function compactMessagesForModel(messages: UIMessage[]): { messages: UIMessage[]; compactedTools: number; compactedTexts: number } {
  let compacted = 0;
  let compactedTexts = 0;
  const recentFrom = Math.max(0, messages.length - CONTEXT_RECENT_MESSAGES);
  const next = messages.map((msg, idx) => {
    const parts = (msg as { parts?: unknown[]; role?: string }).parts;
    if (!Array.isArray(parts)) return msg;
    const newParts: unknown[] = [];
    const isRecent = idx >= recentFrom;
    const role = (msg as { role?: string }).role;
    for (const part of parts) {
      if ((part as { type?: unknown })?.type === 'step-start') continue;
      if (role === 'assistant' && isToolPart(part) && part.state === 'output-available') {
        compacted++;
        const toolName = String(part.type).replace(/^tool-/, '');
        newParts.push({
          type: 'text',
          text: `【历史工具 ${toolName} 已执行】输入摘要：${shortJson(summarizeOutput(part.input))}；输出摘要：${shortJson(summarizeOutput(part.output))}。需要准确项目事实请调用 read_project_state。`,
        });
      } else {
        const limit = role === 'user' ? OLD_USER_TEXT_LIMIT : OLD_ASSISTANT_TEXT_LIMIT;
        const c = isRecent ? { part, compacted: false } : compactTextPart(part, limit);
        if (c.compacted) compactedTexts++;
        newParts.push(c.part);
      }
    }
    return { ...msg, parts: newParts } as UIMessage;
  });
  return { messages: next, compactedTools: compacted, compactedTexts };
}

export async function POST(req: Request) {
  const { messages, projectId }: { messages: UIMessage[]; projectId?: string } = await req.json();
  const pid = validProjectId(projectId) ? projectId : 'default';
  const run = await createRun(pid, { imageLimit: RUN_IMAGE_LIMIT });
  const cfg = await orchestratorConfig();
  // docx/xlsx 在服务端提取成文字/图（模型不能直接读它们）；图片/PDF 原样（原生支持）。
  const preprocessed = await preprocessAttachments(messages, pid);
  const compacted = compactMessagesForModel(preprocessed);
  if (compacted.compactedTools || compacted.compactedTexts) console.warn(`[agent] 上下文瘦身：工具输出 ${compacted.compactedTools} 个，旧文本 ${compacted.compactedTexts} 段（UI 历史不变）`);
  const modelMessages = await convertToModelMessages(compacted.messages);
  const fixed = sanitizeToolInputs(modelMessages as never);
  if (fixed) console.warn(`[agent] 修正了 ${fixed} 个非对象 tool 入参 → {}（防 Gateway 400）`);
  const result = streamText({
    ...cfg,
    messages: modelMessages,
    // 把 projectId 注入工具上下文，实现项目隔离（工具用 projectIdFromContext 读取）
    experimental_context: { projectId: pid, runId: run.id },
    experimental_include: { requestBody: false },
    onStepFinish: async (step) => {
      await appendRunEvent(pid, run.id, {
        type: 'step',
        stepNumber: step.stepNumber,
        message: step.finishReason,
        outputSummary: {
          model: step.model.modelId,
          toolCalls: step.toolCalls.map((c) => ({ toolName: c.toolName, input: c.input })),
          toolResults: step.toolResults.map((r) => ({ toolName: r.toolName, output: summarizeOutput(r.output) })),
        },
      });
    },
    onFinish: async (event) => {
      await finishRun(pid, run.id, 'completed', { totalUsage: event.totalUsage });
    },
    onAbort: async () => {
      await finishRun(pid, run.id, 'aborted');
    },
    onError: async ({ error }) => {
      const msg = error instanceof Error ? error.message : String(error);
      console.error('[agent] stream error:', msg);
      await finishRun(pid, run.id, 'failed', { error: msg });
    },
  });
  return result.toUIMessageStreamResponse({ headers: { 'x-rhemos-run-id': run.id } });
}
