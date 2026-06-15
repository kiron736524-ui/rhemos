import { NextResponse } from 'next/server';
import { readState } from '@/lib/storage';

export const runtime = 'nodejs';

// 前端工作台读取当前项目状态（spec + assets），每轮 agent 结束后刷新 SpecCard / AssetGallery。
export async function GET(_req: Request, ctx: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await ctx.params;
  if (!/^[\w-]+$/.test(projectId)) return NextResponse.json({ error: 'bad project id' }, { status: 400 });
  const s = await readState(projectId);
  return NextResponse.json(
    { id: s.id, spec: s.spec ?? null, assets: s.assets, updatedAt: s.updatedAt },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
