import { NextResponse } from 'next/server';
import { promoteCandidateAsset } from '@/lib/storage';

export const runtime = 'nodejs';

export async function POST(_req: Request, ctx: { params: Promise<{ projectId: string; assetId: string }> }) {
  const { projectId, assetId } = await ctx.params;
  if (!/^[\w-]+$/.test(projectId) || !/^[\w-]+$/.test(assetId)) {
    return NextResponse.json({ error: 'bad id' }, { status: 400 });
  }
  try {
    const asset = await promoteCandidateAsset(projectId, assetId);
    return NextResponse.json({ asset }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'promote failed';
    return NextResponse.json({ error: message }, { status: 404 });
  }
}
