import { tool } from 'ai';
import { z } from 'zod';
import { DEFAULT_IMAGE_QUALITY, MAX_PARALLEL_IMAGES, MODEL_IDS, withRenderStyle } from '@/models/gateway';
import { imageProvider, resolveActiveImageProvider } from '@/models/image-providers';
import { checkBoothLayout, failMessages, hasBlocker, type BoothRuleIssue } from '@/lib/booth-rules';
import { addInspection, appendRunEvent, loadAssetBytes, markLayoutConfirmed, projectIdFromContext, readState, recordRunDeliverable, runIdFromContext, saveAsset, saveCandidateAsset, saveRenderInputSnapshot } from '@/lib/storage';
import { selectUsableAttachmentsFromAnalyses, toRenderInputRefs } from '@/lib/asset-analysis';
import { inspectImage, inspectConsistency, toInspectionResult, consistencyToInspectionResult } from '@/agent/inspect';
import { writeImagePrompt } from '@/agent/prompt-writer';
import type { BoothLayout, LayoutOpening, Deliverable, DeliverableAsset, RenderInputOperation, RenderInputRef } from '@/lib/types';

const GATE = 70; // 进化链一致性门控（漂移图不进参考池）
const MAX_VIEWS = 4; // 单次视角硬上限（事前预算边界）
const MAX_IMAGES_PER_RENDER = 10; // 单工具内部硬预算：挡住 stopWhen 之前的跑飞
const LAYOUT_EDGES: LayoutOpening[] = ['back', 'front', 'left', 'right'];
const EDGE_LABEL: Record<LayoutOpening, string> = { back: 'BACK/top long side', front: 'FRONT/main aisle long side', left: 'LEFT short side', right: 'RIGHT short side' };
const ZONE_TYPE_LABEL: Record<string, string> = {
  led: 'LED / main visual wall',
  screen: 'screen / display surface',
  stage: 'stage / presentation area',
  brand: 'brand wall or brand surface',
  wall: 'wall / vertical partition',
  reception: 'reception counter',
  counter: 'counter / service desk',
  meeting: 'meeting room / talk area',
  storage: 'storage / back-of-house',
  product: 'product display',
  showcase: 'glass showcase / product cabinet',
  table: 'table',
  chair: 'chair',
  totem: 'slim freestanding totem / signage board',
  truss: 'vertical truss column',
  door: 'door / opening',
  plant: 'planting / soft divider',
  aisle: 'open circulation aisle',
};
const SHAPE_LABEL: Record<string, string> = { rect: 'rectangle', l: 'L-shaped footprint', circle: 'circle/ellipse', capsule: 'rounded capsule', line: 'linear strip' };
const fmtM = (n: number) => `${Number.isInteger(n) ? n : Number(n.toFixed(2))}m`;

const edgeLength = (layout: BoothLayout, edge: LayoutOpening) => (edge === 'back' || edge === 'front' ? layout.length : layout.width);
const touchingEdges = (layout: BoothLayout, z: BoothLayout['zones'][number]) => {
  const eps = 0.05;
  const touches: string[] = [];
  if (z.y <= eps) touches.push(EDGE_LABEL.back);
  if (z.y + z.h >= layout.width - eps) touches.push(EDGE_LABEL.front);
  if (z.x <= eps) touches.push(EDGE_LABEL.left);
  if (z.x + z.w >= layout.length - eps) touches.push(EDGE_LABEL.right);
  return touches.length ? touches.join(', ') : 'interior';
};

