import { NextResponse } from 'next/server';
import { listProjects } from '@/lib/storage';

export const runtime = 'nodejs';

// 左侧项目面板：列出所有项目（最近更新在前）。
export async function GET() {
  const projects = await listProjects();
  return NextResponse.json({ projects }, { headers: { 'Cache-Control': 'no-store' } });
}
