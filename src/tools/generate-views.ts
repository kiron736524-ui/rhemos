import { tool } from 'ai';
import { z } from 'zod';
import { MAX_PARALLEL_IMAGES, MODEL_IDS, openaiViaGateway, withRenderStyle, generateImageFromRefs } from '@/models/gateway';
import { addInspection, projectIdFromContext, readState, saveAsset } from '@/lib/storage';
import type { Deliverable, DeliverableAsset } from '@/lib/types';
import { inspectImage, inspectConsistency, toInspectionResult, consistencyToInspectionResult } from '@/agent/inspect';

// 进化链门控阈值：低于此的视角不进参考池（实测：把漂移图当参考会传染漂移 → chain 82 < baseline 88）。
const CONSISTENCY_GATE = 70;
// 单次调用视角硬上限（事前预算边界）：主图 + 每视角 n 张，配合 imageBudget 防单工具内部跑飞。
const MAX_VIEWS = 4;

interface ViewResult {
  view: string;
  assetId: string;
  url: string;
  consistencyScore: number;
  status: 'hero' | 'locked' | 'weak' | 'failed';
}

export const generateViews = tool({
  description:
    '进化式多视角（一致性主力，替代分图独立生成 / sheet 交付）：① 先出正面主图（gpt-image-2 best-of-N + 画风锚 + identity，判图择优）；② 以「主图 + 已通过视角」为累积参考 + identity，逐个用参考条件化生成其他角度的**单视角全幅图**，每张判一致性、**过关才进参考池**（防漂移传染）。每个角度都是全分辨率，可单独 revise。用户要"多视角/各角度/交付全套视角"时用这个；render_multiview_sheet 只用于快速对齐探索、不做最终交付。',
  inputSchema: z.object({
    frontPrompt: z.string().describe('正面主视角的完整英文五层 prompt'),
    views: z
      .array(z.string())
      .min(1)
      .max(MAX_VIEWS)
      .describe('其他角度英文描述（最多 4 个），如 ["a pure straight-on left side view","a pure straight-on right side view","a top-down orthographic floor plan view"]'),
    quality: z.enum(['low', 'medium', 'high']).default('medium'),
    size: z.enum(['1024x1024', '1536x1024', '1024x1536']).default('1024x1024'),
    n: z.number().int().min(1).max(MAX_PARALLEL_IMAGES).default(2).describe('每个视角 best-of-N 候选数（对抗采样方差，实测单次方差很大）'),
  }),
  execute: async ({ frontPrompt, views, quality, size, n }, opts) => {
    const pid = projectIdFromContext((opts as { experimental_context?: unknown }).experimental_context);
    // 状态自读（D24 契约②）：identity / 判图要点从 project state 取，模型不再搬运（避免抄错/抄漏）。
    const s = await readState(pid);
    const identity = s.spec?.identity ?? '';
    const criteria = s.spec?.selfCheckCriteria ?? '';
    const client = openaiViaGateway();
    // 预算预检（事前硬边界，补 imageBudget 的事后统计）：超上限先砍视角数再生图。
    if (views.length > MAX_VIEWS) {
      console.warn(`[generate_views] views=${views.length} 超上限，截断至 ${MAX_VIEWS}`);
      views = views.slice(0, MAX_VIEWS);
    }
    console.log(`[generate_views] views=${views.length} n=${n} quality=${quality} size=${size} 预计生图≈${n * (1 + views.length)} 张`);

    // ① 正面主图：gpt-image-2 文生图 best-of-N + 画风锚 + identity，判图择优
    const frontFull = withRenderStyle(`${identity}\n\n${frontPrompt}`);
    const frontBatch = await Promise.all(
      Array.from({ length: n }, async () => {
        const r = await client.images.generate({ model: MODEL_IDS.image, prompt: frontFull, size, quality, n: 1 });
        const b = r.data?.[0]?.b64_json ?? '';
        return b ? new Uint8Array(Buffer.from(b, 'base64')) : null;
      }),
    );
    const frontCands: { bytes: Uint8Array; assetId: string; url: string; score: number; failN: number }[] = [];
    for (const bytes of frontBatch) {
      if (!bytes) continue;
      const a = await saveAsset(pid, bytes, { kind: 'booth-image', prompt: frontPrompt });
      const insp = await inspectImage(bytes, criteria);
      await addInspection(pid, a.id, toInspectionResult(insp, MODEL_IDS.inspect));
      frontCands.push({ bytes, assetId: a.id, url: a.url, score: insp.score, failN: insp.fails.length });
    }
    if (frontCands.length === 0) return { error: '正面主图生成失败（无返回）' };
    frontCands.sort((x, y) => x.failN - y.failN || y.score - x.score);
    const hero = frontCands[0];

    // ② 进化链：累积参考 [主图 + 已通过视角] + identity，逐角度参考条件化生成，判一致性门控
    const refPool: Uint8Array[] = [hero.bytes];
    const results: ViewResult[] = [
      { view: 'front three-quarter', assetId: hero.assetId, url: hero.url, consistencyScore: 100, status: 'hero' },
    ];

    for (const view of views) {
      const instruction = withRenderStyle(
        `${identity}\n\nUsing the attached reference image(s) of THIS exact exhibition booth, render the SAME booth from ${view}. Keep every structural part, material, color, brand placement, furniture COUNT and lighting identical to the reference(s); only the camera viewpoint changes — do NOT add, remove, move or redesign anything.`,
      );
      // best-of-N 参考条件化（并行）
      const cands = (
        await Promise.all(Array.from({ length: n }, () => generateImageFromRefs(refPool, instruction).catch(() => null)))
      ).filter((b): b is Uint8Array => b !== null);
      if (cands.length === 0) {
        results.push({ view, assetId: '', url: '', consistencyScore: 0, status: 'failed' });
        continue;
      }
      // 判一致性（以主图为 ground truth），选最一致
      const judged = await Promise.all(cands.map(async (bytes) => ({ bytes, check: await inspectConsistency(hero.bytes, bytes, view) })));
      judged.sort((a, b) => b.check.consistencyScore - a.check.consistencyScore);
      const best = judged[0];
      const asset = await saveAsset(pid, best.bytes, { kind: 'booth-image', prompt: `${view} (ref-conditioned)`, parentId: hero.assetId });
      await addInspection(pid, asset.id, consistencyToInspectionResult(best.check, view, CONSISTENCY_GATE, MODEL_IDS.inspect));
      const passed = best.check.sameBooth && best.check.consistencyScore >= CONSISTENCY_GATE;
      if (passed) refPool.push(best.bytes); // 门控：只有通过的才进参考池，防漂移传染
      results.push({ view, assetId: asset.id, url: asset.url, consistencyScore: best.check.consistencyScore, status: passed ? 'locked' : 'weak' });
    }

    const weak = results.filter((r) => r.status === 'weak' || r.status === 'failed');
    // 统一交付协议（D24 契约①）：hero + 各视角，弱/失败视角进 issues。
    const assets: DeliverableAsset[] = results.map((r, i) =>
      i === 0
        ? { assetId: r.assetId, url: r.url, role: 'hero' as const, status: 'recommended' as const, score: r.consistencyScore }
        : {
            assetId: r.assetId,
            url: r.url,
            role: 'view' as const,
            view: r.view,
            status: r.status === 'locked' ? ('ok' as const) : r.status === 'failed' ? ('failed' as const) : ('weak' as const),
            score: r.consistencyScore,
          },
    );
    const deliverable: Deliverable = {
      type: 'view-set',
      assets,
      recommendedId: hero.assetId,
      ...(weak.length
        ? { issues: [`${weak.length} 个视角一致性偏弱(<${CONSISTENCY_GATE})：${weak.map((w) => w.view).join('；')}，可对它们 revise 或重出`] }
        : {}),
    };
    return deliverable;
  },
});
