'use client';

import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport, getToolName, isToolUIPart } from 'ai';
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
  spec: { narrative: string; selfCheckCriteria?: string } | null;
  assets: Asset[];
}
type ToolPartLike = { state?: string; input?: unknown; output?: unknown };

// 运行中的工具 → 用户级进度旁白（不露评分/内部细节）。
const PROGRESS: Record<string, string> = {
  read_project_state: '正在读取项目…',
  update_spec: '正在整理方案…',
  generate_best_of_n: '正在生成候选并筛选…',
  render_multiview_sheet: '正在生成多视角全貌…',
  revise_asset: '正在修正结构问题…',
  analyze_reference: '正在分析参考图…',
  inspect_result: '正在核对结果…',
};

export default function Workbench() {
  const projectId = String(useParams().projectId ?? 'default');
  const router = useRouter();
  const [debug, setDebug] = useState(false);
  const [state, setState] = useState<ProjectState | null>(null);
  const [input, setInput] = useState('');

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

  // 每轮结束（status 回到 ready）刷新当前方案 + 资产
  useEffect(() => {
    if (status === 'ready') void refreshState();
  }, [status, refreshState]);

  const send = (text: string) => {
    if (!text.trim() || busy) return;
    sendMessage({ text });
    setInput('');
  };

  // 进度旁白：取最后一个"运行中"的工具
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
  const newProject = () =>
    router.push(`/projects/p-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`);

  return (
    <main className="flex h-dvh flex-col">
      <header className="flex items-center justify-between border-b border-neutral-200 px-4 py-2">
        <div>
          <h1 className="text-sm font-semibold">Rhemos · 展台设计工作台</h1>
          <p className="text-[11px] text-neutral-400">项目 {projectId}</p>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <button onClick={newProject} className="rounded border border-neutral-300 px-2 py-1 hover:border-neutral-500">
            + 新项目
          </button>
          <label className="flex items-center gap-1 text-neutral-500">
            <input type="checkbox" checked={debug} onChange={(e) => setDebug(e.target.checked)} />
            调试
          </label>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* 中间：对话区（用户态不露工具日志）*/}
        <section className="flex min-w-0 flex-1 flex-col">
          <div className="flex-1 space-y-4 overflow-y-auto p-4">
            {messages.length === 0 && (
              <p className="text-sm text-neutral-400">
                说出你的展台需求，Rhemos 会澄清关键问题 → 写方案 → 生图 → 交付。例如「苏州医疗展，9×6m
                三面开，预算中等，主打一款新设备」。
              </p>
            )}
            {messages.map((m) => (
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
                  // 工具部件仅调试模式可见（产品原则：自检对用户隐形）
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
              </div>
            ))}
            {busy && <p className="text-xs text-neutral-400">{progress}（生图较慢，请稍候）</p>}
          </div>

          {/* 输入栏 */}
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

        {/* 右侧：当前方案 + 资产 + 操作 */}
        <aside className="flex w-96 shrink-0 flex-col gap-3 overflow-y-auto border-l border-neutral-200 bg-neutral-50 p-3">
          <div>
            <h2 className="mb-1 text-xs font-semibold text-neutral-500">当前方案</h2>
            {state?.spec ? (
              <p className="whitespace-pre-wrap rounded-md border border-neutral-200 bg-white p-2 text-xs leading-relaxed">
                {state.spec.narrative}
              </p>
            ) : (
              <p className="text-xs text-neutral-400">还没有方案，先说需求。</p>
            )}
          </div>

          <div>
            <h2 className="mb-1 text-xs font-semibold text-neutral-500">生成结果（{assets.length}）</h2>
            <div className="grid grid-cols-1 gap-2">
              {assets.length === 0 && <p className="text-xs text-neutral-400">还没有图。</p>}
              {assets.map((a) => (
                <figure key={a.id} className="m-0 overflow-hidden rounded-md border border-neutral-200 bg-white">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={a.url} alt={a.kind} className="w-full" />
                  <figcaption className="flex items-center justify-between px-2 py-1 text-[10px] text-neutral-500">
                    <span>{a.kind === 'multiview' ? '多视角全貌' : '效果图'}</span>
                    <a href={a.url} download className="text-neutral-700 underline">
                      下载
                    </a>
                  </figcaption>
                </figure>
              ))}
            </div>
          </div>

          <div className="mt-auto">
            <h2 className="mb-1 text-xs font-semibold text-neutral-500">操作</h2>
            <div className="grid grid-cols-2 gap-1.5 text-xs">
              <ActionBtn label="继续深化" onClick={() => send('在当前方案基础上继续深化细节，再出一张主视图。')} busy={busy} />
              <ActionBtn label="换风格" onClick={() => send('换一个明显不同的设计风格方向，再出一张主视图。')} busy={busy} />
              <ActionBtn label="多视角全貌" onClick={() => send('给我一张多视角全貌（前/左/右/俯视）。')} busy={busy} />
              <ActionBtn label="重新生成" onClick={() => send('基于当前需求重新生成一张主视图（新方向）。')} busy={busy} />
            </div>
          </div>
        </aside>
      </div>
    </main>
  );
}

function ActionBtn({ label, onClick, busy }: { label: string; onClick: () => void; busy: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={busy}
      className="rounded border border-neutral-300 px-2 py-1.5 hover:border-neutral-500 disabled:opacity-40"
    >
      {label}
    </button>
  );
}
