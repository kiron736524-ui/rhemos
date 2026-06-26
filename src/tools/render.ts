import { tool } from 'ai';
import { z } from 'zod';
import { DEFAULT_IMAGE_QUALITY, MAX_PARALLEL_IMAGES, withRenderStyle } from '@/models/gateway';
import { imageProvider, IMAGE_PROVIDER, IMAGE_MODEL } from '@/models/image-providers';
import { checkBoothLayout, failMessages, hasBlocker, type BoothRuleIssue } from '@/lib/booth-rules';
import { cadPromptLock } from '@/lib/cad';
import { appendRunEvent, loadAssetBytes, markLayoutConfirmed, projectIdFromContext, readState, recordRunDeliverable, runIdFromContext, saveAsset, saveCandidateAsset, saveRenderInputSnapshot } from '@/lib/storage';
import { selectUsableAttachmentsFromAnalyses, toRenderInputRefs } from '@/lib/asset-analysis';
import { writeImagePrompt } from '@/agent/prompt-writer';
import type { Deliverable, DeliverableAsset, RenderInputOperation, RenderInputRef } from '@/lib/types';

const MAX_VIEWS = 4; // 单次视角硬上限（事前预算边界）
const MAX_IMAGES_PER_RENDER = 10; // 单工具内部硬预算：挡住 stopWhen 之前的跑飞

