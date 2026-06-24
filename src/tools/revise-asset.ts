import { tool } from 'ai';
import { z } from 'zod';
import { MODEL_IDS, withRenderStyle } from '@/models/gateway';
import { imageProvider, resolveActiveImageProvider } from '@/models/image-providers';
import { addInspection, appendRunEvent, loadAssetBytes, projectIdFromContext, readState, recordRunDeliverable, runIdFromContext, saveAsset } from '@/lib/storage';
import { inspectImage, toInspectionResult } from '@/agent/inspect';
import { writeImagePrompt } from '@/agent/prompt-writer';
import type { Deliverable } from '@/lib/types';

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
    const criteria = s.spec?.selfCheckCriteria || fix;
    let providerName: string, imageModel: string;
    try {
      const p = resolveActiveImageProvider();
      providerName = p.name;
      imageModel = p.model;
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e), code: 'IMAGE_PROVIDER_INVALID' };
    }
    // prompt-writer：中文 fix → 英文"只改一处、其余不变"指令
    const instruction = withRenderStyle(await writeImagePrompt({ intent: fix, identity, kind: 'revise' }));
    const t0 = Date.now();
    const bytes = await imageProvider.editFromRefs([parentBytes], instruction);
    const durationMs = Date.now() - t0;
    if (!bytes) return { error: '局部修复未返回图（编辑模型无输出）' };
    const asset = await saveAsset(pid, bytes, { kind: 'booth-image', prompt: `revise: ${fix}`, parentId: parentAssetId, provider: providerName, model: imageModel, mode: 'revise', durationMs });
    const insp = await inspectImage(bytes, criteria);
    await addInspection(pid, asset.id, toInspectionResult(insp, MODEL_IDS.inspect));
    // 统一交付协议（D24 契约①）：单张修订图。
    const deliverable: Deliverable = {
      type: 'revision',
      assets: [{ assetId: asset.id, url: asset.url, role: 'revision', status: 'recommended', score: insp.score }],
      recommendedId: asset.id,
      ...(insp.fails.length ? { issues: insp.fails } : {}),
    };
    await recordRunDeliverable(pid, runId, deliverable);
    await appendRunEvent(pid, runId, { type: 'tool', toolName: 'revise_asset', outputSummary: { provider: providerName, model: imageModel, mode: 'revise', durationMs } });
    return deliverable;
  },
});
