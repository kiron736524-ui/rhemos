import { readFile } from 'node:fs/promises';
import path from 'node:path';

export const runtime = 'nodejs';

// 读出本地 .data 下的生成图（前端 <img> 通过此路由访问）。
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const project = new URL(req.url).searchParams.get('project') ?? 'default';
  if (!/^[\w.-]+$/.test(id) || !/^[\w.-]+$/.test(project)) {
    return new Response('bad request', { status: 400 });
  }
  const file = path.join(process.cwd(), '.data', 'projects', project, 'assets', `${id}.png`);
  try {
    const bytes = await readFile(file);
    return new Response(new Uint8Array(bytes), {
      headers: { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' },
    });
  } catch {
    return new Response('not found', { status: 404 });
  }
}
