import { tool } from 'ai';
import { z } from 'zod';
import { MAX_PARALLEL_IMAGES, MODEL_IDS, openaiViaGateway } from '@/models/gateway';
import { DEFAULT_PROJECT, loadAssetBytes, saveAsset } from '@/lib/storage';
import { inspectImage } from '@/agent/inspect';

export const generateBestOfN = tool({
  description:
    '生图主力（横向 best-of-N）：用 gpt-image-2 并行生成 N 张候选（N≤2），并行客观判图，返回所有候选 + 推荐（最佳）。墙钟≈单张。拿到推荐图后你决定：直接交付 / 对它 revise / 重来。延迟：quality low~8s / medium~30s / high~200s——概念用 medium，最终交付/精密结构用 high。',
  inputSchema: z.object({
    prompt: z.string().describe('英文五层架构 prompt（品牌占位）'),
    n: z
      .number()
      .int()
      .min(1)
      .max(MAX_PARALLEL_IMAGES)
      .default(1)
      .describe(`并行候选数（≤${MAX_PARALLEL_IMAGES}）：概念用 1，要择优用 2`),
    quality: z.enum(['low', 'medium', 'high']).default('high'),
    size: z.enum(['1024x1024', '1536x1024', '1024x1536']).default('1024x1024'),
    criteria: z.string().describe('客观判图要点（来自 DesignSpec.selfCheckCriteria / 意图）'),
  }),
  execute: async ({ prompt, n, quality, size, criteria }) => {
    const client = openaiViaGateway();
    // 1) 并行生成 N 张（慢，横向）
    const batches = await Promise.all(
      Array.from({ length: n }, async () => {
        const r = await client.images.generate({ model: MODEL_IDS.image, prompt, size, quality, n: 1 });
        const b64 = r.data?.[0]?.b64_json ?? '';
        return b64 ? new Uint8Array(Buffer.from(b64, 'base64')) : null;
      }),
    );
    // 2) 顺序保存（快；避免并行竞写 state.json）
    const assets = [];
    for (const bytes of batches) {
      if (bytes) assets.push(await saveAsset(DEFAULT_PROJECT, bytes, { kind: 'booth-image', prompt }));
    }
    if (assets.length === 0) return { error: '所有候选生图均未返回数据' };
    // 3) 并行判图（只读，无竞写）
    const candidates = await Promise.all(
      assets.map(async (a) => {
        const bytes = await loadAssetBytes(DEFAULT_PROJECT, a.id);
        const insp = await inspectImage(bytes, criteria);
        return { assetId: a.id, url: a.url, score: insp.score, fails: insp.fails, summary: insp.summary };
      }),
    );
    // 4) 排序：fails 少优先，再 score 高优先
    const ranked = [...candidates].sort((x, y) => x.fails.length - y.fails.length || y.score - x.score);
    const best = ranked[0];
    return {
      candidates: ranked,
      recommended: { assetId: best.assetId, url: best.url, score: best.score, fails: best.fails },
    };
  },
});
