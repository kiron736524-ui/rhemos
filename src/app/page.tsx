'use client';

import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport, getToolName, isToolUIPart } from 'ai';
import { useState } from 'react';

type ToolPartLike = { state?: string; input?: unknown; output?: unknown };

// 从工具输出里抽取所有图片 url（兼容 generate_best_of_n 的 recommended/candidates、revise 的 url）。
function imagesFromOutput(out: unknown): { url: string; label?: string }[] {
  if (!out || typeof out !== 'object') return [];
  const o = out as Record<string, unknown>;
  const imgs: { url: string; label?: string }[] = [];
  if (typeof o.url === 'string') imgs.push({ url: o.url });
  const rec = o.recommended as { url?: string } | undefined;
  if (rec?.url) imgs.push({ url: rec.url, label: '推荐' });
  const cands = o.candidates as Array<{ url?: string; score?: number; fails?: string[] }> | undefined;
  if (Array.isArray(cands)) {
    for (const c of cands) {
      if (typeof c?.url === 'string') {
        imgs.push({ url: c.url, label: `score ${c.score ?? '?'} · ${c.fails?.length ?? 0} fail` });
      }
    }
  }
  const seen = new Set<string>();
  return imgs.filter((i) => (seen.has(i.url) ? false : (seen.add(i.url), true)));
}

export default function Home() {
  const { messages, sendMessage, status } = useChat({
    transport: new DefaultChatTransport({ api: '/api/agent' }),
  });
  const [input, setInput] = useState('');
  const busy = status === 'submitted' || status === 'streaming';

  return (
    <main className="mx-auto flex h-dvh max-w-3xl flex-col gap-4 p-4">
      <header className="border-b border-neutral-200 pb-2">
        <h1 className="text-lg font-semibold">Rhemos · 展台设计 Loop Agent</h1>
        <p className="text-xs text-neutral-500">
          Opus 4.8 脑 · GPT Image 2 生图 · Sonnet 4.6 判图 · best-of-N 并行 · 经 Vercel AI Gateway
        </p>
      </header>

      <div className="flex-1 space-y-5 overflow-y-auto">
        {messages.length === 0 && (
          <p className="text-sm text-neutral-400">
            描述你的展台需求，大脑会自己澄清 → 写方案 → 并行生图 → 判图择优 → 交付。例如：「苏州医疗展，9×6m
            三面开，预算中等，主打一款新设备」。
          </p>
        )}
        {messages.map((m) => (
          <div key={m.id}>
            <div className="mb-1 text-xs font-medium text-neutral-400">
              {m.role === 'user' ? '你' : 'Rhemos'}
            </div>
            <div className="space-y-2">
              {m.parts.map((part, i) => {
                if (part.type === 'text') {
                  return (
                    <p key={i} className="whitespace-pre-wrap text-sm leading-relaxed">
                      {part.text}
                    </p>
                  );
                }
                if (isToolUIPart(part)) {
                  const tp = part as unknown as ToolPartLike;
                  const imgs = imagesFromOutput(tp.output);
                  return (
                    <details
                      key={i}
                      open
                      className="rounded-md border border-neutral-200 bg-neutral-50 p-2 text-sm"
                    >
                      <summary className="cursor-pointer select-none font-mono text-xs text-neutral-600">
                        🔧 {getToolName(part)} · {tp.state}
                      </summary>
                      {tp.input != null && (
                        <pre className="mt-1 max-h-40 overflow-auto text-xs text-neutral-500">
                          {JSON.stringify(tp.input, null, 2)}
                        </pre>
                      )}
                      {imgs.length > 0 ? (
                        <div className="mt-2 flex flex-wrap gap-3">
                          {imgs.map((img) => (
                            <figure key={img.url} className="m-0">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={img.url} alt="生成结果" className="max-h-72 rounded border border-neutral-200" />
                              {img.label && (
                                <figcaption className="mt-0.5 text-center text-[10px] text-neutral-500">
                                  {img.label}
                                </figcaption>
                              )}
                            </figure>
                          ))}
                        </div>
                      ) : tp.output != null ? (
                        <pre className="mt-1 max-h-40 overflow-auto text-xs text-neutral-700">
                          {JSON.stringify(tp.output, null, 2)}
                        </pre>
                      ) : null}
                    </details>
                  );
                }
                return null;
              })}
            </div>
          </div>
        ))}
        {busy && <p className="text-xs text-neutral-400">大脑思考 / 调度中…（生图较慢，过程会实时显示）</p>}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!input.trim() || busy) return;
          sendMessage({ text: input });
          setInput('');
        }}
        className="flex gap-2 border-t border-neutral-200 pt-2"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="描述你的展台需求…"
          className="flex-1 rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-500"
        />
        <button
          type="submit"
          disabled={busy}
          className="rounded-md bg-black px-4 py-2 text-sm text-white disabled:opacity-40"
        >
          发送
        </button>
      </form>
    </main>
  );
}
