import { DEFAULT_IMAGE_QUALITY } from '@/models/gateway';
import { IMAGE_MODEL, IMAGE_PROVIDER } from '@/models/image-providers';
import { checkBoothLayout, failMessages, hasBlocker, type BoothRuleIssue } from '@/lib/booth-rules';
import { buildFootprintLock, cadPromptLock } from '@/lib/cad';
import { loadAssetBytes, markLayoutConfirmed, readState, saveRenderInputSnapshot } from '@/lib/storage';
import { selectUsableAttachmentsFromAnalyses, toRenderInputRefs } from '@/lib/asset-analysis';
import { writeImagePrompt } from '@/agent/prompt-writer';
import type { Asset, RenderInputOperation, RenderInputRef, RenderInputSnapshot } from '@/lib/types';

export const MAX_VIEWS = 4; // 单次视角硬上限（事前预算边界）
export const MAX_IMAGES_PER_RENDER = 10; // 单工具内部硬预算：挡住 stopWhen 之前的跑飞

/** render 工具的入参（与 render.ts 的 inputSchema 同构）。 */
export interface RenderArgs {
  intent: string;
  views: string[];
  planAssetId?: string;
  mode: 'concept' | 'final';
  quality?: 'low' | 'medium' | 'high';
  size: '1024x1024' | '1536x1024' | '1024x1536';
  n?: number;
}

/** 工具早退用的错误形状（与既有 error code 一致）。 */
export interface RenderError {
  error: string;
  code?: string;
  issues?: unknown;
}

export const isRenderError = (x: unknown): x is RenderError => typeof x === 'object' && x !== null && 'error' in x;

/** 解析后的 render 上下文：门控通过后，生成各阶段所需的一切（execute 只编排，不再算这些）。 */
export interface RenderContext {
  pid: string;
  runId: string | null;
  intent: string;
  mode: 'concept' | 'final';
  views: string[]; // 已按 MAX_VIEWS 截断
  quality: 'low' | 'medium' | 'high';
  n: number; // 已按 mode 解析的 best-of-N
  size: RenderArgs['size'];
  providerName: string;
  imageModel: string;
  promptIdentity: string; // identity + footprint 硬规则
  layoutLock: string; // cadPromptLock（可能空串）
  frontPrompt: string; // prompt-writer 产出（深化场景为空）
  plan: Uint8Array | null; // 平面图字节（有 planAssetId 时）
  planId: string;
  effectivePlanAssetId?: string;
  baseAsset?: Asset; // 用户选定基准（views 深化场景）
  ruleMsgs: string[]; // 规则 fail/blocker 文案（并入交付 issues）
  ruleIssues: BoothRuleIssue[];
  attIds: string[]; // 被选用上传素材 id
  snapshot: (operation: RenderInputOperation, prompt: string, refs: RenderInputRef[], view?: string) => Promise<RenderInputSnapshot>;
}

/** best-of-N 并发批量生图：每路失败→null，过滤后返回成功字节。统一首稿候选 / 视角链的批量调用，去重复制的 .catch(()=>null)。 */
export async function batchGenerate(n: number, gen: () => Promise<Uint8Array | null>): Promise<Uint8Array[]> {
  const raw = await Promise.all(Array.from({ length: n }, () => gen().catch(() => null)));
  return raw.filter((b): b is Uint8Array => b !== null);
}

/**
 * 解析 render 上下文：门控校验（预算 / base / mode / layout）+ 规则校验 + 选材 + 平面图加载 +
 * footprint/layout 锁 + frontPrompt（prompt-writer）+ 快照工厂。
 * 返回 RenderContext（成功）或 RenderError（execute 直接早退）。
 */
