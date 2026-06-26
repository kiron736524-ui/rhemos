import { withRenderStyle } from '@/models/gateway';
import { imageProvider } from '@/models/image-providers';
import { loadAssetBytes, saveCandidateAsset } from '@/lib/storage';
import type { RenderInputRef } from '@/lib/types';
import { batchGenerate, type RenderContext, type RenderError } from './context';

export interface HeroCandidate {
  bytes: Uint8Array;
  assetId: string;
  url: string;
}

export interface CandidatesResult {
  heroCands: HeroCandidate[];
  genMs: number;
}

/**
 * 首稿候选生成（三分支）：
 *  (a) views 深化场景：已有用户选定基准图 → 直接复用作 hero，不重生（genMs=0）；
 *  (b) 平面图条件化：editFromRefs([plan], …)；
 *  (c) 纯文生图：textToImage(…)。
 * 候选只落候选文件、不进正式资产库（用户选中后 promote）。判图/打分已删除（D39）：不评分、不排序。
 * 返回候选数组（首张即推荐项）+ 本批生图墙钟，或 RenderError（execute 早退）。
 */
export async function generateCandidates(ctx: RenderContext): Promise<CandidatesResult | RenderError> {
  const { pid, plan, planId, baseAsset, views, n, quality, size, mode, promptIdentity, layoutLock, frontPrompt, providerName, imageModel, attIds, snapshot, effectivePlanAssetId } = ctx;
  const lockPrefix = layoutLock ? `${layoutLock}\n\n` : '';

  // (a) 深化场景：直接复用用户选定基准图
  if (views.length && baseAsset) {
    const baseBytes = await loadAssetBytes(pid, baseAsset.id).catch(() => null);
    if (!baseBytes) return { error: `找不到用户选定的基准资产 ${baseAsset.id}` };
    return { heroCands: [{ bytes: baseBytes, assetId: baseAsset.id, url: baseAsset.url }], genMs: 0 };
  }

  // (b) 平面图条件化
  if (plan) {
    const instr = withRenderStyle(
      `${promptIdentity}\n\n${lockPrefix}The attached image is a TOP-DOWN FLOOR PLAN of this exhibition booth — each labeled block is a functional zone at its real position and size. Render a photorealistic 3D booth that EXACTLY follows this floor plan (every zone's position, footprint, size and shape must match, including L-shaped counters). The booth OUTER PERIMETER must remain the footprint shape specified in the identity; do not stylize the platform or truss perimeter into a polygon. ${frontPrompt}`,
    );
    const planRef: RenderInputRef = { id: planId, kind: 'plan', role: 'floor_plan', url: `/api/assets/${planId}?project=${pid}` };
    const snap = await snapshot('plan-conditioned', instr, [planRef]);
    const t0 = Date.now();
    const raw = await batchGenerate(n, () => imageProvider.editFromRefs([plan], instr, { quality, size }));
    const genMs = Date.now() - t0;
    if (!raw.length) return { error: '主图生成失败（按平面图）' };
    const heroCands: HeroCandidate[] = [];
    for (const b of raw) {
      const a = await saveCandidateAsset(pid, b, { kind: 'booth-image', prompt: 'plan-conditioned front candidate', parentId: effectivePlanAssetId, provider: providerName, model: imageModel, quality, size, mode, durationMs: genMs, renderInputId: snap.id, sourceAssetIds: planId ? [planId] : [], sourceAttachmentIds: attIds });
      heroCands.push({ bytes: b, assetId: a.id, url: a.url });
    }
    return { heroCands, genMs };
  }

  // (c) 纯文生图
  const full = withRenderStyle(`${promptIdentity}\n\n${lockPrefix}${frontPrompt}`);
  const snap = await snapshot('text-to-image', full, []);
  const t0 = Date.now();
  const raw = await batchGenerate(n, () => imageProvider.textToImage(full, { quality, size }));
  const genMs = Date.now() - t0;
  if (!raw.length) return { error: '主图生成失败（无返回）' };
  const heroCands: HeroCandidate[] = [];
  for (const b of raw) {
    const a = await saveCandidateAsset(pid, b, { kind: 'booth-image', prompt: `${frontPrompt} candidate`, provider: providerName, model: imageModel, quality, size, mode, durationMs: genMs, renderInputId: snap.id, sourceAttachmentIds: attIds });
    heroCands.push({ bytes: b, assetId: a.id, url: a.url });
  }
  return { heroCands, genMs };
}
