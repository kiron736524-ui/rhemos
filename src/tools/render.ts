import { tool } from 'ai';
import { z } from 'zod';
import { MAX_PARALLEL_IMAGES, MODEL_IDS, withRenderStyle } from '@/models/gateway';
import { imageProvider, resolveActiveImageProvider } from '@/models/image-providers';
import { checkBoothLayout, failMessages, hasBlocker, type BoothRuleIssue } from '@/lib/booth-rules';
import { addInspection, appendRunEvent, loadAssetBytes, markLayoutConfirmed, projectIdFromContext, readState, recordRunDeliverable, runIdFromContext, saveAsset, saveRenderInputSnapshot } from '@/lib/storage';
import { selectUsableAttachmentsFromAnalyses, toRenderInputRefs } from '@/lib/asset-analysis';
import { inspectImage, inspectConsistency, toInspectionResult, consistencyToInspectionResult } from '@/agent/inspect';
import { writeImagePrompt } from '@/agent/prompt-writer';
import type { Deliverable, DeliverableAsset, RenderInputOperation, RenderInputRef } from '@/lib/types';

const GATE = 70; // 进化链一致性门控（漂移图不进参考池）
const MAX_VIEWS = 4; // 单次视角硬上限（事前预算边界）
const MAX_IMAGES_PER_RENDER = 10; // 单工具内部硬预算：挡住 stopWhen 之前的跑飞