export async function resolveRenderContext(args: RenderArgs, raw: { pid: string; runId: string | null }): Promise<RenderContext | RenderError> {
  const { pid, runId } = raw;
  const { intent, planAssetId, mode, size } = args;
  let views = args.views;
  const s = await readState(pid);
  const identity = s.spec?.identity ?? '';
  // footprint 外轮廓硬规则：单一来源 cad.buildFootprintLock（footprint 一处声明、多处复用，见 D39）。
  const footprintRule = buildFootprintLock(s.spec, s.layout?.proposal);
  const promptIdentity = identity.includes('FOOTPRINT BOUNDARY HARD RULE') ? identity : `${identity}\n\nFOOTPRINT BOUNDARY HARD RULE: ${footprintRule}`;
  // 本地测试：所有模式默认 medium，避免 high 的长等待；n 按 mode 控制候选数量（显式传入则尊重）。
  const quality: 'low' | 'medium' | 'high' = args.quality ?? DEFAULT_IMAGE_QUALITY;
  const n = args.n ?? (views.length ? 1 : mode === 'concept' ? 1 : 2);
  // 生图渠道 / 模型已锁定 gpt-image-2 / fal（见 image-providers.ts），仅作元数据记录。
  const providerName = IMAGE_PROVIDER;
  const imageModel = IMAGE_MODEL;
  if (views.length > MAX_VIEWS) views = views.slice(0, MAX_VIEWS);
  const requestedImages = n * (views.length ? views.length : 1);
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

  // D32 输入快照：spec/layout 摘要 + 每次 provider 调用前固化一条（provider 失败也留证据，不存 base64）。
  const specSummary = { hasSpec: !!s.spec, identity: s.spec?.identity, invariants: s.spec?.invariants, selfCheckCriteria: s.spec?.selfCheckCriteria, updatedAt: s.spec?.updatedAt };
  const layoutSummary = s.layout ? { status: s.layout.status, planAssetId: s.layout.planAssetId, proposal: s.layout.proposal } : undefined;
  const layoutLock = cadPromptLock(s.layout?.proposal);
  const planId = effectivePlanAssetId ?? '';
  // D33：本轮被选用的上传素材（selectedAttachments 优先，空则 fallback 用分析推导）→ 转 snapshot attachment refs。
  const selAtt = s.selectedAttachments?.length ? s.selectedAttachments : await selectUsableAttachmentsFromAnalyses(pid);
  const attRefs = toRenderInputRefs(selAtt, s.attachments ?? []);
  const attIds = attRefs.map((r) => r.id);
  const snapshot = (operation: RenderInputOperation, prompt: string, refs: RenderInputRef[], view?: string) =>
    saveRenderInputSnapshot(pid, { runId, mode, provider: providerName, model: imageModel, quality, size, prompt, intent, view, operation, specSummary, layoutSummary, refs: [...attRefs, ...refs], ruleIssues });

  const plan = effectivePlanAssetId ? await loadAssetBytes(pid, effectivePlanAssetId).catch(() => null) : null;
  if (effectivePlanAssetId && !plan) return { error: `找不到平面图资产 ${effectivePlanAssetId}` };
  if (effectivePlanAssetId && plan) await markLayoutConfirmed(pid, effectivePlanAssetId);

  // prompt-writer 子 agent：中文意图 → 英文主图 prompt（不占大脑上下文）。深化场景（已有基准图）不需要。
  const frontPrompt = views.length && baseAsset
    ? ''
    : await writeImagePrompt({
        intent,
        identity: promptIdentity,
        kind: mode === 'concept' ? 'concept' : plan ? 'plan' : 'front',
        trace: { projectId: pid, runId, purpose: plan ? 'plan-conditioned front prompt' : 'front prompt' },
      });
  console.log(`[render] mode=${mode}/${plan ? 'plan' : views.length ? 'views' : 'single'} views=${views.length} n=${n} q=${quality} 预计生图≈${requestedImages} 张`);

  return {
    pid,
    runId,
    intent,
    mode,
    views,
    quality,
    n,
    size,
    providerName,
    imageModel,
    promptIdentity,
    layoutLock,
    frontPrompt,
    plan,
    planId,
    effectivePlanAssetId,
    baseAsset,
    ruleMsgs,
    ruleIssues,
    attIds,
    snapshot,
  };
}
