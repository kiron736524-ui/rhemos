'use client';

import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport, getToolName, isToolUIPart } from 'ai';
import { useState } from 'react';

type ToolPartLike = { state?: string; input?: unknown; output?: unknown };

function hasUrl(v: unknown): v is { url: string } {
  return (
    typeof v === 'object' && v !== null && 'url' in v && typeof (v as { url: unknown }).url === 'string'
  );
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
          Opus 4.8 脑 · GPT Image 2 生图 · Sonnet 4.6 判图 · 经 Vercel AI Gateway
        </p>
      </header>

      <div className="flex-1 space-y-5 overflow-y-auto">
        {messages.length === 0 && (
          <p className="text-sm text-neutral-400">
            描述你的展台需求，大脑会自己澄清、写方案、生图并自检。例如：「苏州医疗展，9×6m
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
                        <pre className="mt-1 overflow-x-auto text-xs text-neutral-500">
                          {JSON.stringify(tp.input, null, 2)}
                        </pre>
                      )}
                      {hasUrl(tp.output) ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={tp.output.url} alt="生成结果" className="mt-2 max-w-full rounded" />
                      ) : tp.output != null ? (
                        <pre className="mt-1 overflow-x-auto text-xs text-neutral-700">
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
        {busy && <p className="text-xs text-neutral-400">大脑思考 / 调度中…</p>}
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
