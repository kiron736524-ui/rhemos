import { tool } from 'ai';
import { z } from 'zod';
import { MAX_PARALLEL_IMAGES, MODEL_IDS, openaiViaGateway, withRenderStyle, generateImageFromRefs } from '@/models/gateway';
import { addInspection, loadAssetBytes, markLayoutConfirmed, projectIdFromContext, readState, recordRunDeliverable, runIdFromContext, saveAsset } from '@/lib/storage';
import { inspectImage, inspectConsistency, toInspectionResult, consistencyToInspectionResult } from '@/agent/inspect';
import { writeImagePrompt } from '@/agent/prompt-writer';
import type { Deliverable, DeliverableAsset } from '@/lib/types';

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
    mode: z.enum(['concept', 'final']).default('final').describe('concept=早期方向探索，可无 spec；final=最终交付，必须已有 spec.identity 且布局已确认或明确跳过'),
    quality: z.enum(['low', 'medium', 'high']).default('high'),
    size: z.enum(['1024x1024', '1536x1024', '1024x1536']).default('1024x1024'),
    n: z.number().int().min(1).max(MAX_PARALLEL_IMAGES).default(2).describe('每张图 best-of-N 候选数（对抗采样方差，实测单次方差大）'),
  }),
  execute: async ({ intent, views, planAssetId, mode, quality, size, n }, opts) => {
    const ctx = (opts as { experimental_context?: unknown }).experimental_context;
    const pid = projectIdFromContext(ctx);
    const runId = runIdFromContext(ctx);
    const s = await readState(pid);
    const identity = s.spec?.identity ?? '';
    const criteria = s.spec?.selfCheckCriteria || intent; // 没 spec 时用 intent 兜底判图要点
    if (views.length > MAX_VIEWS) views = views.slice(0, MAX_VIEWS);
    const requestedImages = n * (1 + views.length);
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

    const plan = effectivePlanAssetId ? await loadAssetBytes(pid, effectivePlanAssetId).catch(() => null) : null;
    if (effectivePlanAssetId && !plan) return { error: `找不到平面图资产 ${effectivePlanAssetId}` };
    if (effectivePlanAssetId && plan) await markLayoutConfirmed(pid, effectivePlanAssetId);
    const client = openaiViaGateway();

    // ① prompt-writer 子 agent：意图 → 英文五层主图 prompt（不占大脑上下文）
    const frontPrompt = await writeImagePrompt({ intent, identity, kind: mode === 'concept' ? 'concept' : plan ? 'plan' : 'front' });
    console.log(`[render] mode=${plan ? 'plan' : views.length ? 'views' : 'single'} views=${views.length} n=${n} q=${quality} 预计生图≈${n * (1 + views.length)} 张`);

    // ② 主图 best-of-N（文生图 或 平面图条件化）
    const heroCands: { bytes: Uint8Array; assetId: string; url: string; score: number; failN: number }[] = [];
    if (plan) {
      const instr = withRenderStyle(
        `${identity}\n\nThe attached image is a TOP-DOWN FLOOR PLAN of this exhibition booth — each labeled block is a functional zone at its real position and size. Render a photorealistic 3D booth that EXACTLY follows this floor plan (every zone's position, footprint, size and shape must match, including L-shaped counters). ${frontPrompt}`,
      );
      const raw = (await Promise.all(Array.from({ length: n }, () => generateImageFromRefs([plan], instr).catch(() => null)))).filter(
        (b): b is Uint8Array => b !== null,
      );
      if (!raw.length) return { error: '主图生成失败（按平面图）' };
      for (const b of raw) {
        const a = await saveAsset(pid, b, { kind: 'booth-image', prompt: 'plan-conditioned front', parentId: effectivePlanAssetId });
        const insp = await inspectImage(b, criteria);
        await addInspection(pid, a.id, toInspectionResult(insp, MODEL_IDS.inspect));
        heroCands.push({ bytes: b, assetId: a.id, url: a.url, score: insp.score, failN: insp.fails.length });
      }
    } else {
      const full = withRenderStyle(`${identity}\n\n${frontPrompt}`);
      const raw = (
        await Promise.all(
          Array.from({ length: n }, async () => {
            const r = await client.images.generate({ model: MODEL_IDS.image, prompt: full, size, quality, n: 1 });
            const b64 = r.data?.[0]?.b64_json ?? '';
            return b64 ? new Uint8Array(Buffer.from(b64, 'base64')) : null;
          }),
        )
      ).filter((b): b is Uint8Array<ArrayBuffer> => b !== null);
      if (!raw.length) return { error: '主图生成失败（无返回）' };
      for (const b of raw) {
        const a = await saveAsset(pid, b, { kind: 'booth-image', prompt: frontPrompt });
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
      const single: Deliverable = { type: 'single', assets, recommendedId: hero.assetId, ...(hero.failN ? { issues: [`主图有 ${hero.failN} 处客观待改`] } : {}) };
      await recordRunDeliverable(pid, runId, single);
      return single;
    }

    // ④ 有 views → 进化链多视角：以 [（平面图）+ 主图 + 已通过视角] 为累积参考，逐角度判一致性、门控
    const assets: DeliverableAsset[] = [{ assetId: hero.assetId, url: hero.url, role: 'hero', status: 'recommended', score: hero.score }];
    const issues: string[] = [];
    const refPool: Uint8Array[] = plan ? [plan, hero.bytes] : [hero.bytes];
    for (const view of views) {
      const instr = withRenderStyle(
        `${identity}\n\nUsing the attached reference image(s) of THIS exact exhibition booth, render the SAME booth from ${view}. Keep every structural part, material, color, brand placement, furniture COUNT and lighting identical to the reference(s); only the camera viewpoint changes — do NOT add, remove, move or redesign anything.`,
      );
      const cands = (await Promise.all(Array.from({ length: n }, () => generateImageFromRefs(refPool, instr).catch(() => null)))).filter(
        (b): b is Uint8Array => b !== null,
      );
      if (!cands.length) {
        assets.push({ assetId: '', url: '', role: 'view', view, status: 'failed' });
        issues.push(`${view}：生成失败`);
        continue;
      }
      const judged = await Promise.all(cands.map(async (b) => ({ b, c: await inspectConsistency(hero.bytes, b, view) })));
      judged.sort((x, y) => y.c.consistencyScore - x.c.consistencyScore);
      const best = judged[0];
      const a = await saveAsset(pid, best.b, { kind: 'booth-image', prompt: `${view} (ref-conditioned)`, parentId: hero.assetId });
      await addInspection(pid, a.id, consistencyToInspectionResult(best.c, view, GATE, MODEL_IDS.inspect));
      const passed = best.c.sameBooth && best.c.consistencyScore >= GATE;
      if (passed) refPool.push(best.b); // 门控：只有通过的进参考池，防漂移传染
      assets.push({ assetId: a.id, url: a.url, role: 'view', view, status: passed ? 'ok' : 'weak', score: best.c.consistencyScore });
      if (!passed) issues.push(`${view}：一致性偏弱(${best.c.consistencyScore}<${GATE})，可 revise 或重出`);
    }
    const deliverable: Deliverable = { type: plan ? 'plan-conditioned' : 'view-set', assets, recommendedId: hero.assetId, ...(issues.length ? { issues } : {}) };
    await recordRunDeliverable(pid, runId, deliverable);
    return deliverable;
  },
});
