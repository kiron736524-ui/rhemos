import { tool } from 'ai';
import { z } from 'zod';
import { DEFAULT_IMAGE_QUALITY, withRenderStyle } from '@/models/gateway';
import { imageProvider, IMAGE_PROVIDER, IMAGE_MODEL } from '@/models/image-providers';
import { appendRunEvent, loadAssetBytes, projectIdFromContext, readState, recordRunDeliverable, runIdFromContext, saveAsset, saveRenderInputSnapshot } from '@/lib/storage';
import { selectUsableAttachmentsFromAnalyses, toRenderInputRefs } from '@/lib/asset-analysis';
import { writeImagePrompt } from '@/agent/prompt-writer';
import type { Deliverable, RenderInputRef } from '@/lib/types';

export const reviseAsset = tool({
  description:
    '参考图局部编辑（保持其余 100% 不变，只改一处客观硬伤）：加载原图作参考，只改你指定的局部、其余与原图一致。比"从头重生"一致性高得多——单视角全幅图上精修单点问题用这个。你只给**中文**要改什么，内部 prompt 专家翻成精确英文指令；identity/判图要点自读 spec。返回统一交付物。',
  inputSchema: z.object({
    parentAssetId: z.string().describe('被修的原资产 id'),
    fix: z.string().describe('要修正的局部（**中文**，只说"改什么"，如"洽谈区只留一张圆桌配 4 把白椅，删掉多出来的椅子和第二张桌子"）'),
  }),
  execute: async ({ parentAssetId, fix }, opts) => {
    const ctx = (opts as { experimental_context?: unknown }).experimental_context;
    const pid = projectIdFromContext(ctx);
    const runId = runIdFromContext(ctx);
    const parentBytes = await loadAssetBytes(pid, parentAssetId).catch(() => null);
    if (!parentBytes) return { error: `找不到原资产 ${parentAssetId}` };
    const s = await readState(pid);
    const identity = s.spec?.identity ?? '';
    // 生图渠道 / 模型已锁定 gpt-image-2 / fal（见 image-providers.ts），仅作元数据记录。
    const providerName = IMAGE_PROVIDER;
    const imageModel = IMAGE_MODEL;
    // prompt-writer：中文 fix → 英文"只改一处、其余不变"指令
    const instruction = withRenderStyle(await writeImagePrompt({ intent: fix, identity, kind: 'revise', trace: { projectId: pid, runId, purpose: 'revision prompt' } }));
    // D32 输入快照：edit 前固化（基于哪张图、什么 fix prompt、什么 spec/layout），provider 失败也留证据。
    const parentRef: RenderInputRef = { id: parentAssetId, kind: 'asset', role: 'previous_render', url: `/api/assets/${parentAssetId}?project=${pid}` };
    // D33：带上本项目被选用的上传素材（selectedAttachments 优先，空则 fallback 分析推导）；parentAssetId 始终作为 sourceAssetIds。
    const selAtt = s.selectedAttachments?.length ? s.selectedAttachments : await selectUsableAttachmentsFromAnalyses(pid);
    const attRefs = toRenderInputRefs(selAtt, s.attachments ?? []);
    const attIds = attRefs.map((r) => r.id);
    const q = DEFAULT_IMAGE_QUALITY;
    const snap = await saveRenderInputSnapshot(pid, {
      runId,
      mode: 'revise',
      provider: providerName,
      model: imageModel,
      quality: q,
      size: '1024x1024',
      prompt: instruction,
      intent: fix,
      operation: 'revision',
      specSummary: { hasSpec: !!s.spec, identity: s.spec?.identity, invariants: s.spec?.invariants, selfCheckCriteria: s.spec?.selfCheckCriteria, updatedAt: s.spec?.updatedAt },
      layoutSummary: s.layout ? { status: s.layout.status, planAssetId: s.layout.planAssetId, proposal: s.layout.proposal } : undefined,
      refs: [...attRefs, parentRef],
    });
    const t0 = Date.now();
    const bytes = await imageProvider.editFromRefs([parentBytes], instruction, { quality: q, size: '1024x1024' });
    const durationMs = Date.now() - t0;
    if (!bytes) return { error: '局部修复未返回图（编辑模型无输出）' };
    const asset = await saveAsset(pid, bytes, { kind: 'booth-image', prompt: `revise: ${fix}`, parentId: parentAssetId, provider: providerName, model: imageModel, quality: q, size: '1024x1024', mode: 'revise', durationMs, renderInputId: snap.id, sourceAssetIds: [parentAssetId], sourceAttachmentIds: attIds });
    // 统一交付协议（D24 契约①）：单张修订图。判图/打分已删除（D39），交付不再带 score/自动 issues。
    const deliverable: Deliverable = {
      type: 'revision',
      assets: [{ assetId: asset.id, url: asset.url, role: 'revision', status: 'recommended' }],
      recommendedId: asset.id,
    };
    await recordRunDeliverable(pid, runId, deliverable);
    await appendRunEvent(pid, runId, { type: 'tool', toolName: 'revise_asset', outputSummary: { provider: providerName, model: imageModel, mode: 'revise', quality: q, durationMs } });
    return deliverable;
  },
});