function layoutConstraintText(layout?: BoothLayout): string {
  if (!layout) return '';
  const openings = Array.from(new Set(layout.openings ?? [])).filter((e): e is LayoutOpening => LAYOUT_EDGES.includes(e as LayoutOpening));
  const open = new Set(openings);
  const closed = LAYOUT_EDGES.filter((edge) => !open.has(edge));
  const zones = layout.zones
    .map((z, idx) => {
      const id = z.id || String.fromCharCode(65 + idx);
      const xr = `${fmtM(z.x)}-${fmtM(z.x + z.w)}`;
      const yr = `${fmtM(z.y)}-${fmtM(z.y + z.h)}`;
      const kind = z.type ? ZONE_TYPE_LABEL[z.type] ?? z.type : 'functional zone';
      const parts = [
        `${id}. ${z.name} (${kind})`,
        `shape=${z.shape ? SHAPE_LABEL[z.shape] ?? z.shape : 'rectangle'}`,
        `layer=${z.layer ?? 'space/object'}`,
        `x=${xr}`,
        `y=${yr}`,
        `plan size=${fmtM(z.w)} x ${fmtM(z.h)}`,
        `touches=${touchingEdges(layout, z)}`,
      ];
      if (z.height != null) parts.push(`height=${fmtM(z.height)}`);
      if (z.facing) parts.push(`facing=${z.facing}`);
      if (z.material) parts.push(`material=${z.material}`);
      if (z.note) parts.push(`note=${z.note}`);
      if (z.description) parts.push(`description=${z.description}`);
      return `${parts.join(', ')}.`;
    })
    .join('\n');
  return `STRUCTURED FLOOR PLAN HARD LOCK:
Coordinate system is metric and top-down. Origin (0,0) is the BACK-LEFT corner of the booth plan. X runs left-to-right along the ${fmtM(layout.length)} long side. Y runs back-to-front along the ${fmtM(layout.width)} short side. BACK and FRONT are long sides; LEFT and RIGHT are short sides.
Outer footprint must be one strict rectangle: ${fmtM(layout.length)} x ${fmtM(layout.width)}. Open edges: ${openings.length ? openings.map((e) => `${EDGE_LABEL[e]} (${fmtM(edgeLength(layout, e))})`).join('; ') : 'none stated'}. Closed/wall-adjacent edges: ${closed.map((e) => `${EDGE_LABEL[e]} (${fmtM(edgeLength(layout, e))})`).join('; ') || 'none'}.
Functional zones, exact positions:
${zones}
Use this structured object table as the source of truth. The attached PNG floor plan is only a visual diagram of the same data. Respect every object ID, type, shape, height, facing direction, material, and description. Do not merge unrelated objects into one blob, do not swap left/right, do not move objects to another edge, do not turn the rectangular footprint into a polygon, and do not invent extra walls or protrusions. Interior standees/totems are slim freestanding rectangles inside these coordinates only.`;
}

