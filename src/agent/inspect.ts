import { generateObject } from 'ai';
import { z } from 'zod';
import { inspector } from '@/models/gateway';
import type { InspectionResult } from '@/lib/types';

// 结构化客观判图：score 可比较，便于 best-of-N 排序；fails 触发修复门。
export const inspectionSchema = z.object({
  score: z.number().min(0).max(100).describe('整体结构与物理可信度 0-100'),
  fails: z.array(z.string()).describe('fail 级客观硬伤，每条带图中可观察证据'),
  summary: z.string().describe('一句话客观判语'),
});
export type Inspection = z.infer<typeof inspectionSchema>;

export async function inspectImage(bytes: Uint8Array, criteria: string, modelId?: string): Promise<Inspection> {
  const { object } = await generateObject({
    model: inspector(modelId),
    schema: inspectionSchema,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: `对照要点客观检查这张展台效果图：结构/物理/空间/一致性/品牌乱码。\nscore=整体结构与物理可信度(0-100)；fails=fail 级客观硬伤(每条给图中可观察证据)；summary=一句话。\n只看客观，不评主观口味（口味问题不算 fail）。\n\n要点：\n${criteria}`,
          },
          { type: 'image', image: bytes },
        ],
      },
    ],
  });
  return object;
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
  modelId?: string,
): Promise<ConsistencyCheck> {
  const { object } = await generateObject({
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
  return object;
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

// 多视图 sheet 专用判图：看一张四宫格里"是否同一展台 + 角度是否真的分明"。
export const sheetInspectionSchema = z.object({
  consistencyScore: z.number().min(0).max(100).describe('四格是否同一展台 0-100'),
  sameBoothAcrossPanels: z.boolean().describe('四格是否同一展台'),
  anglesDistinct: z.boolean().describe('四个相机角度是否真的互不相同且正确（前3/4、纯左、纯右、真俯视）'),
  issues: z.array(z.string()).describe('不一致或角度雷同的问题点'),
});
export type SheetInspection = z.infer<typeof sheetInspectionSchema>;

export async function inspectSheet(bytes: Uint8Array, modelId?: string): Promise<SheetInspection> {
  const { object } = await generateObject({
    model: inspector(modelId),
    schema: sheetInspectionSchema,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: '这是一张四宫格 turnaround sheet（前/左/右/俯视平面）。客观判断：consistencyScore=四格是否同一展台 0-100；sameBoothAcrossPanels=是否同一展台；anglesDistinct=四个相机角度是否真的互不相同且正确（前3/4、纯左侧、纯右侧、真俯视正交平面，不能雷同）；issues=不一致或角度雷同的问题。只看客观。',
          },
          { type: 'image', image: bytes },
        ],
      },
    ],
  });
  return object;
}

// —— 沉淀回资产（Asset.inspections）的转换 ——
export function toInspectionResult(insp: Inspection, model: string): InspectionResult {
  return {
    pass: insp.fails.length === 0,
    score: insp.score,
    fails: insp.fails,
    summary: insp.summary,
    model,
    at: new Date().toISOString(),
  };
}

export function sheetToInspectionResult(insp: SheetInspection, model: string): InspectionResult {
  return {
    pass: insp.sameBoothAcrossPanels && insp.anglesDistinct,
    score: insp.consistencyScore,
    fails: insp.issues,
    summary: insp.sameBoothAcrossPanels ? '多视图：同一展台' : '多视图：疑似不一致',
    model,
    at: new Date().toISOString(),
  };
}
