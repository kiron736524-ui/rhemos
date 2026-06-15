import { NextResponse } from 'next/server';
import { saveAsset } from '@/lib/storage';

export const runtime = 'nodejs';

const valid = (id: string) => /^[\w-]+$/.test(id);

// 把前端截图（布局编辑器定稿的俯视平面图）存为 reference asset，供 render_from_plan 作硬参考。
export async function POST(req: Request, ctx: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await ctx.params;
  if (!valid(projectId)) return NextResponse.json({ error: 'bad project id' }, { status: 400 });
  let body: { png?: string };
  try {
    body = (await req.json()) as { png?: string };
  } catch {
    return NextResponse.json({ error: 'bad json' }, { status: 400 });
  }
  const png = body.png ?? '';
  const b64 = png.startsWith('data:') ? png.slice(png.indexOf(',') + 1) : png;
  if (!b64) return NextResponse.json({ error: 'no png data' }, { status: 400 });
  const bytes = new Uint8Array(Buffer.from(b64, 'base64'));
  const asset = await saveAsset(projectId, bytes, { kind: 'reference', prompt: '布局平面图（用户在编辑器定稿）' });
  return NextResponse.json({ assetId: asset.id, url: asset.url });
}
