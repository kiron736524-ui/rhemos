import { NextResponse } from 'next/server';
import { loadConversation, saveConversation } from '@/lib/storage';

export const runtime = 'nodejs';

const valid = (id: string) => /^[\w-]+$/.test(id);
const MAX_CONVERSATION_BYTES = 10 * 1024 * 1024; // 10MB 对话上限（防 conversation.json 无限膨胀；附件资产化是 Phase 5）

// 读取项目的对话历史（切换/重载项目时恢复 useChat messages）。
export async function GET(_req: Request, ctx: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await ctx.params;
  if (!valid(projectId)) return NextResponse.json({ error: 'bad project id' }, { status: 400 });
  const messages = await loadConversation(projectId);
  return NextResponse.json({ messages }, { headers: { 'Cache-Control': 'no-store' } });
}

// 每轮 agent 结束后，前端把完整 messages 存盘（覆盖式）。
export async function POST(req: Request, ctx: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await ctx.params;
  if (!valid(projectId)) return NextResponse.json({ error: 'bad project id' }, { status: 400 });
  let body: { messages?: unknown };
  try {
    body = (await req.json()) as { messages?: unknown };
  } catch {
    return NextResponse.json({ error: 'bad json' }, { status: 400 });
  }
  if (!Array.isArray(body.messages)) return NextResponse.json({ error: 'messages must be an array' }, { status: 400 });
  if (JSON.stringify(body.messages).length > MAX_CONVERSATION_BYTES) {
    return NextResponse.json({ error: 'conversation too large' }, { status: 413 });
  }
  await saveConversation(projectId, body.messages);
  return NextResponse.json({ ok: true });
}
