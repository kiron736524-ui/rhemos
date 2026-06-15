import { convertToModelMessages, streamText, type UIMessage } from 'ai';
import { orchestratorConfig } from '@/agent/orchestrator';
import { preprocessAttachments } from '@/lib/attachments';

export const runtime = 'nodejs'; // 工具用 node:fs，需 nodejs 运行时
export const maxDuration = 600; // best-of-N + revise 多张生图，放宽超时（生产部署需对应平台上限）

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

export async function POST(req: Request) {
  const { messages, projectId }: { messages: UIMessage[]; projectId?: string } = await req.json();
  const cfg = await orchestratorConfig();
  // docx/xlsx 在服务端提取成文字/图（模型不能直接读它们）；图片/PDF 原样（原生支持）。
  const modelMessages = await convertToModelMessages(await preprocessAttachments(messages));
  const fixed = sanitizeToolInputs(modelMessages as never);
  if (fixed) console.warn(`[agent] 修正了 ${fixed} 个非对象 tool 入参 → {}（防 Gateway 400）`);
  const result = streamText({
    ...cfg,
    messages: modelMessages,
    // 把 projectId 注入工具上下文，实现项目隔离（工具用 projectIdFromContext 读取）
    experimental_context: { projectId: projectId ?? 'default' },
    onError: ({ error }) => console.error('[agent] stream error:', error instanceof Error ? error.message : error),
  });
  return result.toUIMessageStreamResponse();
}
