import { NextResponse } from 'next/server';
import { loadAttachment } from '@/lib/storage';

export const runtime = 'nodejs';

const valid = (id: string) => /^[\w-]+$/.test(id);

export async function GET(_req: Request, ctx: { params: Promise<{ projectId: string; attachmentId: string }> }) {
  const { projectId, attachmentId } = await ctx.params;
  if (!valid(projectId) || !valid(attachmentId)) return new Response('bad request', { status: 400 });
  try {
    const { attachment, bytes } = await loadAttachment(projectId, attachmentId);
    return new Response(new Uint8Array(bytes), {
      headers: {
        'Content-Type': attachment.mediaType,
        'Content-Disposition': `inline; filename="${encodeURIComponent(attachment.filename)}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }
}
