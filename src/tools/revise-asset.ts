import { tool } from 'ai';
import { z } from 'zod';
import { MODEL_IDS, openaiViaGateway } from '@/models/gateway';
import { addInspection, projectIdFromContext, saveAsset } from '@/lib/storage';
import { inspectImage, toInspectionResult } from '@/agent/inspect';

export const reviseAsset = tool({
  description:
    '窄回退修复（每资产最多 1 次）：仅对择优后仍存的**客观硬伤**做定向修正。你写一份"已修正的完整英文 prompt"（从对的部分采样、只改硬伤），重生一张并复检。返回新资产（lineage 指向 parentAssetId）+ 复检结果。',
  inputSchema: z.object({
    parentAssetId: z.string().describe('被修复的原资产 id'),
    correctedPrompt: z.string().describe('修正后的完整英文 prompt（保留对的、改掉客观硬伤）'),
    criteria: z.string().describe('客观判图要点'),
    quality: z.enum(['low', 'medium', 'high']).default('high'),
    size: z.enum(['1024x1024', '1536x1024', '1024x1536']).default('1024x1024'),
  }),
  execute: async ({ parentAssetId, correctedPrompt, criteria, quality, size }, opts) => {
    const pid = projectIdFromContext((opts as { experimental_context?: unknown }).experimental_context);
    const client = openaiViaGateway();
    const r = await client.images.generate({ model: MODEL_IDS.image, prompt: correctedPrompt, size, quality, n: 1 });
    const b64 = r.data?.[0]?.b64_json ?? '';
    if (!b64) return { error: '修复生图未返回数据' };
    const bytes = new Uint8Array(Buffer.from(b64, 'base64'));
    const asset = await saveAsset(pid, bytes, { kind: 'booth-image', prompt: correctedPrompt, parentId: parentAssetId });
    const insp = await inspectImage(bytes, criteria);
    await addInspection(pid, asset.id, toInspectionResult(insp, MODEL_IDS.inspect));
    return { assetId: asset.id, url: asset.url, score: insp.score, fails: insp.fails, summary: insp.summary };
  },
});
