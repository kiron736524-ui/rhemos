import { tool } from 'ai';
import { z } from 'zod';
import { MAX_PARALLEL_IMAGES, MODEL_IDS, openaiViaGateway } from '@/models/gateway';
import { DEFAULT_PROJECT, loadAssetBytes, saveAsset } from '@/lib/storage';
import { inspectSheet } from '@/agent/inspect';

// sheet 结构在代码里标准化（规范化）：大脑只给 booth 内容，四宫格 + 强制角度分明 + 平面图由模板保证。
const sheetPrompt = (booth: string) => `A single turnaround sheet image, 2x2 grid of four clearly-labeled panels, ALL showing the SAME ONE exhibition booth — identical structure, materials, colors, brand placement and lighting across every panel:
- top-left: FRONT three-quarter wide-angle view
- top-right: pure LEFT side view (camera fully to the left, clearly different from the front)
- bottom-left: pure RIGHT side view (camera fully to the right)
- bottom-right: TOP-DOWN orthographic floor plan (true bird's-eye layout)
Each panel must be a DISTINCTLY different camera — do not repeat the same angle. Clean panel labels, neutral background, photorealistic.

The booth:
${booth}`;

export const renderMultiviewSheet = tool({
  description:
    '多视角全貌：一次生成**一张** 2x2 turnaround sheet（前/左/右/俯视平面，同一展台），并行 N≤2 张、择最一致那张交付。一致性来自"一次渲染"——**不要拆成多张独立图**。booth 用英文描述（取自 DesignSpec）。延迟：默认 high/1536 较慢（best-of-N=2 并行约 ~280-400s，在超时内）。',
  inputSchema: z.object({
    booth: z.string().describe('展台英文描述：结构/材质/颜色/品牌占位/灯光（取自 DesignSpec）'),
    n: z
      .number()
      .int()
      .min(1)
      .max(MAX_PARALLEL_IMAGES)
      .default(2)
      .describe('并行候选 sheet 数，择最一致/角度最分明'),
    quality: z.enum(['low', 'medium', 'high']).default('high'),
    size: z
      .enum(['1024x1024', '1536x1024', '1024x1536'])
      .default('1536x1024')
      .describe('sheet 默认 1536x1024（四格需要像素）'),
  }),
  execute: async ({ booth, n, quality, size }) => {
    const client = openaiViaGateway();
    const prompt = sheetPrompt(booth);
    // 并行生成 N 张候选 sheet（慢，横向）
    const batches = await Promise.all(
      Array.from({ length: n }, async () => {
        const r = await client.images.generate({ model: MODEL_IDS.image, prompt, size, quality, n: 1 });
        const b64 = r.data?.[0]?.b64_json ?? '';
        return b64 ? new Uint8Array(Buffer.from(b64, 'base64')) : null;
      }),
    );
    // 顺序保存（避免竞写 state.json）
    const assets = [];
    for (const bytes of batches) {
      if (bytes) assets.push(await saveAsset(DEFAULT_PROJECT, bytes, { kind: 'multiview', prompt }));
    }
    if (assets.length === 0) return { error: 'sheet 生成均未返回数据' };
    // 并行判 sheet（同一展台 + 角度分明）
    const sheets = await Promise.all(
      assets.map(async (a) => {
        const bytes = await loadAssetBytes(DEFAULT_PROJECT, a.id);
        const insp = await inspectSheet(bytes);
        return { assetId: a.id, url: a.url, ...insp };
      }),
    );
    // 排序：角度分明优先 → 同一展台 → 一致性分
    const ranked = [...sheets].sort(
      (x, y) =>
        Number(y.anglesDistinct) - Number(x.anglesDistinct) ||
        Number(y.sameBoothAcrossPanels) - Number(x.sameBoothAcrossPanels) ||
        y.consistencyScore - x.consistencyScore,
    );
    const best = ranked[0];
    return {
      sheets: ranked,
      recommended: { assetId: best.assetId, url: best.url, consistencyScore: best.consistencyScore },
    };
  },
});
