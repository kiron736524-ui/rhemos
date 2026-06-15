'use client';

import { useChat } from '@ai-sdk/react';
import { getToolName, isToolUIPart, DefaultChatTransport } from 'ai';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import VoiceInputButton from '@/components/VoiceInputButton';

interface Asset {
  id: string;
  kind: string;
  url: string;
  prompt?: string;
  parentId?: string;
}
interface ProjectState {
  id: string;
  assets: Asset[];
}
type ToolPartLike = { state?: string; input?: unknown; output?: unknown };

const PROGRESS: Record<string, string> = {
  read_project_state: '正在读取项目…',
  update_spec: '正在整理方案…',
  generate_best_of_n: '正在生成候选并筛选…',
  render_multiview_sheet: '正在生成多视角全貌…',
  revise_asset: '正在修正结构问题…',
  analyze_reference: '正在分析参考图…',
  inspect_result: '正在核对结果…',
};

// 从一条 assistant 消息的工具输出里抽"交付/推荐"的图（用户态只显示成品，不露评分/工具名）。
function deliveredImages(parts: readonly unknown[]): { url: string; label: string }[] {
  const out: { url: string; label: string }[] = [];
  for (const p of parts) {
    if (!isToolUIPart(p as never)) continue;
    const o = (p as unknown as ToolPartLike).output as Record<string, unknown> | undefined;
    if (!o) continue;
    const rec = o.recommended as { url?: string } | undefined;
    if (rec?.url) out.push({ url: rec.url, label: '✓ 推荐' });
    else if (typeof o.url === 'string') out.push({ url: o.url, label: '交付' });
  }
  const seen = new Set<string>();
  return out.filter((i) => (seen.has(i.url) ? false : (seen.add(i.url), true)));
}

