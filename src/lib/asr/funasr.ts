import { WebSocket } from 'undici';
import { randomUUID } from 'node:crypto';

// 阿里云百炼 Fun-ASR 实时语音识别（WebSocket 双工）。直连，唯一非 Gateway 例外。
// 协议移植自旧 rhemax（已验证）；模型默认用最新 fun-asr-realtime-2026-02-28。
const ENDPOINT = 'wss://dashscope.aliyuncs.com/api-ws/v1/inference/';
const FUN_ASR_MODEL = process.env.FUN_ASR_MODEL || 'fun-asr-realtime-2026-02-28';
const TASK_TIMEOUT_MS = 30_000;
const FRAME_SIZE = 3_200;

export type FunAsrFormat = 'wav' | 'mp3' | 'pcm';

export interface FunAsrResult {
  raw: string;
  durationMs: number;
}

export class FunAsrError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = 'FunAsrError';
  }
}

interface DashscopeMessage {
  header?: { event?: string; error_code?: string; error_message?: string };
  payload?: { output?: { sentence?: { text?: string; sentence_end?: boolean } } };
}

export async function transcribeWithFunAsr(
  audio: Buffer,
  format: FunAsrFormat = 'wav',
): Promise<FunAsrResult> {
  const apiKey = process.env.DASHSCOPE_API_KEY;
  if (!apiKey) throw new FunAsrError('NO_KEY', '服务端未配置 DASHSCOPE_API_KEY');
  if (!audio.length) throw new FunAsrError('EMPTY_AUDIO', '音频缓冲为空');

  const taskId = randomUUID().replaceAll('-', '');
  const startedAt = Date.now();
  const sentences: string[] = [];

  return new Promise<FunAsrResult>((resolve, reject) => {
    const ws = new WebSocket(ENDPOINT, { headers: { Authorization: `Bearer ${apiKey}` } });
    let settled = false;
    const finish = (err: Error | null, value?: FunAsrResult) => {
      if (settled) return;
      settled = true;
      try {
        ws.close();
      } catch {
        /* ignore */
      }
      clearTimeout(timer);
      if (err) reject(err);
      else if (value) resolve(value);
    };
    const timer = setTimeout(
      () => finish(new FunAsrError('TIMEOUT', 'fun-asr 30s 内未完成转写')),
      TASK_TIMEOUT_MS,
    );

    ws.addEventListener('open', () => {
      ws.send(
        JSON.stringify({
          header: { action: 'run-task', task_id: taskId, streaming: 'duplex' },
          payload: {
            task_group: 'audio',
            task: 'asr',
            function: 'recognition',
            model: FUN_ASR_MODEL,
            parameters: { format, sample_rate: 16000, semantic_punctuation_enabled: true },
            input: {},
          },
        }),
      );
    });

    ws.addEventListener('message', (event) => {
      const text = decodeMessage(event.data);
      if (!text) return;
      let msg: DashscopeMessage;
      try {
        msg = JSON.parse(text) as DashscopeMessage;
      } catch {
        return;
      }
      const ev = msg.header?.event;
      if (ev === 'task-started') {
        sendAudioFrames(ws, audio).then(
          () => {
            try {
              ws.send(
                JSON.stringify({
                  header: { action: 'finish-task', task_id: taskId, streaming: 'duplex' },
                  payload: { input: {} },
                }),
              );
            } catch (e) {
              finish(new FunAsrError('SEND_FAIL', String(e)));
            }
          },
          (e) => finish(new FunAsrError('SEND_FAIL', String(e))),
        );
        return;
      }
      if (ev === 'result-generated') {
        const s = msg.payload?.output?.sentence;
        if (s?.sentence_end && typeof s.text === 'string') sentences.push(s.text);
        return;
      }
      if (ev === 'task-finished') {
        finish(null, { raw: sentences.join(''), durationMs: Date.now() - startedAt });
        return;
      }
      if (ev === 'task-failed') {
        finish(
          new FunAsrError(
            String(msg.header?.error_code || 'TASK_FAILED'),
            String(msg.header?.error_message || 'fun-asr 任务失败'),
          ),
        );
      }
    });

    ws.addEventListener('error', (event) => {
      finish(new FunAsrError('WS_ERROR', (event as { message?: string }).message || 'WebSocket 错误'));
    });
    ws.addEventListener('close', () => finish(new FunAsrError('WS_CLOSED', 'fun-asr 连接异常关闭')));
  });
}

function decodeMessage(data: unknown): string | null {
  if (typeof data === 'string') return data;
  if (data instanceof ArrayBuffer) return new TextDecoder().decode(data);
  if (ArrayBuffer.isView(data)) return new TextDecoder().decode(data as ArrayBufferView);
  return null;
}

async function sendAudioFrames(ws: WebSocket, audio: Buffer): Promise<void> {
  for (let offset = 0; offset < audio.length; offset += FRAME_SIZE) {
    if (ws.readyState !== ws.OPEN) throw new Error('WebSocket 已关闭，发送中断');
    ws.send(audio.subarray(offset, Math.min(offset + FRAME_SIZE, audio.length)));
    if (offset % (FRAME_SIZE * 8) === 0) await new Promise<void>((r) => setImmediate(r));
  }
}