// 唯一生图入口（合并 best-of-N / 多视角进化链 / 平面图条件化）。大脑只给中文意图，
// prompt-writer 子 agent 写英文 prompt；identity / 判图要点自读 spec；出口统一 Deliverable。
export const render = tool({
  description:
    '出展台效果图（**唯一生图入口**）。你只给**中文意图**（要出什么、视觉重点、风格倾向），不用写英文 prompt——内部 prompt 专家会写。三种模式自动识别：① 只给 intent → 单张正面主图（best-of-N 择优）；② 给 views → 多视角全套（进化式参考链 + 判图门控，每角度单视角全幅，可单独 revise）；③ 给 planAssetId（用户在布局编辑器定稿平面图后，消息含"参考资产 xxx"）→ 按该平面图为硬参考出严格贴合布局的 3D + 多视角。identity 与判图要点自动读 spec。返回统一交付物。',
  inputSchema: z.object({
    intent: z
      .string()
      .describe('中文意图：要出什么图、视觉重点、风格倾向（如"正面主视角，突出中央 LED 大屏与产品体验区，科技蓝冷调"）。**不要写英文 prompt**。'),
    views: z
      .array(z.string())
      .max(MAX_VIEWS)
      .default([])
      .describe('要的额外角度（英文，如 ["a pure straight-on left side view","a top-down orthographic floor plan view"]）；留空=只出正面主图。最多 4 个'),
    planAssetId: z.string().optional().describe('用户在布局编辑器定稿的俯视平面图 reference 资产 id（有=按平面图硬参考出图）'),
    mode: z
      .enum(['concept', 'final'])
      .default('final')
      .describe('concept=早期方向探索（默认 medium/n=1，快，可无 spec）；final=最终交付（默认 high/n=2，质量优先、慢，必须已有 spec.identity 且布局已确认或明确跳过）'),
    quality: z.enum(['low', 'medium', 'high']).optional().describe('画质；留空=按 mode 取默认（concept→medium，final→high）。用户明确要"快看方向/草图"才显式压到 medium/low'),
    size: z.enum(['1024x1024', '1536x1024', '1024x1536']).default('1024x1024'),
    n: z.number().int().min(1).max(MAX_PARALLEL_IMAGES).optional().describe('每张图 best-of-N 候选数；留空=按 mode 取默认（concept→1，final→2）。实测单次方差大，final 用 2 择优'),
  }),
  execute: async ({ intent, views, planAssetId, mode, quality, size, n }, opts) => {
    const ctx = (opts as { experimental_context?: unknown }).experimental_context;
    const pid = projectIdFromContext(ctx);
    const runId = runIdFromContext(ctx);
    const s = await readState(pid);
    const identity = s.spec?.identity ?? '';
    const criteria = s.spec?.selfCheckCriteria || intent; // 没 spec 时用 intent 兜底判图要点
    // 快慢双模式：concept 默认 medium/n=1（快草案），final 默认 high/n=2（质量优先）。
    // schema 不设 quality/n 默认，默认在此按 mode 解析——显式传入则尊重，避免 Zod default 与系统提示打架。
    const q: 'low' | 'medium' | 'high' = quality ?? (mode === 'concept' ? 'medium' : 'high');
    const nn = n ?? (mode === 'concept' ? 1 : 2);
    // 解析激活的图像 provider（IMAGE_PROVIDER，默认 fal）；未知/未实现在此返回清晰错误（早于生图的 .catch 包裹）。
    let providerName: string, imageModel: string;
    try {
      const p = resolveActiveImageProvider();
      providerName = p.name;
      imageModel = p.model;
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e), code: 'IMAGE_PROVIDER_INVALID' };
    }
    let totalGenMs = 0; // 累计各批次生图墙钟，记入 run 事件
    if (views.length > MAX_VIEWS) views = views.slice(0, MAX_VIEWS);
    const requestedImages = nn * (1 + views.length);
    if (requestedImages > MAX_IMAGES_PER_RENDER) {
      return { error: `本次 render 预计 ${requestedImages} 张，超过单工具上限 ${MAX_IMAGES_PER_RENDER} 张；请减少 views 或 n。`, code: 'RENDER_BUDGET_EXCEEDED' };
    }

    const effectivePlanAssetId = planAssetId ?? (s.layout?.status === 'confirmed' ? s.layout.planAssetId : undefined);
    if (mode === 'final') {
      if (!identity.trim()) {
        return { error: '最终出图前必须先 update_spec 写入 identity；如果只是方向草图，请用 mode=concept。', code: 'FINAL_RENDER_REQUIRES_SPEC' };
      }
      if (!effectivePlanAssetId) {
        if (!s.layout) return { error: '最终出图前必须先调用 present_layout，让用户确认布局或明确跳过。', code: 'FINAL_RENDER_REQUIRES_LAYOUT_DECISION' };
        if (s.layout.status === 'pending') return { error: '布局仍待用户确认：请等待用户在布局编辑器确认，或让用户点击“按原方案直接出图”。', code: 'LAYOUT_PENDING' };
        if (s.layout.status !== 'skipped') return { error: '布局状态不完整：请重新 present_layout，或让用户明确跳过布局精调。', code: 'LAYOUT_DECISION_REQUIRED' };
      }
    }

    // 展台规则校验（final）：有布局 proposal 就跑一次纯函数规则。blocker 打回让大脑修布局；
    // blocker/fail 级消息并入交付 issues（warning 不进，避免噪音）。
    const ruleMsgs: string[] = [];
    let ruleIssues: BoothRuleIssue[] = [];
    if (mode === 'final' && s.layout?.proposal) {
      ruleIssues = checkBoothLayout(s.layout.proposal, { brief: s.brief, spec: s.spec });
      if (hasBlocker(ruleIssues)) {
        return { error: `布局存在硬性问题，请先修正布局再出最终图：${failMessages(ruleIssues).join('；')}`, code: 'LAYOUT_RULE_BLOCKER', issues: ruleIssues };
      }
      ruleMsgs.push(...failMessages(ruleIssues));
    }

    // D32 输入快照：spec/layout 摘要 + 每个 provider 调用前固化一条快照（provider 失败也留证据，不存 base64）。
    const specSummary = { hasSpec: !!s.spec, identity: s.spec?.identity, invariants: s.spec?.invariants, selfCheckCriteria: s.spec?.selfCheckCriteria, updatedAt: s.spec?.updatedAt };
    const layoutSummary = s.layout ? { status: s.layout.status, planAssetId: s.layout.planAssetId, proposal: s.layout.proposal } : undefined;
    const planId = effectivePlanAssetId ?? '';
    // D33：本轮被选用的上传素材（selectedAttachments 优先，空则 fallback 用分析推导的可用素材）→ 转 snapshot attachment refs。
    const selAtt = s.selectedAttachments?.length ? s.selectedAttachments : await selectUsableAttachmentsFromAnalyses(pid);
    const attRefs = toRenderInputRefs(selAtt, s.attachments ?? []);
    const attIds = attRefs.map((r) => r.id);
    const snapshot = (operation: RenderInputOperation, prompt: string, refs: RenderInputRef[], view?: string) =>
      saveRenderInputSnapshot(pid, { runId, mode, provider: providerName, model: imageModel, quality: q, size, prompt, intent, view, operation, specSummary, layoutSummary, refs: [...attRefs, ...refs], ruleIssues });

    const plan = effectivePlanAssetId ? await loadAssetBytes(pid, effectivePlanAssetId).catch(() => null) : null;
    if (effectivePlanAssetId && !plan) return { error: `找不到平面图资产 ${effectivePlanAssetId}` };
    if (effectivePlanAssetId && plan) await markLayoutConfirmed(pid, effectivePlanAssetId);

    // ① prompt-writer 子 agent：意图 → 英文五层主图 prompt（不占大脑上下文）
    const frontPrompt = await writeImagePrompt({ intent, identity, kind: mode === 'concept' ? 'concept' : plan ? 'plan' : 'front' });
    console.log(`[render] mode=${mode}/${plan ? 'plan' : views.length ? 'views' : 'single'} views=${views.length} n=${nn} q=${q} 预计生图≈${nn * (1 + views.length)} 张`);

    // ② 主图 best-of-N（文生图 或 平面图条件化）
    const heroCands: { bytes: Uint8Array; assetId: string; url: string; score: number; failN: number }[] = [];
    if (plan) {
      const instr = withRenderStyle(
        `${identity}\n\nThe attached image is a TOP-DOWN FLOOR PLAN of this exhibition booth — each labeled block is a functional zone at its real position and size. Render a photorealistic 3D booth that EXACTLY follows this floor plan (every zone's position, footprint, size and shape must match, including L-shaped counters). ${frontPrompt}`,
      );
      const planRef: RenderInputRef = { id: planId, kind: 'plan', role: 'floor_plan', url: `/api/assets/${planId}?project=${pid}` };
      const snap = await snapshot('plan-conditioned', instr, [planRef]);
      const t0 = Date.now();
      const raw = (await Promise.all(Array.from({ length: nn }, () => imageProvider.editFromRefs([plan], instr, { quality: q, size }).catch(() => null)))).filter(
        (b): b is Uint8Array => b !== null,
      );
      const genMs = Date.now() - t0;
      totalGenMs += genMs;
      if (!raw.length) return { error: '主图生成失败（按平面图）' };
      for (const b of raw) {
        const a = await saveAsset(pid, b, { kind: 'booth-image', prompt: 'plan-conditioned front', parentId: effectivePlanAssetId, provider: providerName, model: imageModel, quality: q, size, mode, durationMs: genMs, renderInputId: snap.id, sourceAssetIds: planId ? [planId] : [], sourceAttachmentIds: attIds });
        const insp = await inspectImage(b, criteria);
        await addInspection(pid, a.id, toInspectionResult(insp, MODEL_IDS.inspect));
        heroCands.push({ bytes: b, assetId: a.id, url: a.url, score: insp.score, failN: insp.fails.length });
      }
    } else {
      const full = withRenderStyle(`${identity}\n\n${frontPrompt}`);
      const snap = await snapshot('text-to-image', full, []);
      const t0 = Date.now();
      const raw = (await Promise.all(Array.from({ length: nn }, () => imageProvider.textToImage(full, { quality: q, size }).catch(() => null)))).filter(
        (b): b is Uint8Array => b !== null,
      );
      const genMs = Date.now() - t0;
      totalGenMs += genMs;
      if (!raw.length) return { error: '主图生成失败（无返回）' };
      for (const b of raw) {
        const a = await saveAsset(pid, b, { kind: 'booth-image', prompt: frontPrompt, provider: providerName, model: imageModel, quality: q, size, mode, durationMs: genMs, renderInputId: snap.id, sourceAttachmentIds: attIds });
        const insp = await inspectImage(b, criteria);
        await addInspection(pid, a.id, toInspectionResult(insp, MODEL_IDS.inspect));
        heroCands.push({ bytes: b, assetId: a.id, url: a.url, score: insp.score, failN: insp.fails.length });
      }
    }
    heroCands.sort((x, y) => x.failN - y.failN || y.score - x.score);
    const hero = heroCands[0];

    // ③ 无 views → 单图 single：返回所有候选（best 标 recommended）
    if (!views.length) {
      const assets: DeliverableAsset[] = heroCands.map((c, i) => ({
        assetId: c.assetId,
        url: c.url,
        role: 'candidate',
        status: i === 0 ? 'recommended' : c.failN === 0 ? 'ok' : 'weak',
        score: c.score,
      }));
      const singleIssues = [...ruleMsgs, ...(hero.failN ? [`主图有 ${hero.failN} 处客观待改`] : [])];
      const single: Deliverable = { type: 'single', assets, recommendedId: hero.assetId, ...(singleIssues.length ? { issues: singleIssues } : {}) };
      await recordRunDeliverable(pid, runId, single);
      await appendRunEvent(pid, runId, { type: 'tool', toolName: 'render', outputSummary: { provider: providerName, model: imageModel, mode, quality: q, size, images: assets.length, durationMs: totalGenMs } });
      return single;
    }

    // ④ 有 views → 进化链多视角：以 [（平面图）+ 主图 + 已通过视角] 为累积参考，逐角度判一致性、门控
    const assets: DeliverableAsset[] = [{ assetId: hero.assetId, url: hero.url, role: 'hero', status: 'recommended', score: hero.score }];
    const issues: string[] = [];
    const refPool: Uint8Array[] = plan ? [plan, hero.bytes] : [hero.bytes];
    const heroRef: RenderInputRef = { id: hero.assetId, kind: 'asset', role: 'previous_render', url: hero.url };
    const refMeta: RenderInputRef[] = plan ? [{ id: planId, kind: 'plan', role: 'floor_plan', url: `/api/assets/${planId}?project=${pid}` }, heroRef] : [heroRef];
    for (const view of views) {
      const instr = withRenderStyle(
        `${identity}\n\nUsing the attached reference image(s) of THIS exact exhibition booth, render the SAME booth from ${view}. Keep every structural part, material, color, brand placement, furniture COUNT and lighting identical to the reference(s); only the camera viewpoint changes — do NOT add, remove, move or redesign anything.`,
      );
      const snap = await snapshot('view-generation', instr, refMeta.slice(), view);
      const t0 = Date.now();
      const cands = (await Promise.all(Array.from({ length: nn }, () => imageProvider.editFromRefs(refPool, instr, { quality: q, size }).catch(() => null)))).filter(
        (b): b is Uint8Array => b !== null,
      );
      const genMs = Date.now() - t0;
      totalGenMs += genMs;
      if (!cands.length) {
        assets.push({ assetId: '', url: '', role: 'view', view, status: 'failed' });
        issues.push(`${view}：生成失败`);
        continue;
      }
      const judged = await Promise.all(cands.map(async (b) => ({ b, c: await inspectConsistency(hero.bytes, b, view) })));
      judged.sort((x, y) => y.c.consistencyScore - x.c.consistencyScore);
      const best = judged[0];
      const a = await saveAsset(pid, best.b, { kind: 'booth-image', prompt: `${view} (ref-conditioned)`, parentId: hero.assetId, provider: providerName, model: imageModel, quality: q, size, mode, durationMs: genMs, renderInputId: snap.id, sourceAssetIds: refMeta.map((r) => r.id).filter(Boolean), sourceAttachmentIds: attIds });
      await addInspection(pid, a.id, consistencyToInspectionResult(best.c, view, GATE, MODEL_IDS.inspect));
      const passed = best.c.sameBooth && best.c.consistencyScore >= GATE;
      if (passed) {
        refPool.push(best.b); // 门控：只有通过的进参考池，防漂移传染
        refMeta.push({ id: a.id, kind: 'asset', role: 'previous_render', url: a.url }); // 通过的视角进 refMeta，后续视角快照可追踪
      }
      assets.push({ assetId: a.id, url: a.url, role: 'view', view, status: passed ? 'ok' : 'weak', score: best.c.consistencyScore });
      if (!passed) issues.push(`${view}：一致性偏弱(${best.c.consistencyScore}<${GATE})，可 revise 或重出`);
    }
    const finalIssues = [...ruleMsgs, ...issues];
    const deliverable: Deliverable = { type: plan ? 'plan-conditioned' : 'view-set', assets, recommendedId: hero.assetId, ...(finalIssues.length ? { issues: finalIssues } : {}) };
    await recordRunDeliverable(pid, runId, deliverable);
    await appendRunEvent(pid, runId, { type: 'tool', toolName: 'render', outputSummary: { provider: providerName, model: imageModel, mode, quality: q, size, images: assets.length, durationMs: totalGenMs } });
    return deliverable;
  },
});
