import { withRenderStyle } from '@/models/gateway';
import { imageProvider } from '@/models/image-providers';
import { saveAsset } from '@/lib/storage';
import type { DeliverableAsset, RenderInputRef } from '@/lib/types';
import { batchGenerate, type RenderContext } from './context';
import type { HeroCandidate } from './candidates';

export interface ViewsChainResult {
  assets: DeliverableAsset[]; // 仅视角资产（不含 hero）
  issues: string[]; // 失败视角文案
  genMs: number; // 视角阶段总生图墙钟
}

/**
 * 进化式参考链（保留，D39）：串行生成多视角，每张以 [（平面图）+ 基准图 + 已生成视角] 为累积参考池。
 * 判图门控已删除——每张生成的视角都直接进参考池；漂移可能沿链传染，属已知取舍（用户确认接受，后续再优化）。
 */
export async function generateViewsChain(ctx: RenderContext, hero: HeroCandidate): Promise<ViewsChainResult> {
  const { pid, plan, planId, views, n, quality, size, mode, promptIdentity, layoutLock, providerName, imageModel, attIds, snapshot } = ctx;
  const lockPrefix = layoutLock ? `${layoutLock}\n\n` : '';
  const assets: DeliverableAsset[] = [];
  const issues: string[] = [];
  let genMs = 0;
  const refPool: Uint8Array[] = plan ? [plan, hero.bytes] : [hero.bytes];
  const heroRef: RenderInputRef = { id: hero.assetId, kind: 'asset', role: 'previous_render', url: hero.url };
  const refMeta: RenderInputRef[] = plan ? [{ id: planId, kind: 'plan', role: 'floor_plan', url: `/api/assets/${planId}?project=${pid}` }, heroRef] : [heroRef];

  const viewInstruction = (view: string) =>
    withRenderStyle(
      `${promptIdentity}\n\n${lockPrefix}Using the attached reference image(s) of THIS exact exhibition booth, render the SAME booth from ${view}. The references are geometry and identity locks, not loose inspiration. Keep every structural part, material, color, brand placement, furniture COUNT, the exact outer footprint boundary stated above, raised platform/carpet rectangle, truss perimeter, wall line, and lighting identical to the reference(s); only the camera viewpoint changes. Do NOT add, remove, move, darken, clutter, or redesign anything.`,
    );

  for (const view of views) {
    const instr = viewInstruction(view);
    const snap = await snapshot('view-generation', instr, refMeta.slice(), view);
    const t0 = Date.now();
    const cands = await batchGenerate(n, () => imageProvider.editFromRefs(refPool, instr, { quality, size }));
    const batchMs = Date.now() - t0;
    genMs += batchMs;
    if (!cands.length) {
      assets.push({ assetId: '', url: '', role: 'view', view, status: 'failed' });
      issues.push(`${view}：生成失败`);
      continue;
    }
    const b = cands[0];
    const a = await saveAsset(pid, b, { kind: 'booth-image', prompt: `${view} (evolution chain)`, parentId: hero.assetId, provider: providerName, model: imageModel, quality, size, mode, durationMs: batchMs, renderInputId: snap.id, sourceAssetIds: refMeta.map((r) => r.id).filter(Boolean), sourceAttachmentIds: attIds });
    // 累积参考链：当前视角进 refPool/refMeta，后续视角以它为参考（无门控）。
    refPool.push(b);
    refMeta.push({ id: a.id, kind: 'asset', role: 'previous_render', url: a.url });
    assets.push({ assetId: a.id, url: a.url, role: 'view', view, status: 'ok' });
  }
  return { assets, issues, genMs };
}
