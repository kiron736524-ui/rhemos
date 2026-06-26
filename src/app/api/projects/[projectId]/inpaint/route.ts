import { NextResponse } from 'next/server';
import { DEFAULT_IMAGE_QUALITY, withRenderStyle } from '@/models/gateway';
import { imageProvider, IMAGE_MODEL, IMAGE_PROVIDER } from '@/models/image-providers';
import { buildMaskedEditInstruction, dataUrlToBytes } from '@/lib/image-edit';
import { writeImagePrompt } from '@/agent/prompt-writer';
import {
  appendRunEvent,
  buildSnapshotSummaries,
  createRun,
  finishRun,
  loadAssetBytes,
  readState,
  recordRunDeliverable,
  saveAsset,
  saveRenderInputSnapshot,
} from '@/lib/storage';
import type { Deliverable, RenderInputRef } from '@/lib/types';

export const runtime = 'nodejs';
export const maxDuration = 600; // gpt-image-2 编辑较慢

const valid = (id: string) => /^[\w-]+$/.test(id);

/**
 * 画笔涂抹局部编辑（直连，不经大脑）。前端把「原图 + 黑白遮罩 + 中文指令」发来：
 *   - 原图：资产库 assetId（优先）或 originalImage data URL（拖入未入库的图）
 *   - 遮罩：mask data URL（黑白，白=改）
 * 内部：prompt-writer 把中文指令译成英文 → 套蒙版编辑外壳 → falEditFromRefs([原图, 遮罩], prompt) → 落新资产。
 */
export async function POST(req: Request, ctx: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await ctx.params;
  if (!valid(projectId)) return NextResponse.json({ error: 'bad project id' }, { status: 400 });

  let body: { assetId?: string; originalImage?: string; mask?: string; instruction?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'bad json' }, { status: 400 });
  }

  const instruction = (body.instruction ?? '').trim();
  if (!instruction) return NextResponse.json({ error: '需要修改指令' }, { status: 400 });
  const maskBytes = body.mask ? dataUrlToBytes(body.mask) : null;
  if (!maskBytes) return NextResponse.json({ error: '需要有效的遮罩图' }, { status: 400 });

  // 原图：优先资产库 assetId，其次 data URL（拖入但尚未入库的图）。
  const assetId = body.assetId && valid(body.assetId) ? body.assetId : undefined;
  let originalBytes: Uint8Array | null = null;
  if (assetId) originalBytes = await loadAssetBytes(projectId, assetId).catch(() => null);
  else if (body.originalImage) originalBytes = dataUrlToBytes(body.originalImage);
  if (!originalBytes) return NextResponse.json({ error: '找不到原图' }, { status: 400 });

  const s = await readState(projectId);
  const identity = s.spec?.identity ?? '';
  const run = await createRun(projectId, { imageLimit: 1 });
  try {
    // 中文指令 → 英文「只改一处」指令（复用 prompt-writer revise 档）→ 套蒙版编辑外壳 → 画风锚。
    const englishFix = await writeImagePrompt({ intent: instruction, identity, kind: 'revise', trace: { projectId, runId: run.id, purpose: 'inpaint edit prompt' } });
    const fullPrompt = withRenderStyle(buildMaskedEditInstruction(englishFix));
    const q = DEFAULT_IMAGE_QUALITY;
    const size = '1024x1024' as const;
    const refs: RenderInputRef[] = [
      { id: assetId ?? 'inpaint-original', kind: 'asset', role: 'previous_render' },
      { id: 'inpaint-mask', kind: 'asset', role: 'other' },
    ];
    const snap = await saveRenderInputSnapshot(projectId, {
      runId: run.id,
      mode: 'revise',
      provider: IMAGE_PROVIDER,
      model: IMAGE_MODEL,
      quality: q,
      size,
      prompt: fullPrompt,
      intent: instruction,
      operation: 'image-edit',
      ...buildSnapshotSummaries(s),
      refs,
    });
    const t0 = Date.now();
    const bytes = await imageProvider.editFromRefs([originalBytes, maskBytes], fullPrompt, { quality: q, size, signal: req.signal });
    const durationMs = Date.now() - t0;
    if (!bytes) {
      await finishRun(projectId, run.id, 'failed', { error: '局部修复未返回图' });
      return NextResponse.json({ error: '局部修复未返回图（编辑模型无输出）' }, { status: 502 });
    }
    const asset = await saveAsset(projectId, bytes, {
      kind: 'booth-image',
      prompt: `inpaint: ${instruction}`,
      parentId: assetId,
      provider: IMAGE_PROVIDER,
      model: IMAGE_MODEL,
      quality: q,
      size,
      mode: 'revise',
      durationMs,
      renderInputId: snap.id,
      sourceAssetIds: assetId ? [assetId] : [],
    });
    const deliverable: Deliverable = { type: 'revision', assets: [{ assetId: asset.id, url: asset.url, role: 'revision', status: 'recommended' }], recommendedId: asset.id };
    await recordRunDeliverable(projectId, run.id, deliverable);
    await appendRunEvent(projectId, run.id, { type: 'tool', toolName: 'inpaint', outputSummary: { provider: IMAGE_PROVIDER, model: IMAGE_MODEL, durationMs } });
    await finishRun(projectId, run.id, 'completed');
    return NextResponse.json({ asset }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    await finishRun(projectId, run.id, 'failed', { error: e instanceof Error ? e.message : 'inpaint failed' });
    return NextResponse.json({ error: e instanceof Error ? e.message : 'inpaint failed' }, { status: 500 });
  }
}
