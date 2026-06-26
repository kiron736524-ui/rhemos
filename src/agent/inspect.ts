import { generateObject } from 'ai';
import { z } from 'zod';
import { MODEL_IDS } from '@/models/gateway';
import { inspector } from '@/models/gateway';
import { appendRunEvent } from '@/lib/storage';
import type { InspectionResult } from '@/lib/types';

type TraceContext = { projectId?: string; runId?: string | null; purpose?: string };

function parseModelTrace(modelOrTrace?: string | TraceContext, trace?: TraceContext): { modelId?: string; trace?: TraceContext } {
  return typeof modelOrTrace === 'string' ? { modelId: modelOrTrace, trace } : { trace: modelOrTrace };
}

// 单维度判图：pass + 可选分 + issues。供分维度统计（结构/动线/品牌/材质灯光）。
const dimensionSchema = z.object({
  pass: z.boolean(),
  score: z.number().min(0).max(100).optional(),
  issues: z.array(z.string()).default([]),
});

// 结构化客观判图：score 可比较，便于 best-of-N 排序；fails 触发修复门。
// dimensions 可选（新增）：分维度结果，更可统计；旧字段 score/fails/summary 保留，render 无需大改。
export const inspectionSchema = z.object({
  score: z.number().min(0).max(100).describe('整体结构与物理可信度 0-100'),
  fails: z.array(z.string()).describe('fail 级客观硬伤，每条带图中可观察证据'),
  summary: z.string().describe('一句话客观判语'),
  dimensions: z
    .object({
      structure: dimensionSchema,
      circulation: dimensionSchema,
      brand: dimensionSchema,
      materialLighting: dimensionSchema,
    })
    .optional()
    .describe('分维度判图：structure 结构物理 / circulation 动线功能 / brand 品牌 / materialLighting 材质灯光'),
});
export type Inspection = z.infer<typeof inspectionSchema>;

export async function inspectImage(bytes: Uint8Array, criteria: string, modelOrTrace?: string | TraceContext, traceArg?: TraceContext): Promise<Inspection> {
  const { modelId, trace } = parseModelTrace(modelOrTrace, traceArg);
  const result = await generateObject({
    model: inspector(modelId),
    schema: inspectionSchema,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: `对照要点客观检查这张展台效果图。\nscore=整体结构与物理可信度(0-100)；fails=fail 级客观硬伤(每条给图中可观察证据)；summary=一句话。\n再按四维度各给 {pass, score(0-100), issues[]}：\n- structure：悬浮结构/支撑/跨度/屏幕承重/比例。\n- circulation：开口/入口/接待/动线/功能区拥堵。\n- brand：品牌位置/占位/文字乱码/主视觉方向。\n- materialLighting：材质真实/灯光来源/色温/渲染纯净度。\n只看客观，不评主观口味（口味问题不算 fail）。\n\n要点：\n${criteria}`,
          },
          { type: 'image', image: bytes },
        ],
      },
    ],
  });
  if (trace?.projectId) {
    await appendRunEvent(trace.projectId, trace.runId ?? null, {
      type: 'tool',
      toolName: 'inspect_image',
      outputSummary: {
        model: modelId ?? MODEL_IDS.inspect,
        purpose: trace.purpose,
        criteriaChars: criteria.length,
        usage: (result as { totalUsage?: unknown; usage?: unknown }).totalUsage ?? (result as { usage?: unknown }).usage,
      },
    });
  }
  return result.object;
}

// 参考图 vs 候选图一致性判图（进化链门控用）：判"换角度后是否还是同一个展台"。
export const consistencySchema = z.object({
  consistencyScore: z.number().min(0).max(100).describe('候选图与参考图是同一个展台的程度 0-100（结构/部件/材质/颜色/品牌/布局）'),
  sameBooth: z.boolean().describe('是否同一展台'),
  angleChanged: z.boolean().describe('视角是否真的变化（不是复制参考）'),
  drift: z.array(z.string()).describe('漂移 / 不一致的部件（每条具体）'),
});
export type ConsistencyCheck = z.infer<typeof consistencySchema>;

export async function inspectConsistency(
  refBytes: Uint8Array,
  candidateBytes: Uint8Array,
  viewDesc: string,
  modelOrTrace?: string | TraceContext,
  traceArg?: TraceContext,
): Promise<ConsistencyCheck> {
  const { modelId, trace } = parseModelTrace(modelOrTrace, traceArg);
  const result = await generateObject({
    model: inspector(modelId),
    schema: consistencySchema,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: `第1张是已确认的展台参考图，第2张应是同一展台的「${viewDesc}」。客观判断：consistencyScore=两张是同一个展台的程度(结构/部件含数量/材质/颜色/品牌/布局) 0-100；sameBooth；angleChanged=视角是否真的变了；drift=漂移或不一致的部件。只看客观。`,
          },
          { type: 'image', image: refBytes },
          { type: 'image', image: candidateBytes },
        ],
      },
    ],
  });
  if (trace?.projectId) {
    await appendRunEvent(trace.projectId, trace.runId ?? null, {
      type: 'tool',
      toolName: 'inspect_consistency',
      outputSummary: {
        model: modelId ?? MODEL_IDS.inspect,
        purpose: trace.purpose,
        view: viewDesc,
        usage: (result as { totalUsage?: unknown; usage?: unknown }).totalUsage ?? (result as { usage?: unknown }).usage,
      },
    });
  }
  return result.object;
}

export function consistencyToInspectionResult(c: ConsistencyCheck, view: string, gate: number, model: string): InspectionResult {
  return {
    pass: c.sameBooth && c.consistencyScore >= gate,
    score: c.consistencyScore,
    fails: c.drift,
    summary: c.consistencyScore >= gate && c.sameBooth ? `一致视角：${view}` : `疑似漂移：${view}`,
    model,
    at: new Date().toISOString(),
  };
}

// —— 沉淀回资产（Asset.inspections）的转换 ——
export function toInspectionResult(insp: Inspection, model: string): InspectionResult {
  return {
    pass: insp.fails.length === 0,
    score: insp.score,
    fails: insp.fails,
    summary: insp.summary,
    ...(insp.dimensions ? { dimensions: insp.dimensions } : {}),
    model,
    at: new Date().toISOString(),
  };
}
