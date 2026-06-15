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
interface ProjectSummary {
  id: string;
  title: string;
  assetCount: number;
  updatedAt: string;
  thumbnailUrl?: string;
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

function timeAgo(iso: string): string {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return '刚刚';
  if (m < 60) return `${m} 分钟前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} 小时前`;
  return `${Math.floor(h / 24)} 天前`;
}

function newProjectId(): string {
  return `p-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
}

const PaperclipIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
  </svg>
);

export default function Workbench() {
  const projectId = String(useParams().projectId ?? 'default');
  const router = useRouter();
  const [debug, setDebug] = useState(false);
  const [state, setState] = useState<ProjectState | null>(null);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [input, setInput] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [preview, setPreview] = useState<string | null>(null);

  const { messages, sendMessage, status, error } = useChat({
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

  const refreshProjects = useCallback(async () => {
    try {
      const r = await fetch('/api/projects', { cache: 'no-store' });
      if (r.ok) setProjects(((await r.json()) as { projects?: ProjectSummary[] }).projects ?? []);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    void refreshProjects();
  }, [refreshProjects]);
  useEffect(() => {
    void refreshState();
  }, [refreshState]); // 切换项目（projectId 变）时重载状态
  useEffect(() => {
    if (status === 'ready') {
      void refreshState();
      void refreshProjects();
    }
  }, [status, refreshState, refreshProjects]);

  const send = (text: string) => {
    if ((!text.trim() && files.length === 0) || busy) return;
    const dt = new DataTransfer();
    files.forEach((f) => dt.items.add(f));
    sendMessage({ text: text.trim() || '（请看附件）', files: dt.files });
    setInput('');
    setFiles([]);
  };

  const deleteProj = async (id: string) => {
    if (id === 'default') return;
    if (!confirm('删除该项目及其全部图片？此操作不可恢复。')) return;
    try {
      await fetch(`/api/projects/${id}`, { method: 'DELETE' });
    } catch {
      /* ignore */
    }
    if (id === projectId) router.push('/projects/default');
    else void refreshProjects();
  };

  let progress = '大脑思考中…';
  for (const m of messages) {
    if (m.role !== 'assistant') continue;
    for (const p of m.parts) {
      if (isToolUIPart(p)) {
        const tp = p as unknown as ToolPartLike;
        if (tp.state !== 'output-available' && tp.state !== 'output-error') progress = PROGRESS[getToolName(p)] ?? progress;
      }
    }
  }

  const assets = (state?.assets ?? []).slice().reverse();
  // 新建的空项目还没落盘（listProjects 扫不到），前端补一个置顶项以便高亮显示
  const shownProjects = projects.some((p) => p.id === projectId)
    ? projects
    : [{ id: projectId, title: projectId === 'default' ? '默认项目' : '新项目', assetCount: 0, updatedAt: '' }, ...projects];
  const currentTitle = shownProjects.find((p) => p.id === projectId)?.title ?? projectId;

  return (
    <main className="flex h-dvh">
      {/* 左：项目面板 */}
      <nav className="flex w-60 shrink-0 flex-col border-r border-neutral-200 bg-neutral-50">
        <div className="flex items-center justify-between px-3 py-3">
          <span className="text-sm font-semibold">Rhemos</span>
          <button
            onClick={() => router.push(`/projects/${newProjectId()}`)}
            className="rounded-md bg-black px-2.5 py-1 text-xs text-white hover:bg-neutral-700"
          >
            + 新建
          </button>
        </div>
        <div className="flex-1 space-y-1 overflow-y-auto px-2 pb-2">
          {shownProjects.length === 0 && <p className="px-2 text-xs text-neutral-400">还没有项目</p>}
          {shownProjects.map((p) => {
            const active = p.id === projectId;
            return (
              <div
                key={p.id}
                onClick={() => !active && router.push(`/projects/${p.id}`)}
                className={`group flex cursor-pointer items-center gap-2 rounded-md p-2 ${active ? 'bg-white shadow-sm ring-1 ring-neutral-200' : 'hover:bg-white/70'}`}
              >
                {p.thumbnailUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={p.thumbnailUrl} alt="" className="h-9 w-9 shrink-0 rounded object-cover" />
                ) : (
                  <div className="grid h-9 w-9 shrink-0 place-items-center rounded bg-neutral-200 text-neutral-400">▦</div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs font-medium text-neutral-700">{p.title}</div>
                  <div className="text-[10px] text-neutral-400">
                    {p.assetCount} 张{p.updatedAt ? ` · ${timeAgo(p.updatedAt)}` : ''}
                  </div>
                </div>
                {p.id !== 'default' && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      void deleteProj(p.id);
                    }}
                    className="hidden shrink-0 px-1 text-neutral-300 hover:text-red-500 group-hover:block"
                    title="删除项目"
                  >
                    ✕
                  </button>
                )}
              </div>
            );
          })}
        </div>
        <label className="flex items-center gap-1.5 border-t border-neutral-200 px-3 py-2 text-[11px] text-neutral-500">
          <input type="checkbox" checked={debug} onChange={(e) => setDebug(e.target.checked)} /> 调试视图（显示工具调用）
        </label>
      </nav>

      {/* 中：对话 */}
      <section className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-neutral-200 px-4 py-2">
          <h1 className="truncate text-sm font-medium text-neutral-700">{currentTitle}</h1>
          <span className="shrink-0 text-[11px] text-neutral-400">展台设计工作台</span>
        </header>

        <div className="flex-1 space-y-4 overflow-y-auto p-4">
          {messages.length === 0 && (
            <p className="text-sm text-neutral-400">
              说出你的展台需求（也可上传参考图 / PDF / Word / Excel），Rhemos 会澄清 → 写方案 → 生图 → 交付。深化、换风格、多视角、修改都直接对它说。
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
                  if (part.type === 'file') {
                    const fp = part as unknown as { url?: string; mediaType?: string; filename?: string };
                    if (fp.mediaType?.startsWith('image/') && fp.url) {
                      return (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img key={i} src={fp.url} alt="附件" onDoubleClick={() => setPreview(fp.url!)} className="mt-1 max-h-40 cursor-zoom-in rounded border border-neutral-200" />
                      );
                    }
                    return (
                      <p key={i} className="mt-1 text-xs text-neutral-500">
                        📎 {fp.filename ?? '附件'}
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
                        {tp.input != null && <pre className="mt-1 max-h-32 overflow-auto text-neutral-500">{JSON.stringify(tp.input, null, 2)}</pre>}
                        {tp.output != null && <pre className="mt-1 max-h-32 overflow-auto text-neutral-700">{JSON.stringify(tp.output, null, 2)}</pre>}
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
                        <img src={img.url} alt="交付结果" onDoubleClick={() => setPreview(img.url)} className="max-h-80 cursor-zoom-in rounded-md border border-neutral-200" title="双击放大" />
                        <figcaption className="mt-0.5 text-[11px] font-medium text-emerald-600">{img.label}</figcaption>
                      </figure>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
          {busy && <p className="text-xs text-neutral-400">{progress}（生图较慢，请稍候）</p>}
          {error && !busy && (
            <p className="rounded bg-red-50 px-3 py-2 text-xs text-red-600">出错了，请重试一次。若反复失败，点左上角「+ 新建」重开对话。</p>
          )}
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            send(input);
          }}
          className="border-t border-neutral-200 p-3"
        >
          {files.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-1.5">
              {files.map((f, i) => (
                <span key={i} className="flex items-center gap-1 rounded bg-neutral-100 px-2 py-0.5 text-[11px] text-neutral-600">
                  📎 {f.name}
                  <button type="button" onClick={() => setFiles(files.filter((_, j) => j !== i))} className="text-neutral-400 hover:text-neutral-700">
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}
          <div className="flex items-center gap-2">
            {/* label 关联触发：点 label 由浏览器原生打开文件框，不依赖 .click()，
                避免 display:none input 在 Safari 等浏览器点击无反应的经典坑。input 用 sr-only（非 display:none）。 */}
            <input
              id="rhemos-upload"
              type="file"
              multiple
              accept="image/*,.pdf,.docx,.xlsx,.xls"
              className="sr-only"
              onChange={(e) => {
                if (e.target.files) setFiles((cur) => [...cur, ...Array.from(e.target.files!)]);
                e.target.value = '';
              }}
            />
            <label
              htmlFor="rhemos-upload"
              title="上传图片 / PDF / Word / Excel"
              className={`flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-md border border-neutral-300 text-neutral-600 hover:border-neutral-500 ${busy ? 'pointer-events-none opacity-40' : ''}`}
            >
              <PaperclipIcon />
            </label>
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
          </div>
        </form>
      </section>

      {/* 右：资产画廊 */}
      <aside className="flex w-72 shrink-0 flex-col overflow-y-auto border-l border-neutral-200 bg-neutral-50 p-3">
        <h2 className="mb-2 text-xs font-semibold text-neutral-500">资产画廊（{assets.length}）</h2>
        {assets.length === 0 && <p className="text-xs text-neutral-400">还没有图。对中间说出需求即可生成。</p>}
        <div className="grid grid-cols-1 gap-2">
          {assets.map((a, idx) => (
            <figure key={a.id} className="m-0 overflow-hidden rounded-md border border-neutral-200 bg-white">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={a.url} alt={a.kind} onDoubleClick={() => setPreview(a.url)} className="w-full cursor-zoom-in" title="双击放大" />
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

      {preview && (
        <div onClick={() => setPreview(null)} className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-6">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={preview} alt="预览" className="max-h-full max-w-full rounded shadow-2xl" />
        </div>
      )}
    </main>
  );
}
