import { NextResponse } from 'next/server';
import { renameAsset } from '@/lib/storage';

export const runtime = 'nodejs';

// 资产库重命名（用户自定义显示名）。POST { name }
export async function POST(req: Request, ctx: { params: Promise<{ projectId: string; assetId: string }> }) {
  const { projectId, assetId } = await ctx.params;
  if (!/^[\w-]+$/.test(projectId) || !/^[\w-]+$/.test(assetId)) return NextResponse.json({ error: 'bad id' }, { status: 400 });
  let body: { name?: unknown };
  try {
    body = (await req.json()) as { name?: unknown };
  } catch {
    return NextResponse.json({ error: 'bad json' }, { status: 400 });
  }
  if (typeof body.name !== 'string') return NextResponse.json({ error: 'name required' }, { status: 400 });
  try {
    await renameAsset(projectId, assetId, body.name);
    return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'rename failed' }, { status: 404 });
  }
}
