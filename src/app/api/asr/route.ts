import { NextResponse } from 'next/server';
import { FunAsrError, transcribeWithFunAsr, type FunAsrFormat } from '@/lib/asr/funasr';
import { cleanupTranscript } from '@/lib/asr/cleanup';

export const runtime = 'nodejs';
export const maxDuration = 60;

const MAX_AUDIO_BYTES = 10 * 1024 * 1024; // 10MB

function detectFormat(mime: string): FunAsrFormat {
  const l = mime.toLowerCase();
  if (l.includes('wav') || l.includes('wave')) return 'wav';
  if (l.includes('mpeg') || l.includes('mp3')) return 'mp3';
  if (l.includes('pcm')) return 'pcm';
  return 'wav';
}

// 录音 → Fun-ASR 转写（DashScope 直连）→ DeepSeek V4 Flash 清理（Gateway）→ {raw, cleaned}
export async function POST(req: Request) {
  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: '请求体无效' }, { status: 400 });
  }

  const file = formData.get('audio');
  if (!(file instanceof File)) return NextResponse.json({ error: '缺少音频文件 (audio)' }, { status: 400 });
  if (file.size === 0) return NextResponse.json({ error: '音频为空' }, { status: 400 });
  if (file.size > MAX_AUDIO_BYTES) return NextResponse.json({ error: '音频过大（>10MB），请缩短录音' }, { status: 400 });

  const buffer = Buffer.from(await file.arrayBuffer());
  const format = detectFormat(file.type || '');
  const startedAt = Date.now();

  let raw = '';
  let asrMs = 0;
  try {
    const r = await transcribeWithFunAsr(buffer, format);
    raw = r.raw;
    asrMs = r.durationMs;
  } catch (e) {
    console.warn('[asr] fun-asr failed', e);
    const msg = e instanceof FunAsrError ? `语音识别失败：${e.message}` : '语音识别失败';
    return NextResponse.json({ error: msg }, { status: 502 });
  }

  const trimmedRaw = raw.trim();
  if (!trimmedRaw) {
    return NextResponse.json({ raw: '', cleaned: '', cleanupOk: true, asrMs, durationMs: Date.now() - startedAt, note: 'empty' });
  }

  let cleaned = trimmedRaw;
  let cleanupOk = true;
  try {
    const c = await cleanupTranscript(trimmedRaw);
    if (c) cleaned = c;
  } catch (e) {
    cleanupOk = false;
    console.warn('[asr] cleanup failed, fallback to raw', e);
  }

  return NextResponse.json({ raw: trimmedRaw, cleaned, cleanupOk, asrMs, durationMs: Date.now() - startedAt });
}
