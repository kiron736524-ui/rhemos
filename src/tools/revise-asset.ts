import { tool } from 'ai';
import { z } from 'zod';
import { MODEL_IDS, withRenderStyle, generateImageFromRefs } from '@/models/gateway';
import { addInspection, loadAssetBytes, projectIdFromContext, saveAsset } from '@/lib/storage';
import { inspectImage, toInspectionResult } from '@/agent/inspect';

export const reviseAsset = tool({
  description:
    '参考图局部编辑（保持其余 100% 不变，只改一处客观硬伤）：加载原图作参考，用图像编辑模型只改你指定的局部、其余与原图保持一致。比"重写 prompt 从头重生"一致性高得多——在单视角全幅图上精修单点问题用这个。返回新资产（lineage 指向 parentAssetId）+ 复检。',
  inputSchema: z.object({
    parentAssetId: z.string().describe('被修的原资产 id'),
    fix: z
      .string()
      .describe(
        '要修正的具体局部（英文，只描述"改什么"，例如 "the negotiation area must have EXACTLY one round table with 4 white armchairs — remove the extra chairs and the second table"）',
      ),
    criteria: z.string().describe('客观判图要点（复检用）'),
  }),
  execute: async ({ parentAssetId, fix, criteria }, opts) => {
    const pid = projectIdFromContext((opts as { experimental_context?: unknown }).experimental_context);
    const parentBytes = await loadAssetBytes(pid, parentAssetId).catch(() => null);
    if (!parentBytes) return { error: `找不到原资产 ${parentAssetId}` };
    const instruction = withRenderStyle(
      `Using the attached image as the exact reference, keep EVERYTHING identical — overall structure, layout, all other parts, materials, colors, brand placement, lighting and the camera angle — and change ONLY this: ${fix}. Do not alter, move or redesign anything else; the result must look like the same booth photo with just that one local fix applied.`,
    );
    const bytes = await generateImageFromRefs([parentBytes], instruction);
    if (!bytes) return { error: '局部修复未返回图（编辑模型无输出）' };
    const asset = await saveAsset(pid, bytes, { kind: 'booth-image', prompt: `revise: ${fix}`, parentId: parentAssetId });
    const insp = await inspectImage(bytes, criteria);
    await addInspection(pid, asset.id, toInspectionResult(insp, MODEL_IDS.inspect));
    return { assetId: asset.id, url: asset.url, score: insp.score, fails: insp.fails, summary: insp.summary };
  },
});