// 唯一生图入口（首稿候选 / 用户选定基准后的多视角 / 平面图条件化）。大脑只给中文意图，
// prompt-writer 子 agent 写英文 prompt；identity / 判图要点自读 spec；出口统一 Deliverable。
export const render = tool({
  description:
    '出展台效果图（**唯一生图入口**）。你只给**中文意图**（要出什么、视觉重点、风格倾向），不用写英文 prompt——内部 prompt 专家会写。默认首稿只生成 candidate-set：views=[]、final 默认 n=2、autoCheck=false，候选图不会进入正式资产库，必须等用户点选基准图后再深化。给 views 时只会使用用户已选 baseAssetId 作为参考生成多视角；没有基准图会拒绝。给 planAssetId 时按该平面图为硬参考先出首稿候选。identity、外轮廓硬规则与判图要点自动读 spec。返回统一交付物。',
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
    n: z.number().int().min(1).max(MAX_PARALLEL_IMAGES).optional().describe('每张图 best-of-N 候选数；留空=按 mode 取默认（concept→1，final→2）。实测单次方差大，final 用 2 择优'),
    autoCheck: z.boolean().default(false).describe('是否启用 Opus 判图/一致性检查。默认 false，把选择权交还用户；只有明确要 AI 诊断时打开'),
  }),
  execute: async ({ intent, views, planAssetId, mode, quality, size, n, autoCheck }, opts) => {
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
    const criteria = s.spec?.selfCheckCriteria || intent; // 没 spec 时用 intent 兜底判图要点
    // 本地测试：所有模式默认 medium，避免 high 的长等待；n 仍按 mode 控制候选数量。
    // schema 不设 quality/n 默认，默认在此按 mode 解析——显式传入则尊重，避免 Zod default 与系统提示打架。
    const q: 'low' | 'medium' | 'high' = quality ?? DEFAULT_IMAGE_QUALITY;
    const nn = n ?? (views.length ? 1 : mode === 'concept' ? 1 : 2);
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
    const layoutLock = layoutConstraintText(s.layout?.proposal);
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
    const frontPrompt = views.length && baseAsset ? '' : await writeImagePrompt({ intent, identity: promptIdentity, kind: mode === 'concept' ? 'concept' : plan ? 'plan' : 'front' });
    console.log(`[render] mode=${mode}/${plan ? 'plan' : views.length ? 'views' : 'single'} views=${views.length} n=${nn} q=${q} 预计生图≈${requestedImages} 张`);

    // ② 首稿候选：只落候选文件，不进正式资产库；用户选中后再 promote 入库。
    const heroCands: { bytes: Uint8Array; assetId: string; url: string; score: number; failN: number }[] = [];
    if (views.length && baseAsset) {
      const baseBytes = await loadAssetBytes(pid, baseAsset.id).catch(() => null);
      if (!baseBytes) return { error: `找不到用户选定的基准资产 ${baseAsset.id}` };
      heroCands.push({ bytes: baseBytes, assetId: baseAsset.id, url: baseAsset.url, score: 0, failN: 0 });
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
        const insp = autoCheck ? await inspectImage(b, criteria) : null;
        const a = await saveCandidateAsset(pid, b, { kind: 'booth-image', prompt: 'plan-conditioned front candidate', parentId: effectivePlanAssetId, inspections: insp ? [toInspectionResult(insp, MODEL_IDS.inspect)] : undefined, provider: providerName, model: imageModel, quality: q, size, mode, durationMs: genMs, renderInputId: snap.id, sourceAssetIds: planId ? [planId] : [], sourceAttachmentIds: attIds });
        heroCands.push({ bytes: b, assetId: a.id, url: a.url, score: insp?.score ?? 0, failN: insp?.fails.length ?? 0 });
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
        const insp = autoCheck ? await inspectImage(b, criteria) : null;
        const a = await saveCandidateAsset(pid, b, { kind: 'booth-image', prompt: `${frontPrompt} candidate`, inspections: insp ? [toInspectionResult(insp, MODEL_IDS.inspect)] : undefined, provider: providerName, model: imageModel, quality: q, size, mode, durationMs: genMs, renderInputId: snap.id, sourceAttachmentIds: attIds });
        heroCands.push({ bytes: b, assetId: a.id, url: a.url, score: insp?.score ?? 0, failN: insp?.fails.length ?? 0 });
      }
    }
    heroCands.sort((x, y) => x.failN - y.failN || y.score - x.score);
    const hero = heroCands[0];

    // ③ 无 views → 首稿候选集：用户选中后才进入正式资产库
    if (!views.length) {
      const assets: DeliverableAsset[] = heroCands.map((c, i) => ({
        assetId: c.assetId,
        url: c.url,
        role: 'candidate',
        status: i === 0 ? 'recommended' : c.failN === 0 ? 'ok' : 'weak',
        score: c.score,
      }));
      const singleIssues = [...ruleMsgs, ...(autoCheck && hero.failN ? [`主图有 ${hero.failN} 处客观待改`] : [])];
      const single: Deliverable = { type: 'candidate-set', assets, recommendedId: hero.assetId, ...(singleIssues.length ? { issues: singleIssues } : {}) };
      await recordRunDeliverable(pid, runId, single);
      await appendRunEvent(pid, runId, { type: 'tool', toolName: 'render', outputSummary: { provider: providerName, model: imageModel, mode, quality: q, size, images: assets.length, durationMs: totalGenMs } });
      return single;
    }

    // ④ 有 views → 默认并发：每个视角只吃用户选定基准图（和可选平面图），避免漂移图继续污染后续视角。
    // 只有用户明确打开 autoCheck 时，才使用串行进化链，把通过一致性门控的视角加入参考池。
    const assets: DeliverableAsset[] = [{ assetId: hero.assetId, url: hero.url, role: 'hero', status: 'recommended', score: hero.score }];
    const issues: string[] = [];
    const refPool: Uint8Array[] = plan ? [plan, hero.bytes] : [hero.bytes];
    const heroRef: RenderInputRef = { id: hero.assetId, kind: 'asset', role: 'previous_render', url: hero.url };
    const refMeta: RenderInputRef[] = plan ? [{ id: planId, kind: 'plan', role: 'floor_plan', url: `/api/assets/${planId}?project=${pid}` }, heroRef] : [heroRef];

    const viewInstruction = (view: string) =>
      withRenderStyle(
        `${promptIdentity}\n\n${layoutLock ? `${layoutLock}\n\n` : ''}Using the attached reference image(s) of THIS exact exhibition booth, render the SAME booth from ${view}. The references are geometry and identity locks, not loose inspiration. Keep every structural part, material, color, brand placement, furniture COUNT, exact outer footprint boundary stated above, raised platform/carpet rectangle, truss perimeter, wall line, and lighting identical to the reference(s); only the camera viewpoint changes. The booth boundary must stay a clean unbroken rectangle with four 90-degree corners unless the identity explicitly says otherwise: no notches, protrusions, chamfers, diagonal bites, warped corners, add-on floor islands, or polygonal platform/truss outline. Freestanding totems / standees are slim rectangular interior signage boards only, never wall extensions and never part of the outer footprint. Do NOT add, remove, move, darken, clutter, or redesign anything.`,
      );

    if (!autoCheck) {
      const baseRefs = refPool.slice();
      const baseMeta = refMeta.slice();
      const batchT0 = Date.now();
      const results = await Promise.all(
        views.map(async (view) => {
          const instr = viewInstruction(view);
          const snap = await snapshot('view-generation', instr, baseMeta.slice(), view);
          const t0 = Date.now();
          const cands = (await Promise.all(Array.from({ length: nn }, () => imageProvider.editFromRefs(baseRefs, instr, { quality: q, size }).catch(() => null)))).filter(
            (b): b is Uint8Array => b !== null,
          );
          const genMs = Date.now() - t0;
          if (!cands.length) return { asset: { assetId: '', url: '', role: 'view', view, status: 'failed' } satisfies DeliverableAsset, issue: `${view}：生成失败` };
          const a = await saveAsset(pid, cands[0], { kind: 'booth-image', prompt: `${view} (base-ref parallel)`, parentId: hero.assetId, provider: providerName, model: imageModel, quality: q, size, mode, durationMs: genMs, renderInputId: snap.id, sourceAssetIds: baseMeta.map((r) => r.id).filter(Boolean), sourceAttachmentIds: attIds });
          return { asset: { assetId: a.id, url: a.url, role: 'view', view, status: 'ok' } satisfies DeliverableAsset };
        }),
      );
      totalGenMs += Date.now() - batchT0;
      for (const r of results) {
        assets.push(r.asset);
        if (r.issue) issues.push(r.issue);
      }
    } else {
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
        const judged = await Promise.all(cands.map(async (b) => ({ b, c: await inspectConsistency(hero.bytes, b, view) })));
        judged.sort((x, y) => y.c.consistencyScore - x.c.consistencyScore);
        const best = judged[0];
        const a = await saveAsset(pid, best.b, { kind: 'booth-image', prompt: `${view} (ref-conditioned checked)`, parentId: hero.assetId, provider: providerName, model: imageModel, quality: q, size, mode, durationMs: genMs, renderInputId: snap.id, sourceAssetIds: refMeta.map((r) => r.id).filter(Boolean), sourceAttachmentIds: attIds });
        await addInspection(pid, a.id, consistencyToInspectionResult(best.c, view, GATE, MODEL_IDS.inspect));
        const passed = best.c.sameBooth && best.c.consistencyScore >= GATE;
        if (passed) {
          refPool.push(best.b); // 门控：只有通过的进参考池，防漂移传染
          refMeta.push({ id: a.id, kind: 'asset', role: 'previous_render', url: a.url }); // 通过的视角进 refMeta，后续视角快照可追踪
        }
        assets.push({ assetId: a.id, url: a.url, role: 'view', view, status: passed ? 'ok' : 'weak', score: best.c.consistencyScore });
        if (!passed) issues.push(`${view}：一致性偏弱(${best.c.consistencyScore}<${GATE})，可 revise 或重出`);
      }
    }
    const finalIssues = [...ruleMsgs, ...issues];
    const deliverable: Deliverable = { type: plan ? 'plan-conditioned' : 'view-set', assets, recommendedId: hero.assetId, ...(finalIssues.length ? { issues: finalIssues } : {}) };
    await recordRunDeliverable(pid, runId, deliverable);
    await appendRunEvent(pid, runId, { type: 'tool', toolName: 'render', outputSummary: { provider: providerName, model: imageModel, mode, quality: q, size, images: assets.length, durationMs: totalGenMs } });
    return deliverable;
  },
});
