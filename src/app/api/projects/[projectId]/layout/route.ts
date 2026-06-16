import { NextResponse } from 'next/server';
import { markLayoutSkipped } from '@/lib/storage';

export const runtime = 'nodejs';

const valid = (id: string) => /^[\w-]+$/.test(id);

export async function POST(req: Request, ctx: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await ctx.params;
  if (!valid(projectId)) return NextResponse.json({ error: 'bad project id' }, { status: 400 });
  const body = (await req.json().catch(() => ({}))) as { decision?: string };
  if (body.decision !== 'skipped') return NextResponse.json({ error: 'unsupported decision' }, { status: 400 });
  await markLayoutSkipped(projectId);
  return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
}
