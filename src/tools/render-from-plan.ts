import { tool } from 'ai';
import { z } from 'zod';
import { MAX_PARALLEL_IMAGES, MODEL_IDS, withRenderStyle, generateImageFromRefs } from '@/models/gateway';
import { addInspection, loadAssetBytes, projectIdFromContext, readState, saveAsset } from '@/lib/storage';
import type { Deliverable, DeliverableAsset } from '@/lib/types';
import { inspectImage, inspectConsistency, toInspectionResult, consistencyToInspectionResult } from '@/agent/inspect';

const GATE = 70;
const MAX_VIEWS = 4; // 单次视角硬上限（事前预算边界）

export const renderFromPlan = tool({
  description:
    '按用户在布局编辑器定稿的俯视平面图出 3D 效果图：以平面图为**硬参考** + identity，先出严格贴合该布局的正面 3D 主图，再进化链出多视角（每张判一致性、门控）。用户说"已用布局编辑器定稿平面图（参考资产 xxx）"时调用，planAssetId 取那个 reference 资产 id。',
  inputSchema: z.object({
    planAssetId: z.string().describe('用户定稿的俯视平面图 reference 资产 id'),
    views: z
      .array(z.string())
      .max(MAX_VIEWS)
      .default(['a pure straight-on left side view', 'a pure straight-on right side view'])
      .describe('正面主图之外要出的角度（最多 4 个；默认左、右；可加 top-down 等）'),
    quality: z.enum(['low', 'medium', 'high']).default('medium'),
    size: z.enum(['1024x1024', '1536x1024', '1024x1536']).default('1536x1024'),
    n: z.number().int().min(1).max(MAX_PARALLEL_IMAGES).default(2),
  }),
  execute: async ({ planAssetId, views, n }, opts) => {
    const pid = projectIdFromContext((opts as { experimental_context?: unknown }).experimental_context);
    const plan = await loadAssetBytes(pid, planAssetId).catch(() => null);
    if (!plan) return { error: `找不到平面图资产 ${planAssetId}` };
    // 状态自读（D24 契约②）：identity / 判图要点从 project state 取，模型不再搬运。
    const s = await readState(pid);
    const identity = s.spec?.identity ?? '';
    const criteria = s.spec?.selfCheckCriteria ?? '';
    // 预算预检（事前硬边界）：超上限先砍视角数。
    if (views.length > MAX_VIEWS) {
      console.warn(`[render_from_plan] views=${views.length} 超上限，截断至 ${MAX_VIEWS}`);
      views = views.slice(0, MAX_VIEWS);
    }
    console.log(`[render_from_plan] plan=${planAssetId} views=${views.length} n=${n} 预计生图≈${n * (1 + views.length)} 张`);

    // ① 正面主图：以平面图为硬参考出贴合布局的 3D
    const frontInstruction = withRenderStyle(
      `${identity}\n\nThe attached image is a TOP-DOWN FLOOR PLAN of this exhibition booth — each labeled block is a functional zone at its real position and size. Render a photorealistic 3D booth that EXACTLY follows this floor plan: every zone's position, footprint, size and shape must match the plan (including L-shaped counters). Front three-quarter wide-angle view from the main aisle.`,
    );
    const heroCands = (await Promise.all(Array.from({ length: n }, () => generateImageFromRefs([plan], frontInstruction).catch(() => null)))).filter(
      (b): b is Uint8Array => b !== null,
    );
    if (heroCands.length === 0) return { error: '主图生成失败（按平面图）' };
    const heroJudged = await Promise.all(heroCands.map(async (b) => ({ b, insp: await inspectImage(b, criteria) })));
    heroJudged.sort((x, y) => x.insp.fails.length - y.insp.fails.length || y.insp.score - x.insp.score);
    const hero = heroJudged[0];
    const heroAsset = await saveAsset(pid, hero.b, { kind: 'booth-image', prompt: 'plan-conditioned front', parentId: planAssetId });
    await addInspection(pid, heroAsset.id, toInspectionResult(hero.insp, MODEL_IDS.inspect));

    // ② 进化链多视角：以 [平面图 + 主图(+已通过视角)] 为累积参考
    const refPool: Uint8Array[] = [plan, hero.b];
    const results: { view: string; assetId: string; url: string; score: number; status: string }[] = [
      { view: 'front three-quarter', assetId: heroAsset.id, url: heroAsset.url, score: hero.insp.score, status: 'hero' },
    ];
    for (const view of views) {
      const instr = withRenderStyle(
        `${identity}\n\nUsing the attached floor plan + 3D reference of THIS exact booth, render the SAME booth from ${view}. Keep every zone, material, color, brand and layout identical to the references; only the camera viewpoint changes.`,
      );
      const cands = (await Promise.all(Array.from({ length: n }, () => generateImageFromRefs(refPool, instr).catch(() => null)))).filter(
        (b): b is Uint8Array => b !== null,
      );
      if (cands.length === 0) {
        results.push({ view, assetId: '', url: '', score: 0, status: 'failed' as const });
        continue;
      }
      const judged = await Promise.all(cands.map(async (b) => ({ b, c: await inspectConsistency(hero.b, b, view) })));
      judged.sort((x, y) => y.c.consistencyScore - x.c.consistencyScore);
      const best = judged[0];
      const a = await saveAsset(pid, best.b, { kind: 'booth-image', prompt: `${view} (plan+ref)`, parentId: heroAsset.id });
      await addInspection(pid, a.id, consistencyToInspectionResult(best.c, view, GATE, MODEL_IDS.inspect));
      const passed = best.c.sameBooth && best.c.consistencyScore >= GATE;
      if (passed) refPool.push(best.b);
      results.push({ view, assetId: a.id, url: a.url, score: best.c.consistencyScore, status: passed ? ('locked' as const) : ('weak' as const) });
    }
    // 统一交付协议（D24 契约①）：plan-conditioned，hero + 各视角。
    const weak = results.filter((r) => r.status === 'weak' || r.status === 'failed');
    const assets: DeliverableAsset[] = results.map((r, i) =>
      i === 0
        ? { assetId: r.assetId, url: r.url, role: 'hero' as const, status: 'recommended' as const, score: r.score }
        : {
            assetId: r.assetId,
            url: r.url,
            role: 'view' as const,
            view: r.view,
            status: r.status === 'locked' ? ('ok' as const) : r.status === 'failed' ? ('failed' as const) : ('weak' as const),
            score: r.score,
          },
    );
    const deliverable: Deliverable = {
      type: 'plan-conditioned',
      assets,
      recommendedId: heroAsset.id,
      ...(weak.length ? { issues: [`${weak.length} 个视角一致性偏弱(<${GATE})：${weak.map((w) => w.view).join('；')}`] } : {}),
    };
    return deliverable;
  },
});
