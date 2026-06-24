import { NextResponse } from 'next/server';
import { saveAttachment } from '@/lib/storage';
import { createBasicAssetAnalysis } from '@/lib/asset-analysis';
import type { FileUIPart } from 'ai';

export const runtime = 'nodejs';

const valid = (id: string) => /^[\w-]+$/.test(id);
const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;
const MAX_FILES = 8;

export async function POST(req: Request, ctx: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await ctx.params;
  if (!valid(projectId)) return NextResponse.json({ error: 'bad project id' }, { status: 400 });
  const form = await req.formData();
  const files = form.getAll('files').filter((x): x is File => x instanceof File).slice(0, MAX_FILES);
  if (!files.length) return NextResponse.json({ error: 'no files' }, { status: 400 });

  const out: FileUIPart[] = [];
  for (const f of files) {
    const bytes = new Uint8Array(await f.arrayBuffer());
    if (bytes.byteLength > MAX_ATTACHMENT_BYTES) {
      return NextResponse.json({ error: `${f.name} is too large` }, { status: 413 });
    }
    const attachment = await saveAttachment(projectId, bytes, {
      filename: f.name || 'attachment',
      mediaType: f.type || 'application/octet-stream',
    });
    out.push({ type: 'file', mediaType: attachment.mediaType, filename: attachment.filename, url: attachment.url });
    // D33：上传后自动生成基础素材分析（不调模型）；失败仅告警、绝不阻断上传。
    try {
      await createBasicAssetAnalysis(projectId, attachment.id);
    } catch (e) {
      console.warn(`[attachments] 基础分析失败（${attachment.filename}）：${e instanceof Error ? e.message : '未知错误'}`);
    }
  }

  return NextResponse.json({ files: out }, { headers: { 'Cache-Control': 'no-store' } });
}
