import { generateObject } from 'ai';
import { z } from 'zod';
import { inspector } from '@/models/gateway';

// 结构化客观判图：score 可比较，便于 best-of-N 排序；fails 触发修复门。
export const inspectionSchema = z.object({
  score: z.number().min(0).max(100).describe('整体结构与物理可信度 0-100'),
  fails: z.array(z.string()).describe('fail 级客观硬伤，每条带图中可观察证据'),
  summary: z.string().describe('一句话客观判语'),
});
export type Inspection = z.infer<typeof inspectionSchema>;

export async function inspectImage(
  bytes: Uint8Array,
  criteria: string,
  modelId?: string,
): Promise<Inspection> {
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
