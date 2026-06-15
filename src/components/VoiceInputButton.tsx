'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

// 录音 → /api/asr（Fun-ASR + DeepSeek 清理）→ 回填输入框。
// 交互照搬 rhemax：点击开始/停止(toggle)、60s 自动停、MM:SS 计时、状态指示、结果追加。
const MAX_RECORD_MS = 60_000;
const TARGET_SAMPLE_RATE = 16_000;

type VoiceState = 'idle' | 'recording' | 'uploading' | 'error';

interface AsrResponse {
  raw: string;
  cleaned: string;
  cleanupOk: boolean;
  error?: string;
}

function pickRecorderMime(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined;
  for (const c of ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4;codecs=mp4a.40.2', 'audio/mp4', 'audio/ogg;codecs=opus']) {
    if (MediaRecorder.isTypeSupported(c)) return c;
  }
  return undefined;
}

// 浏览器原始录音 → 16kHz 单声道 16-bit PCM WAV（Fun-ASR 要求）
async function blobToWav16kMono(blob: Blob): Promise<Blob> {
  const arrayBuf = await blob.arrayBuffer();
  type Ctor = typeof AudioContext;
  const ContextCtor: Ctor =
    window.AudioContext || (window as unknown as { webkitAudioContext?: Ctor }).webkitAudioContext!;
  if (!ContextCtor) throw new Error('当前浏览器不支持 AudioContext');
  const decodeCtx = new ContextCtor();
  let decoded: AudioBuffer;
  try {
    decoded = await decodeCtx.decodeAudioData(arrayBuf.slice(0));
  } finally {
    void decodeCtx.close();
  }
  const targetLength = Math.max(1, Math.ceil(decoded.duration * TARGET_SAMPLE_RATE));
  const offline = new OfflineAudioContext(1, targetLength, TARGET_SAMPLE_RATE);
  const source = offline.createBufferSource();
  source.buffer = decoded;
  source.connect(offline.destination);
  source.start(0);
  const rendered = await offline.startRendering();
  const samples = rendered.getChannelData(0);
  const pcm = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return encodeWav(pcm, TARGET_SAMPLE_RATE);
}

function encodeWav(pcm: Int16Array, sampleRate: number): Blob {
  const dataSize = pcm.length * 2;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  view.setUint32(0, 0x52494646, false); // RIFF
  view.setUint32(4, 36 + dataSize, true);
  view.setUint32(8, 0x57415645, false); // WAVE
  view.setUint32(12, 0x666d7420, false); // "fmt "
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  view.setUint32(36, 0x64617461, false); // data
  view.setUint32(40, dataSize, true);
  new Int16Array(buffer, 44).set(pcm);
  return new Blob([buffer], { type: 'audio/wav' });
}

const MicIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <rect x="9" y="2" width="6" height="12" rx="3" /><path d="M5 10a7 7 0 0 0 14 0M12 17v4" />
  </svg>
);