export default function Workbench() {
  const projectId = String(useParams().projectId ?? 'default');
  const router = useRouter();
  const [debug, setDebug] = useState(false);
  const [state, setState] = useState<ProjectState | null>(null);
  const [input, setInput] = useState('');
  const [preview, setPreview] = useState<string | null>(null);

  const { messages, sendMessage, status } = useChat({
    transport: new DefaultChatTransport({ api: '/api/agent', body: { projectId } }),
  });
  const busy = status === 'submitted' || status === 'streaming';

  const refreshState = useCallback(async () => {
    try {
      const r = await fetch(`/api/projects/${projectId}/state`, { cache: 'no-store' });
      if (r.ok) setState((await r.json()) as ProjectState);
    } catch {
      /* ignore */
    }
  }, [projectId]);
  useEffect(() => {
    if (status === 'ready') void refreshState();
  }, [status, refreshState]);

  const send = (text: string) => {
    if (!text.trim() || busy) return;
    sendMessage({ text });
    setInput('');
  };

  let progress = '大脑思考中…';
  for (const m of messages) {
    if (m.role !== 'assistant') continue;
    for (const p of m.parts) {
      if (isToolUIPart(p)) {
        const tp = p as unknown as ToolPartLike;
        if (tp.state !== 'output-available' && tp.state !== 'output-error') {
          progress = PROGRESS[getToolName(p)] ?? progress;
        }
      }
    }
  }

  const assets = (state?.assets ?? []).slice().reverse();

  return (
    <main className="flex h-dvh flex-col">
      <header className="flex items-center justify-between border-b border-neutral-200 px-4 py-2">
        <div>
          <h1 className="text-sm font-semibold">Rhemos · 展台设计工作台</h1>
          <p className="text-[11px] text-neutral-400">项目 {projectId}</p>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <button
            onClick={() => router.push(`/projects/p-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`)}
            className="rounded border border-neutral-300 px-2 py-1 hover:border-neutral-500"
          >
            + 新项目
          </button>
          <label className="flex items-center gap-1 text-neutral-500">
            <input type="checkbox" checked={debug} onChange={(e) => setDebug(e.target.checked)} />
            调试
          </label>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* 对话区：说需求 → 大脑澄清/出方案/出图，成品图直接显示在对话里 */}
        <section className="flex min-w-0 flex-1 flex-col">
          <div className="flex-1 space-y-4 overflow-y-auto p-4">
            {messages.length === 0 && (
              <p className="text-sm text-neutral-400">
                说出你的展台需求，Rhemos 会澄清关键问题 → 写方案 → 生图 → 交付。深化、换风格、多视角、修改都直接对它说。
              </p>
            )}
            {messages.map((m) => {
              const imgs = m.role === 'assistant' ? deliveredImages(m.parts) : [];
              return (
                <div key={m.id}>
                  <div className="mb-1 text-xs font-medium text-neutral-400">{m.role === 'user' ? '你' : 'Rhemos'}</div>
                  {m.parts.map((part, i) => {
                    if (part.type === 'text') {
                      return (
                        <p key={i} className="whitespace-pre-wrap text-sm leading-relaxed">
                          {part.text}
                        </p>
                      );
                    }
                    if (debug && isToolUIPart(part)) {
                      const tp = part as unknown as ToolPartLike;
                      return (
                        <details key={i} className="mt-1 rounded border border-amber-200 bg-amber-50 p-1.5 text-[11px]">
                          <summary className="cursor-pointer font-mono text-neutral-600">
                            🔧 {getToolName(part)} · {tp.state}
                          </summary>
                          {tp.input != null && (
                            <pre className="mt-1 max-h-32 overflow-auto text-neutral-500">{JSON.stringify(tp.input, null, 2)}</pre>
                          )}
                          {tp.output != null && (
                            <pre className="mt-1 max-h-32 overflow-auto text-neutral-700">{JSON.stringify(tp.output, null, 2)}</pre>
                          )}
                        </details>
                      );
                    }
                    return null;
                  })}
                  {imgs.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-3">
                      {imgs.map((img) => (
                        <figure key={img.url} className="m-0">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={img.url}
                            alt="交付结果"
                            onDoubleClick={() => setPreview(img.url)}
                            className="max-h-80 cursor-zoom-in rounded-md border border-neutral-200"
                            title="双击放大"
                          />
                          <figcaption className="mt-0.5 text-[11px] font-medium text-emerald-600">{img.label}</figcaption>
                        </figure>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
            {busy && <p className="text-xs text-neutral-400">{progress}（生图较慢，请稍候）</p>}
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              send(input);
            }}
            className="flex items-center gap-2 border-t border-neutral-200 p-3"
          >
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="描述你的展台需求…"
              className="flex-1 rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-500"
            />
            <VoiceInputButton disabled={busy} onTranscribed={(t) => setInput((c) => (c.trim() ? `${c.trim()} ${t}` : t))} />
            <button type="submit" disabled={busy} className="rounded-md bg-black px-4 py-2 text-sm text-white disabled:opacity-40">
              发送
            </button>
          </form>
        </section>

        {/* 右侧：纯资产画廊（只存放/预览生成的图，无额外交互——一切操作通过对话） */}
        <aside className="flex w-80 shrink-0 flex-col overflow-y-auto border-l border-neutral-200 bg-neutral-50 p-3">
          <h2 className="mb-2 text-xs font-semibold text-neutral-500">资产画廊（{assets.length}）</h2>
          {assets.length === 0 && <p className="text-xs text-neutral-400">还没有图。对左侧说出需求即可生成。</p>}
          <div className="grid grid-cols-1 gap-2">
            {assets.map((a, idx) => (
              <figure key={a.id} className="m-0 overflow-hidden rounded-md border border-neutral-200 bg-white">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={a.url}
                  alt={a.kind}
                  onDoubleClick={() => setPreview(a.url)}
                  className="w-full cursor-zoom-in"
                  title="双击放大"
                />
                <figcaption className="flex items-center justify-between px-2 py-1 text-[10px] text-neutral-500">
                  <span>
                    {idx === 0 && <span className="mr-1 rounded bg-emerald-100 px-1 text-emerald-700">最新</span>}
                    {a.kind === 'multiview' ? '多视角全貌' : '效果图'}
                  </span>
                  <a href={a.url} download className="text-neutral-700 underline">
                    下载
                  </a>
                </figcaption>
              </figure>
            ))}
          </div>
        </aside>
      </div>

      {/* 双击放大预览 */}
      {preview && (
        <div
          onClick={() => setPreview(null)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-6"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={preview} alt="预览" className="max-h-full max-w-full rounded shadow-2xl" />
        </div>
      )}
    </main>
  );
}