// 唯一生图入口（首稿候选 / 用户选定基准后的多视角 / 平面图条件化）。大脑只给中文意图，
// prompt-writer 子 agent 写英文 prompt；identity 自读 spec；出口统一 Deliverable。
// 判图 / 打分已删除（D39）：候选不再自动评分，由用户手动选基准；多视角走"进化式参考链"（保留，无门控）。
export const render = tool({
  description:
    '出展台效果图（**唯一生图入口**，gpt-image-2 / fal）。你只给**中文意图**（要出什么、视觉重点、风格倾向），不用写英文 prompt——内部 prompt 专家会写。默认首稿只生成 candidate-set：views=[]、final 默认 n=2，候选图不会进入正式资产库，必须等用户点选基准图后再深化。给 views 时只会使用用户已选 baseAssetId 作为参考，按"进化式参考链"串行出多视角（每张以 基准图 + 已生成视角 为累积参考，保持一致）；没有基准图会拒绝。给 planAssetId 时按该平面图为硬参考先出首稿候选。identity 与外轮廓硬规则自动读 spec。返回统一交付物。',
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
      .describe('concept=早期方向探索（默认 medium/n=1，快，可无 spec）；final=最终交付（本地测试默认 medium/n=2，必须已有 spec.identity 且布局已确认或明确跳过）'),
    quality: z.enum(['low', 'medium', 'high']).optional().describe('画质；留空=medium（本地测试提速）。用户明确要更快草图才显式压到 low'),
    size: z.enum(['1024x1024', '1536x1024', '1024x1536']).default('1024x1024'),
    n: z.number().int().min(1).max(MAX_PARALLEL_IMAGES).optional().describe('每张图 best-of-N 候选数；留空=按 mode 取默认（concept→1，final→2）。实测单次方差大，final 用 2 给用户挑'),
  }),
  execute: async ({ intent, views, planAssetId, mode, quality, size, n }, opts) => {
    const ctx = (opts as { experimental_context?: unknown }).experimental_context;
    const pid = projectIdFromContext(ctx);
    const runId = runIdFromContext(ctx);
    const s = await readState(pid);
    const identity = s.spec?.identity ?? '';
    const footprintRule =
      s.spec?.footprint?.boundaryRule ??
      (s.layout?.proposal
        ? `Booth outer footprint shape is a STRICT RECTANGLE, exactly ${s.layout.proposal.length}m x ${s.layout.proposal.width}m. The raised platform, carpet/floor finish edge, truss perimeter, back wall line, and booth boundary must be one unbroken rectilinear outline with four 90-degree corners. Do NOT create a hexagonal, octagonal, chamfered, diagonal-cut, curved, notched, stepped, bitten-out, protruding, warped, or polygonal outer perimeter. No random add-on floor islands, no corner bulges, and no facade piece may extend outside the rectangle unless the user explicitly requested that irregular shape. Any circular route, ring feature, totem, standee, or decorative feature is an interior design element only, never the booth outline.`
        : 'Booth outer footprint shape is a STRICT RECTANGLE with four 90-degree corners unless the user explicitly requested an irregular custom perimeter. The platform/carpet edge and truss perimeter must be one unbroken rectangle: no hexagonal, octagonal, chamfered, diagonal-cut, curved, notched, stepped, bitten-out, protruding, warped, add-on, or polygonal outer perimeter. Totems and standees are interior elements only.');
    const promptIdentity = identity.includes('FOOTPRINT BOUNDARY HARD RULE') ? identity : `${identity}\n\nFOOTPRINT BOUNDARY HARD RULE: ${footprintRule}`;
    // 本地测试：所有模式默认 medium，避免 high 的长等待；n 仍按 mode 控制候选数量。
    // schema 不设 quality/n 默认，默认在此按 mode 解析——显式传入则尊重，避免 Zod default 与系统提示打架。
    const q: 'low' | 'medium' | 'high' = quality ?? DEFAULT_IMAGE_QUALITY;
    const nn = n ?? (views.length ? 1 : mode === 'concept' ? 1 : 2);
    // 生图渠道 / 模型已锁定 gpt-image-2 / fal（见 image-providers.ts），仅作元数据记录。
    const providerName = IMAGE_PROVIDER;
    const imageModel = IMAGE_MODEL;
    let totalGenMs = 0; // 累计各批次生图墙钟，记入 run 事件
    if (views.length > MAX_VIEWS) views = views.slice(0, MAX_VIEWS);
    const requestedImages = nn * (views.length ? views.length : 1);
    if (requestedImages > MAX_IMAGES_PER_RENDER) {
      return { error: `本次 render 预计 ${requestedImages} 张，超过单工具上限 ${MAX_IMAGES_PER_RENDER} 张；请减少 views 或 n。`, code: 'RENDER_BUDGET_EXCEEDED' };
    }

    const effectivePlanAssetId = planAssetId ?? (s.layout?.status === 'confirmed' ? s.layout.planAssetId : undefined);
    const baseAsset = s.baseAssetId ? s.assets.find((a) => a.id === s.baseAssetId) : undefined;
    if (views.length && !baseAsset) {
      return { error: '多视角/俯视深化前必须先让用户从首稿候选中选择一张基准图；请先生成两张主图候选并等待用户选择。', code: 'VIEW_REQUIRES_USER_SELECTED_BASE' };
    }
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
    const layoutLock = cadPromptLock(s.layout?.proposal);
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
    const frontPrompt = views.length && baseAsset
      ? ''
      : await writeImagePrompt({
          intent,
          identity: promptIdentity,
          kind: mode === 'concept' ? 'concept' : plan ? 'plan' : 'front',
          trace: { projectId: pid, runId, purpose: plan ? 'plan-conditioned front prompt' : 'front prompt' },
        });
    console.log(`[render] mode=${mode}/${plan ? 'plan' : views.length ? 'views' : 'single'} views=${views.length} n=${nn} q=${q} 预计生图≈${requestedImages} 张`);

    // ② 首稿候选：只落候选文件，不进正式资产库；用户选中后再 promote 入库。
    const heroCands: { bytes: Uint8Array; assetId: string; url: string }[] = [];
    if (views.length && baseAsset) {
      const baseBytes = await loadAssetBytes(pid, baseAsset.id).catch(() => null);
      if (!baseBytes) return { error: `找不到用户选定的基准资产 ${baseAsset.id}` };
      heroCands.push({ bytes: baseBytes, assetId: baseAsset.id, url: baseAsset.url });
    } else if (plan) {
      const instr = withRenderStyle(
        `${promptIdentity}\n\n${layoutLock ? `${layoutLock}\n\n` : ''}The attached image is a TOP-DOWN FLOOR PLAN of this exhibition booth — each labeled block is a functional zone at its real position and size. Render a photorealistic 3D booth that EXACTLY follows this floor plan (every zone's position, footprint, size and shape must match, including L-shaped counters). The booth OUTER PERIMETER must remain the footprint shape specified in the identity; do not stylize the platform or truss perimeter into a polygon. ${frontPrompt}`,
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
        const a = await saveCandidateAsset(pid, b, { kind: 'booth-image', prompt: 'plan-conditioned front candidate', parentId: effectivePlanAssetId, provider: providerName, model: imageModel, quality: q, size, mode, durationMs: genMs, renderInputId: snap.id, sourceAssetIds: planId ? [planId] : [], sourceAttachmentIds: attIds });
        heroCands.push({ bytes: b, assetId: a.id, url: a.url });
      }
    } else {
      const full = withRenderStyle(`${promptIdentity}\n\n${layoutLock ? `${layoutLock}\n\n` : ''}${frontPrompt}`);
      const snap = await snapshot('text-to-image', full, []);
      const t0 = Date.now();
      const raw = (await Promise.all(Array.from({ length: nn }, () => imageProvider.textToImage(full, { quality: q, size }).catch(() => null)))).filter(
        (b): b is Uint8Array => b !== null,
      );
      const genMs = Date.now() - t0;
      totalGenMs += genMs;
      if (!raw.length) return { error: '主图生成失败（无返回）' };
      for (const b of raw) {
        const a = await saveCandidateAsset(pid, b, { kind: 'booth-image', prompt: `${frontPrompt} candidate`, provider: providerName, model: imageModel, quality: q, size, mode, durationMs: genMs, renderInputId: snap.id, sourceAttachmentIds: attIds });
        heroCands.push({ bytes: b, assetId: a.id, url: a.url });
      }
    }
    // 判图/打分已删除：候选不再排序，首张即推荐项，由用户从候选集里手动选基准。
    const hero = heroCands[0];

    // ③ 无 views → 首稿候选集：用户选中后才进入正式资产库
    if (!views.length) {
      const assets: DeliverableAsset[] = heroCands.map((c, i) => ({
        assetId: c.assetId,
        url: c.url,
        role: 'candidate',
        status: i === 0 ? 'recommended' : 'ok',
      }));
      const single: Deliverable = { type: 'candidate-set', assets, recommendedId: hero.assetId, ...(ruleMsgs.length ? { issues: ruleMsgs } : {}) };
      await recordRunDeliverable(pid, runId, single);
      await appendRunEvent(pid, runId, { type: 'tool', toolName: 'render', outputSummary: { provider: providerName, model: imageModel, mode, quality: q, size, images: assets.length, durationMs: totalGenMs } });
      return single;
    }

    // ④ 有 views → 进化式参考链（保留，D39）：串行生成，每张视角以 [（平面图）+ 基准图 + 已生成视角] 为累积参考池。
    // 判图门控已删除——每张生成的视角都直接进参考池；漂移可能沿链传染，属已知取舍（用户确认接受，后续再优化）。
    const assets: DeliverableAsset[] = [{ assetId: hero.assetId, url: hero.url, role: 'hero', status: 'recommended' }];
    const issues: string[] = [];
    const refPool: Uint8Array[] = plan ? [plan, hero.bytes] : [hero.bytes];
    const heroRef: RenderInputRef = { id: hero.assetId, kind: 'asset', role: 'previous_render', url: hero.url };
    const refMeta: RenderInputRef[] = plan ? [{ id: planId, kind: 'plan', role: 'floor_plan', url: `/api/assets/${planId}?project=${pid}` }, heroRef] : [heroRef];

    const viewInstruction = (view: string) =>
      withRenderStyle(
        `${promptIdentity}\n\n${layoutLock ? `${layoutLock}\n\n` : ''}Using the attached reference image(s) of THIS exact exhibition booth, render the SAME booth from ${view}. The references are geometry and identity locks, not loose inspiration. Keep every structural part, material, color, brand placement, furniture COUNT, exact outer footprint boundary stated above, raised platform/carpet rectangle, truss perimeter, wall line, and lighting identical to the reference(s); only the camera viewpoint changes. The booth boundary must stay a clean unbroken rectangle with four 90-degree corners unless the identity explicitly says otherwise: no notches, protrusions, chamfers, diagonal bites, warped corners, add-on floor islands, or polygonal platform/truss outline. Freestanding totems / standees are slim rectangular interior signage boards only, never wall extensions and never part of the outer footprint. Do NOT add, remove, move, darken, clutter, or redesign anything.`,
      );

    for (const view of views) {
      const instr = viewInstruction(view);
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
      const b = cands[0];
      const a = await saveAsset(pid, b, { kind: 'booth-image', prompt: `${view} (evolution chain)`, parentId: hero.assetId, provider: providerName, model: imageModel, quality: q, size, mode, durationMs: genMs, renderInputId: snap.id, sourceAssetIds: refMeta.map((r) => r.id).filter(Boolean), sourceAttachmentIds: attIds });
      // 累积参考链：当前视角进 refPool/refMeta，后续视角以它为参考（无门控）。
      refPool.push(b);
      refMeta.push({ id: a.id, kind: 'asset', role: 'previous_render', url: a.url });
      assets.push({ assetId: a.id, url: a.url, role: 'view', view, status: 'ok' });
    }
    const finalIssues = [...ruleMsgs, ...issues];
    const deliverable: Deliverable = { type: plan ? 'plan-conditioned' : 'view-set', assets, recommendedId: hero.assetId, ...(finalIssues.length ? { issues: finalIssues } : {}) };
    await recordRunDeliverable(pid, runId, deliverable);
    await appendRunEvent(pid, runId, { type: 'tool', toolName: 'render', outputSummary: { provider: providerName, model: imageModel, mode, quality: q, size, images: assets.length, durationMs: totalGenMs } });
    return deliverable;
  },
});