export default function VoiceInputButton({
  disabled,
  onTranscribed,
}: {
  disabled?: boolean;
  onTranscribed: (text: string) => void;
}) {
  const [state, setState] = useState<VoiceState>('idle');
  const [seconds, setSeconds] = useState(0);
  const [errorMsg, setErrorMsg] = useState('');
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const autoStopRef = useRef<number | null>(null);
  const errorResetRef = useRef<number | null>(null);

  const cleanupStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (autoStopRef.current !== null) {
      window.clearTimeout(autoStopRef.current);
      autoStopRef.current = null;
    }
  }, []);

  const flashError = useCallback((message: string) => {
    setErrorMsg(message);
    setState('error');
    if (errorResetRef.current !== null) window.clearTimeout(errorResetRef.current);
    errorResetRef.current = window.setTimeout(() => {
      setState('idle');
      setSeconds(0);
      setErrorMsg('');
      errorResetRef.current = null;
    }, 2500);
  }, []);

  useEffect(
    () => () => {
      cleanupStream();
      if (errorResetRef.current !== null) window.clearTimeout(errorResetRef.current);
    },
    [cleanupStream],
  );

  useEffect(() => {
    if (state !== 'recording') return undefined;
    const startedAt = Date.now();
    const id = window.setInterval(() => setSeconds(Math.floor((Date.now() - startedAt) / 1000)), 500);
    return () => window.clearInterval(id);
  }, [state]);

  const upload = useCallback(
    async (blob: Blob) => {
      setState('uploading');
      try {
        const wav = await blobToWav16kMono(blob);
        const form = new FormData();
        form.append('audio', wav, 'voice.wav');
        const res = await fetch('/api/asr', { method: 'POST', body: form });
        const payload = (await res.json().catch(() => null)) as AsrResponse | null;
        if (!res.ok || !payload) return flashError(payload?.error || `语音识别失败 (${res.status})`);
        const text = (payload.cleaned || payload.raw || '').trim();
        if (!text) return flashError('没有识别到语音内容，请再试一次');
        onTranscribed(text);
        setState('idle');
        setSeconds(0);
      } catch (e) {
        flashError(`语音处理失败：${e instanceof Error ? e.message : '未知错误'}`);
      }
    },
    [flashError, onTranscribed],
  );

  const stop = useCallback(() => {
    const r = recorderRef.current;
    if (r && r.state !== 'inactive') {
      try {
        r.stop();
      } catch {
        /* ignore */
      }
    }
  }, []);

  const start = useCallback(async () => {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) return flashError('当前浏览器不支持麦克风');
    if (typeof MediaRecorder === 'undefined') return flashError('当前浏览器不支持 MediaRecorder');
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      const denied = /Permission|Denied|NotAllowed/i.test(e instanceof Error ? e.message : '');
      return flashError(denied ? '请在地址栏允许麦克风权限' : '无法访问麦克风');
    }
    streamRef.current = stream;
    const mime = pickRecorderMime();
    let recorder: MediaRecorder;
    try {
      recorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
    } catch (e) {
      cleanupStream();
      return flashError(`录音器创建失败：${e instanceof Error ? e.message : ''}`);
    }
    recorderRef.current = recorder;
    chunksRef.current = [];
    recorder.ondataavailable = (ev) => {
      if (ev.data && ev.data.size > 0) chunksRef.current.push(ev.data);
    };
    recorder.onstop = () => {
      cleanupStream();
      const chunks = chunksRef.current;
      chunksRef.current = [];
      if (chunks.length === 0) {
        setState('idle');
        setSeconds(0);
        return;
      }
      void upload(new Blob(chunks, { type: recorder.mimeType || 'audio/webm' }));
    };
    recorder.onerror = () => {
      cleanupStream();
      flashError('录音过程出错');
    };
    try {
      recorder.start();
    } catch (e) {
      cleanupStream();
      return flashError(`录音启动失败：${e instanceof Error ? e.message : ''}`);
    }
    setSeconds(0);
    setState('recording');
    autoStopRef.current = window.setTimeout(stop, MAX_RECORD_MS);
  }, [cleanupStream, flashError, stop, upload]);

  const onClick = () => {
    if (disabled) return;
    if (state === 'idle') void start();
    else if (state === 'recording') stop();
  };

  const timeLabel = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  const isDisabled = Boolean(disabled) || state === 'uploading' || state === 'error';

  return (
    <span className="flex items-center gap-2">
      {state !== 'idle' && (
        <span className="text-xs text-neutral-500" role="status" aria-live="polite">
          {state === 'recording' && `请说 ${timeLabel}`}
          {state === 'uploading' && '正在识别…'}
          {state === 'error' && <span className="text-red-500">{errorMsg || '出错了'}</span>}
        </span>
      )}
      <button
        type="button"
        onClick={onClick}
        disabled={isDisabled}
        aria-label={state === 'recording' ? '停止录音' : '语音输入'}
        title={state === 'recording' ? '点击停止' : '点击语音输入'}
        className={`flex h-9 w-9 items-center justify-center rounded-md border text-sm transition-colors disabled:opacity-40 ${
          state === 'recording'
            ? 'border-red-300 bg-red-50 text-red-600'
            : 'border-neutral-300 text-neutral-600 hover:border-neutral-500'
        }`}
      >
        {state === 'idle' && <MicIcon />}
        {state === 'recording' && <span className="h-3 w-3 rounded-[2px] bg-red-500" />}
        {state === 'uploading' && <span className="h-4 w-4 animate-spin rounded-full border-2 border-neutral-300 border-t-neutral-600" />}
        {state === 'error' && <MicIcon />}
      </button>
    </span>
  );
}
