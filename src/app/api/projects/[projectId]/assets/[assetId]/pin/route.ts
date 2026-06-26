import { NextResponse } from 'next/server';
import { setAssetPinned } from '@/lib/storage';

export const runtime = 'nodejs';

// 资产库置顶开关。POST { pinned?: boolean }（缺省 = true）
export async function POST(req: Request, ctx: { params: Promise<{ projectId: string; assetId: string }> }) {
  const { projectId, assetId } = await ctx.params;
  if (!/^[\w-]+$/.test(projectId) || !/^[\w-]+$/.test(assetId)) return NextResponse.json({ error: 'bad id' }, { status: 400 });
  let body: { pinned?: unknown } = {};
  try {
    body = (await req.json()) as { pinned?: unknown };
  } catch {
    /* 空 body = 置顶 */
  }
  const pinned = body.pinned !== false;
  try {
    await setAssetPinned(projectId, assetId, pinned);
    return NextResponse.json({ ok: true, pinned }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'pin failed' }, { status: 404 });
  }
}
