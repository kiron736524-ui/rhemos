import { tool } from 'ai';
import { z } from 'zod';
import { MAX_PARALLEL_IMAGES } from '@/models/gateway';
import { appendRunEvent, projectIdFromContext, recordRunDeliverable, runIdFromContext } from '@/lib/storage';
import type { Deliverable, DeliverableAsset } from '@/lib/types';
import { MAX_VIEWS, isRenderError, resolveRenderContext, type RenderArgs } from './render/context';
import { generateCandidates } from './render/candidates';
import { generateViewsChain } from './render/views-chain';

// 唯一生图入口（首稿候选 / 用户选定基准后的多视角 / 平面图条件化）。大脑只给中文意图，
// prompt-writer 子 agent 写英文 prompt；identity 自读 spec；出口统一 Deliverable。
// 判图 / 打分已删除（D39）：候选不再自动评分，由用户手动选基准；多视角走"进化式参考链"（保留，无门控）。
// 本 execute 仅编排：resolveRenderContext（门控+准备）→ generateCandidates → generateViewsChain，
// 具体逻辑见 src/tools/render/{context,candidates,views-chain}.ts。
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
  execute: async (args, opts) => {
    const o = opts as { experimental_context?: unknown; abortSignal?: AbortSignal };
    const pid = projectIdFromContext(o.experimental_context);
    const runId = runIdFromContext(o.experimental_context);

    // ① 门控 + 准备：失败直接早退（error code 不变）。signal 让客户端断流能取消在飞 fal 调用。
    const ctx = await resolveRenderContext(args as RenderArgs, { pid, runId, signal: o.abortSignal });
    if (isRenderError(ctx)) return ctx;

    // ② 首稿候选（文生图 / 平面图条件化 / 复用基准图）。
    const cand = await generateCandidates(ctx);
    if (isRenderError(cand)) return cand;
    const { heroCands } = cand;
    const hero = heroCands[0];
    let totalGenMs = cand.genMs;

    const writeRun = async (deliverable: Deliverable, images: number) => {
      await recordRunDeliverable(pid, runId, deliverable);
      await appendRunEvent(pid, runId, { type: 'tool', toolName: 'render', outputSummary: { provider: ctx.providerName, model: ctx.imageModel, mode: ctx.mode, quality: ctx.quality, size: ctx.size, images, durationMs: totalGenMs } });
    };

    // ③ 无 views → 首稿候选集：用户选中后才进入正式资产库。
    if (!ctx.views.length) {
      const assets: DeliverableAsset[] = heroCands.map((c, i) => ({ assetId: c.assetId, url: c.url, role: 'candidate', status: i === 0 ? 'recommended' : 'ok' }));
      const single: Deliverable = { type: 'candidate-set', assets, recommendedId: hero.assetId, ...(ctx.ruleMsgs.length ? { issues: ctx.ruleMsgs } : {}) };
      await writeRun(single, assets.length);
      return single;
    }

    // ④ 有 views → 进化式参考链（hero + 串行视角）。
    const chain = await generateViewsChain(ctx, hero);
    totalGenMs += chain.genMs;
    const assets: DeliverableAsset[] = [{ assetId: hero.assetId, url: hero.url, role: 'hero', status: 'recommended' }, ...chain.assets];
    const finalIssues = [...ctx.ruleMsgs, ...chain.issues];
    const deliverable: Deliverable = { type: ctx.plan ? 'plan-conditioned' : 'view-set', assets, recommendedId: hero.assetId, ...(finalIssues.length ? { issues: finalIssues } : {}) };
    await writeRun(deliverable, assets.length);
    return deliverable;
  },
});
