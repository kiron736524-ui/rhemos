import { NextResponse } from 'next/server';
import { deleteProject } from '@/lib/storage';

export const runtime = 'nodejs';

// 项目管理：删除项目（default 受保护，storage 内部忽略）。
export async function DELETE(_req: Request, ctx: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await ctx.params;
  if (!/^[\w-]+$/.test(projectId)) return NextResponse.json({ error: 'bad project id' }, { status: 400 });
  await deleteProject(projectId);
  return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
}
