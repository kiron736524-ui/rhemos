'use client';

import { useChat } from '@ai-sdk/react';
import { getToolName, isToolUIPart, DefaultChatTransport, type FileUIPart } from 'ai';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import VoiceInputButton from '@/components/VoiceInputButton';
import dynamic from 'next/dynamic';
import type { LayoutModule } from '@/components/LayoutEditor';
import type { DeliverableAsset } from '@/lib/types';

// react-konva 用 canvas，禁用 SSR
const LayoutEditorDyn = dynamic(() => import('@/components/LayoutEditor'), { ssr: false });

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
  baseAssetId?: string;
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
  read_project_state: '读取项目状态',
  present_choices: '准备选择卡片',
  update_brief: '记录确认事实',
  update_spec: '整理设计方案',
  render: '生成效果图',
  revise_asset: '定向修正结构',
  analyze_reference: '分析参考图',
};

const SUGGESTIONS = [
  '10×6 科技公司展台，主打中央 LED 大屏与产品体验区',
  '极简白色美妆展台，3×3 开放式，强调产品陈列与打光',
  '我有参考图，想做类似风格的展台',
];

// 一条交付（内部统一形状，兼容新 Deliverable 协议 + 旧返回形状）
type DeliveryItem = { assetId?: string; url: string; view?: string; status: string; recommended: boolean };
type DeliveryGroup = { type: string; items: DeliveryItem[]; grouped: boolean };
type PreviewState = { urls: string[]; index: number; zoom: number };
type OpenPreview = (url: string, urls?: Array<string | null | undefined>) => void;

const uniqueUrls = (urls: Array<string | null | undefined>): string[] => Array.from(new Set(urls.filter((u): u is string => !!u)));
const clampZoom = (z: number): number => Math.min(4, Math.max(0.5, Number(z.toFixed(2))));

// 英文视角名 → 中文短标
function viewLabel(view?: string): string {
  if (!view) return '视角';
  const v = view.toLowerCase();
  if (v.includes('left')) return '左视';
  if (v.includes('right')) return '右视';
  if (v.includes('back') || v.includes('rear')) return '后视';
  if (v.includes('top') || v.includes('orthographic') || v.includes('floor plan')) return '俯视';
  if (v.includes('front') || v.includes('three-quarter') || v.includes('hero')) return '正面';
  return view.length > 10 ? `${view.slice(0, 10)}…` : view;
}

// 从 assistant 消息 parts 提取交付组：新协议 Deliverable 优先，回退旧形状（兼容历史对话）。
function extractDeliveries(parts: readonly unknown[]): DeliveryGroup[] {
  const groups: DeliveryGroup[] = [];
  for (const p of parts) {
    if (!isToolUIPart(p as never)) continue;
    const o = (p as unknown as ToolPartLike).output as Record<string, unknown> | undefined;
    if (!o) continue;
    // 新协议：Deliverable { type, assets[], recommendedId }
    if (Array.isArray(o.assets) && typeof o.recommendedId === 'string') {
      const items = (o.assets as DeliverableAsset[])
        .filter((a) => a.url)
        .map((a) => ({ assetId: a.assetId, url: a.url, view: a.view, status: a.status, recommended: a.assetId === o.recommendedId }));
      if (items.length) groups.push({ type: String(o.type), items, grouped: o.type === 'view-set' || o.type === 'plan-conditioned' });
      continue;
    }
    // 旧形状兼容：{hero, views:[{view,url,status}]}
    if (o.hero && Array.isArray(o.views)) {
      const items = (o.views as Array<{ view?: string; url?: string; status?: string }>)
        .filter((v) => v.url)
        .map((v, i) => ({ url: v.url as string, view: v.view, status: v.status === 'locked' ? 'ok' : v.status ?? 'ok', recommended: i === 0 }));
      if (items.length) groups.push({ type: 'view-set', items, grouped: true });
      continue;
    }
    // 旧形状兼容：{recommended:{url}} / {url}
    const rec = o.recommended as { url?: string } | undefined;
    if (rec?.url) groups.push({ type: 'single', items: [{ url: rec.url, status: 'recommended', recommended: true }], grouped: false });
    else if (typeof o.url === 'string') groups.push({ type: 'single', items: [{ url: o.url, status: 'ok', recommended: false }], grouped: false });
  }
  return groups;
}

// 多视角交付：主图 + 各视角分组展示（view-set / plan-conditioned）。弱视角标黄。
function ViewSet({ group, onZoom }: { group: DeliveryGroup; onZoom: OpenPreview }) {
  const hero = group.items.find((i) => i.recommended) ?? group.items[0];
  const views = group.items.filter((i) => i !== hero);
  const urls = group.items.map((i) => i.url);
  return (
    <div className="mt-1 w-full rounded-xl border border-ink-700 bg-ink-900/40 p-3">
      <div className="mono-tag mb-2 flex items-center gap-1.5 text-ink-500">
        <span className="inline-block h-1.5 w-1.5 rounded-[1px] bg-signal" />
        {group.type === 'plan-conditioned' ? '按平面图 · 多视角交付' : '多视角交付'}
      </div>
      {hero && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={hero.url}
          alt="主视角"
          onClick={() => onZoom(hero.url, urls)}
          className="mb-2 max-h-80 w-full cursor-zoom-in rounded-lg object-contain ring-1 ring-signal/40 transition hover:brightness-105"
          title="点击放大"
        />
      )}
      {views.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {views.map((v) => (
            <figure key={v.url} className="m-0 flex flex-col items-center gap-1">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={v.url}
                alt={viewLabel(v.view)}
                onClick={() => onZoom(v.url, urls)}
                className={`h-24 w-28 cursor-zoom-in rounded-md object-cover ring-1 transition hover:brightness-105 ${v.status === 'weak' ? 'ring-amber-500/50' : 'ring-ink-700'}`}
                title="点击放大"
              />
              <figcaption className="mono-tag text-[10px] text-ink-500">
                {viewLabel(v.view)}
                {v.status === 'weak' && <span className="text-amber-500"> · 偏弱</span>}
              </figcaption>
            </figure>
          ))}
        </div>
      )}
    </div>
  );
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

const assetKindLabel = (kind: string) => (kind === 'multiview' ? '多视角全貌' : '效果图');

/* ── 线性图标（科技感，stroke currentColor）─────────────── */
type IP = { className?: string };
const PaperclipIcon = ({ className }: IP) => (
  <svg className={className} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
  </svg>
);
const PlusIcon = ({ className }: IP) => (
  <svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
    <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
  </svg>
);
const SendIcon = ({ className }: IP) => (
  <svg className={className} width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <line x1="12" y1="19" x2="12" y2="5" /><polyline points="6 11 12 5 18 11" />
  </svg>
);
const CloseIcon = ({ className }: IP) => (
  <svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
    <line x1="6" y1="6" x2="18" y2="18" /><line x1="18" y1="6" x2="6" y2="18" />
  </svg>
);
const DownloadIcon = ({ className }: IP) => (
  <svg className={className} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
  </svg>
);
const TrashIcon = ({ className }: IP) => (
  <svg className={className} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
  </svg>
);

/* ── markdown 渲染（assistant 回复用，暗色科技样式）──────── */
const mdComponents: Components = {
  p: ({ children }) => <p className="text-[14px] leading-[1.75] text-ink-100">{children}</p>,
  strong: ({ children }) => <strong className="font-semibold text-ink-50">{children}</strong>,
  em: ({ children }) => <em className="italic text-ink-100">{children}</em>,
  ul: ({ children }) => <ul className="list-disc space-y-1 pl-5 marker:text-ink-500">{children}</ul>,
  ol: ({ children }) => <ol className="list-decimal space-y-1 pl-5 marker:text-ink-500">{children}</ol>,
  li: ({ children }) => <li className="text-[14px] leading-[1.7] text-ink-100">{children}</li>,
  h1: ({ children }) => <h3 className="text-[16px] font-semibold text-ink-50">{children}</h3>,
  h2: ({ children }) => <h3 className="text-[15px] font-semibold text-ink-50">{children}</h3>,
  h3: ({ children }) => <h4 className="text-[14.5px] font-semibold text-ink-50">{children}</h4>,
  a: ({ children, href }) => (
    <a href={href} target="_blank" rel="noreferrer" className="text-accent underline underline-offset-2 hover:text-accent-deep">
      {children}
    </a>
  ),
  code: ({ children }) => <code className="rounded bg-ink-800 px-1.5 py-0.5 font-mono text-[12.5px] text-accent">{children}</code>,
  pre: ({ children }) => (
    <pre className="overflow-x-auto rounded-lg border border-ink-700 bg-ink-850 p-3 text-[12.5px] [&_code]:bg-transparent [&_code]:p-0 [&_code]:text-ink-100">
      {children}
    </pre>
  ),
  hr: () => <hr className="border-ink-700" />,
  blockquote: ({ children }) => <blockquote className="border-l-2 border-ink-600 pl-3 text-ink-300">{children}</blockquote>,
  table: ({ children }) => (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-[13px]">{children}</table>
    </div>
  ),
  th: ({ children }) => <th className="border border-ink-700 bg-ink-850 px-2 py-1 text-left font-medium text-ink-200">{children}</th>,
  td: ({ children }) => <td className="border border-ink-700 px-2 py-1 text-ink-100">{children}</td>,
};

function Prose({ children }: { children: string }) {
  return (
    <div className="space-y-3">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
        {children}
      </ReactMarkdown>
    </div>
  );
}

/* ── 数据驱动的展台俯视平面图渲染器（大脑只出结构化数据，精致渲染交给代码）── */
type Zone = { name: string; type?: string; x: number; y: number; w: number; h: number; note?: string };
type BoothLayout = { length: number; width: number; openings?: string[]; facing?: string; zones: Zone[] };

const ZONE_STYLE: Record<string, { fill: string; stroke: string }> = {
  led: { fill: 'rgba(111,161,201,0.34)', stroke: '#6FA1C9' },
  stage: { fill: 'rgba(111,161,201,0.2)', stroke: '#6FA1C9' },
  brand: { fill: 'rgba(210,85,74,0.3)', stroke: '#D2554A' },
  reception: { fill: 'rgba(180,185,196,0.18)', stroke: '#B3B9C4' },
  meeting: { fill: 'rgba(94,100,111,0.5)', stroke: '#9AA1AD' },
  storage: { fill: 'rgba(60,66,76,0.6)', stroke: '#5E646F' },
  product: { fill: 'rgba(136,143,156,0.2)', stroke: '#B3B9C4' },
  plant: { fill: 'rgba(91,168,115,0.3)', stroke: '#5BA873' },
  aisle: { fill: 'rgba(255,255,255,0.02)', stroke: 'rgba(136,143,156,0.3)' },
  default: { fill: 'rgba(94,100,111,0.22)', stroke: '#888F9C' },
};

function FloorPlan({ layout }: { layout: BoothLayout }) {
  const L = Number(layout?.length),
    W = Number(layout?.width);
  if (!(L > 0) || !(W > 0) || !Array.isArray(layout.zones)) return null;
  const PAD = 26,
    MAXW = 252,
    MAXH = 188;
  const s = Math.min(MAXW / L, MAXH / W);
  const iw = L * s,
    ih = W * s;
  const svgW = iw + PAD * 2,
    svgH = ih + PAD * 2;
  const X = (m: number) => PAD + m * s;
  const Y = (m: number) => PAD + m * s;
  const open = new Set(layout.openings ?? []);
  const grid: React.ReactElement[] = [];
  for (let m = 1; m < L; m++) grid.push(<line key={'gx' + m} x1={X(m)} y1={PAD} x2={X(m)} y2={PAD + ih} stroke="rgba(111,161,201,0.09)" strokeWidth={0.6} />);
  for (let m = 1; m < W; m++) grid.push(<line key={'gy' + m} x1={PAD} y1={Y(m)} x2={PAD + iw} y2={Y(m)} stroke="rgba(111,161,201,0.09)" strokeWidth={0.6} />);
  const edges: [string, number, number, number, number][] = [
    ['back', X(0), PAD, X(L), PAD],
    ['front', X(0), PAD + ih, X(L), PAD + ih],
    ['left', PAD, Y(0), PAD, Y(W)],
    ['right', PAD + iw, Y(0), PAD + iw, Y(W)],
  ];
  return (
    <svg viewBox={`0 0 ${svgW} ${svgH}`} className="block w-full" style={{ background: '#0B0C0F' }} role="img" aria-label="展台俯视平面草图">
      {grid}
      {edges.map(([side, x1, y1, x2, y2]) => {
        const o = open.has(side);
        return <line key={side} x1={x1} y1={y1} x2={x2} y2={y2} stroke={o ? '#6FA1C9' : '#888F9C'} strokeWidth={1.5} strokeDasharray={o ? '3 3' : '0'} opacity={o ? 0.55 : 1} />;
      })}
      {layout.zones.map((z, i) => {
        const st = ZONE_STYLE[z.type ?? 'default'] ?? ZONE_STYLE.default;
        const cx = X(z.x) + (z.w * s) / 2,
          cy = Y(z.y) + (z.h * s) / 2;
        return (
          <g key={i}>
            <rect x={X(z.x)} y={Y(z.y)} width={Math.max(0, z.w * s)} height={Math.max(0, z.h * s)} fill={st.fill} stroke={st.stroke} strokeWidth={1} rx={2} />
            <text x={cx} y={z.note ? cy - 1 : cy + 2.5} textAnchor="middle" fontSize={7} fill="#ECEEF2" fontWeight={500}>
              {z.name}
            </text>
            {z.note && (
              <text x={cx} y={cy + 8} textAnchor="middle" fontSize={6} fill="#B3B9C4">
                {z.note}
              </text>
            )}
          </g>
        );
      })}
      <text x={PAD + iw / 2} y={svgH - 7} textAnchor="middle" fontSize={7.5} fill="#6FA1C9" fontFamily="monospace">
        ← {L}m →
      </text>
      <text x={11} y={PAD + ih / 2} textAnchor="middle" fontSize={7.5} fill="#6FA1C9" fontFamily="monospace" transform={`rotate(-90 11 ${PAD + ih / 2})`}>
        ← {W}m →
      </text>
      {layout.facing && (
        <text x={PAD + iw / 2} y={15} textAnchor="middle" fontSize={6.5} fill="#888F9C">
          ▲ {layout.facing}
        </text>
      )}
    </svg>
  );
}

/* ── 结构化选择卡片（present_choices 工具输出 → 可点击卡片 + 平面草图，零打字回传）── */
type ChoiceData = {
  intro?: string;
  locked?: string[];
  questions: { key: string; question: string; recommended?: number; options: { label: string; detail?: string; layout?: BoothLayout }[] }[];
};

// 方案定稿后大脑推来布局 → mount 自动弹编辑器（用此 layout 初始化）+ 卡片可重开 / 跳过。
function LayoutGate({ data, onOpen, onSkip, busy }: { data: { layout: BoothLayout; intro?: string }; onOpen: (l: BoothLayout) => void; onSkip: () => void; busy: boolean }) {
  const opened = useRef(false);
  useEffect(() => {
    if (!opened.current && data.layout) {
      opened.current = true;
      onOpen(data.layout); // 方案就绪信号到达即自动弹编辑器（onOpen=openEditor 是 prop，不触发 set-state 规则）
    }
  }, [data, onOpen]);
  return (
    <div className="w-full rounded-xl border border-accent/40 bg-accent-soft/25 p-3.5">
      <div className="mono-tag mb-1 text-accent">方案已就绪 · 布局精调</div>
      <p className="text-[13px] leading-relaxed text-ink-200">{data.intro || '编辑器已弹出——拖拽调整布局，确认后按它出 3D 图；不想调也可直接出。'}</p>
      <div className="mt-2.5 flex flex-wrap gap-2">
        <button type="button" disabled={busy} onClick={() => onOpen(data.layout)} className="u-press rounded-lg border border-accent/50 bg-accent-soft px-3.5 py-1.5 text-[12.5px] text-accent disabled:opacity-40">
          ✎ 打开编辑器
        </button>
        <button type="button" disabled={busy} onClick={onSkip} className="u-press rounded-lg border border-ink-600 px-3.5 py-1.5 text-[12.5px] text-ink-300 hover:text-ink-100 disabled:opacity-40">
          ⤴ 按原方案直接出图
        </button>
      </div>
    </div>
  );
}

function ChoiceCards({ data, onSubmit, busy }: { data: ChoiceData; onSubmit: (text: string) => void; busy: boolean }) {
  const [picks, setPicks] = useState<Record<string, number>>({});
  const [submitted, setSubmitted] = useState(false);
  const questions = data.questions ?? [];
  const fmt = (sel: Record<string, number>) =>
    questions.map((q) => `【${q.question}】→ ${q.options[sel[q.key]]?.label ?? '（未选）'}`).join('\n');
  const submit = (sel: Record<string, number>) => {
    if (busy || submitted) return;
    setSubmitted(true);
    onSubmit(`我的选择：\n${fmt(sel)}`);
  };
  const recommended = () => {
    const sel: Record<string, number> = {};
    questions.forEach((q) => {
      if (typeof q.recommended === 'number') sel[q.key] = q.recommended;
    });
    return sel;
  };
  const hasRec = questions.some((q) => typeof q.recommended === 'number');
  const allPicked = questions.length > 0 && questions.every((q) => picks[q.key] != null);

  if (submitted) {
    return (
      <div className="mono-tag flex items-center gap-2 rounded-lg border border-ink-800 bg-ink-850 px-3 py-2 text-ink-400">
        <span className="inline-block h-1.5 w-1.5 rounded-full bg-accent" /> 已提交选择
      </div>
    );
  }
  return (
    <div className="w-full space-y-4 rounded-xl border border-ink-800 bg-ink-850/50 p-4">
      {data.intro && <p className="text-[13.5px] leading-relaxed text-ink-200">{data.intro}</p>}
      {data.locked && data.locked.length > 0 && (
        <div className="rounded-lg border border-ink-800 bg-ink-900 p-3">
          <div className="mono-tag mb-1.5 text-ink-500">已锁定 / LOCKED</div>
          <ul className="space-y-1 text-[12.5px] text-ink-300">
            {data.locked.map((l, i) => (
              <li key={i}>· {l}</li>
            ))}
          </ul>
        </div>
      )}
      {questions.map((q) => (
        <div key={q.key} className="space-y-2">
          <div className="text-[13.5px] font-medium text-ink-50">{q.question}</div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {q.options.map((o, i) => {
              const active = picks[q.key] === i;
              const rec = q.recommended === i;
              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => setPicks((p) => ({ ...p, [q.key]: i }))}
                  className={`u-tap flex flex-col gap-2 rounded-lg border p-2.5 text-left ${active ? 'border-accent bg-accent-soft' : 'border-ink-700 bg-ink-900 hover:border-ink-600'}`}
                >
                  <div className="flex items-center gap-1.5">
                    <span className={`text-[12.5px] font-medium ${active ? 'text-accent' : 'text-ink-100'}`}>{o.label}</span>
                    {rec && <span className="mono-tag rounded bg-signal-soft px-1 py-0.5 text-signal">荐</span>}
                  </div>
                  {o.layout ? (
                    <div className="overflow-hidden rounded ring-1 ring-ink-800">
                      <FloorPlan layout={o.layout} />
                    </div>
                  ) : null}
                  {o.detail && <span className="text-[11px] leading-relaxed text-ink-400">{o.detail}</span>}
                </button>
              );
            })}
          </div>
        </div>
      ))}
      <div className="flex flex-wrap gap-2 pt-1">
        {hasRec && (
          <button
            type="button"
            disabled={busy}
            onClick={() => submit(recommended())}
            className="u-press rounded-lg bg-accent px-3.5 py-2 text-[13px] font-medium text-ink-950 transition hover:bg-accent-deep disabled:opacity-40"
          >
            按推荐来
          </button>
        )}
        <button
          type="button"
          disabled={busy || !allPicked}
          onClick={() => submit(picks)}
          className="u-press rounded-lg border border-ink-700 px-3.5 py-2 text-[13px] text-ink-100 transition hover:bg-ink-800 disabled:opacity-40"
        >
          提交所选
        </button>
      </div>
    </div>
  );
}

export default function Workbench() {
  const projectId = String(useParams().projectId ?? 'default');
  const router = useRouter();
  const [debug, setDebug] = useState(false);
  const [state, setState] = useState<ProjectState | null>(null);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [input, setInput] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [selectingCandidate, setSelectingCandidate] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [editor, setEditor] = useState<{ footprint: { length: number; width: number }; modules: LayoutModule[]; openings?: string[] } | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const pidRef = useRef(projectId);
  // 在 effect 里同步（不在 render 期间写 ref）：projectId 变更后下一次 commit 即更新 pidRef，
  // 供延迟存盘回调校验"是否还在同一项目"，防止旧项目的存盘串写到新项目。
  useEffect(() => {
    pidRef.current = projectId;
  }, [projectId]);

  const { messages, sendMessage, status, error, setMessages } = useChat({
    transport: new DefaultChatTransport({ api: '/api/agent', body: { projectId } }),
  });
  const busy = status === 'submitted' || status === 'streaming' || uploading;

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

  // 下面三个是异步数据获取 effect：都是 fetch 完成后才 setState（非同步 cascading render）。
  // 项目未引入 SWR/React Query，effect 是观察 projectId / useChat status 变化并拉取的唯一时机——
  // set-state-in-effect 规则针对的是"本可在 render 派生的同步 setState"，此处不适用，故对这一段豁免。
  /* eslint-disable react-hooks/set-state-in-effect */
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
  /* eslint-enable react-hooks/set-state-in-effect */
  // 待发送图片附件的本地预览 URL：用 useMemo 派生（不在 effect 里 setState），
  // 单独的 cleanup effect 在 files 变化 / 组件卸载时 revoke 上一批，避免内存泄漏。
  const filePreviews = useMemo(
    () => files.map((f) => (f.type.startsWith('image/') ? URL.createObjectURL(f) : null)),
    [files],
  );
  useEffect(() => () => filePreviews.forEach((u) => u && URL.revokeObjectURL(u)), [filePreviews]);
  // 切换 / 重载项目：先清空（避免串项目残留），再拉取该项目的对话历史恢复 messages
  useEffect(() => {
    let cancelled = false;
    setMessages([]);
    (async () => {
      try {
        const r = await fetch(`/api/projects/${projectId}/messages`, { cache: 'no-store' });
        if (!r.ok || cancelled) return;
        const data = (await r.json()) as { messages?: unknown };
        if (!cancelled && Array.isArray(data.messages) && data.messages.length) {
          setMessages(data.messages as typeof messages);
        }
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, setMessages]);
  // 持久化：messages 一变就 debounce 存盘（流式中也存，确保任何跳转/刷新都不丢对话）。
  // 用 pidRef 校验：debounce 触发时若已切走项目，不把旧消息存到新项目。
  useEffect(() => {
    if (messages.length === 0) return;
    const pid = projectId;
    const t = setTimeout(() => {
      if (pidRef.current !== pid) return; // 已切项目，放弃这次存盘
      void fetch(`/api/projects/${pid}/messages`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ messages }),
      }).catch(() => {});
    }, 700);
    return () => clearTimeout(t);
  }, [messages, projectId]);
  // 新消息 / 流式更新时滚到底
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, busy]);

  const uploadFiles = async (pending: File[]): Promise<FileUIPart[]> => {
    if (!pending.length) return [];
    const fd = new FormData();
    pending.forEach((f) => fd.append('files', f));
    const r = await fetch(`/api/projects/${projectId}/attachments`, { method: 'POST', body: fd });
    if (!r.ok) throw new Error('attachment upload failed');
    const d = (await r.json()) as { files?: FileUIPart[] };
    return d.files ?? [];
  };

  const send = async (text: string) => {
    if ((!text.trim() && files.length === 0) || busy) return;
    const pending = files;
    setUploading(true);
    try {
      const uploaded = await uploadFiles(pending);
      void sendMessage({ text: text.trim() || '（请看附件）', files: uploaded }).catch(() => alert('发送失败，请稍后重试。'));
      setInput('');
      setFiles([]);
    } catch {
      alert('附件上传失败，请稍后重试。');
    } finally {
      setUploading(false);
    }
  };

  const selectCandidate = async (assetId?: string) => {
    if (!assetId || busy || selectingCandidate) return;
    setSelectingCandidate(assetId);
    try {
      const r = await fetch(`/api/projects/${projectId}/assets/${assetId}/promote`, { method: 'POST' });
      if (!r.ok) throw new Error('promote failed');
      await refreshState();
      await refreshProjects();
    } catch {
      alert('选择候选图失败，请稍后重试。');
    } finally {
      setSelectingCandidate(null);
    }
  };

  // 打开布局编辑器，预填所选方案的布局（present_choices 的 layout → 可编辑模块）
  const openEditor = (layout: BoothLayout) => {
    setEditor({
      footprint: { length: layout.length, width: layout.width },
      openings: layout.openings,
      modules: (layout.zones || []).map((z, i) => ({ id: 'z' + i, name: z.name, type: z.type || 'default', shape: 'rect' as const, x: z.x, y: z.y, w: z.w, h: z.h })),
    });
  };
  // 编辑器确认：截图存为 reference 资产 → 发消息让大脑用 render（planAssetId）按它出图
  const handleEditorConfirm = async (dataUrl: string) => {
    setEditor(null);
    try {
      const r = await fetch(`/api/projects/${projectId}/reference`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ png: dataUrl }),
      });
      const d = (await r.json()) as { assetId?: string };
      if (d.assetId) void send(`已用布局编辑器定稿平面图（参考资产 ${d.assetId}）。请用 render（planAssetId=该参考资产，views=[]，n=2，autoCheck=false）按这张平面图先生成两张首稿主图候选，暂时不要出多视角/俯视/自动精修，等我选择基准图后再继续。`);
    } catch {
      /* ignore */
    }
  };
  // 跳过精调：关编辑器 + 让大脑按原方案布局直接出图
  const handleEditorSkip = () => {
    setEditor(null);
    void fetch(`/api/projects/${projectId}/layout`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ decision: 'skipped' }),
    }).finally(() => {
      void send('不精调了，按原方案的布局直接出图。请调用 render（views=[]，n=2，autoCheck=false）先生成两张首稿主图候选，暂时不要出多视角/俯视/自动精修，等我选择基准图后再继续。');
    });
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

  let progress = '大脑思考中';
  let activeTool = '';
  for (const m of messages) {
    if (m.role !== 'assistant') continue;
    for (const p of m.parts) {
      if (isToolUIPart(p)) {
        const tp = p as unknown as ToolPartLike;
        if (tp.state !== 'output-available' && tp.state !== 'output-error') {
          activeTool = getToolName(p);
          progress = PROGRESS[activeTool] ?? progress;
        }
      }
    }
  }
  // 副标只在真正生图的工具阶段提示"生图较慢"，读状态/写方案等阶段不误导
  const isRendering = ['render', 'revise_asset'].includes(activeTool);

  const assets = (state?.assets ?? []).slice().reverse();
  const deliveryPreviewUrls = useMemo(
    () => messages.flatMap((m) => (m.role === 'assistant' ? extractDeliveries(m.parts).flatMap((g) => g.items.map((i) => i.url)) : [])),
    [messages],
  );
  const allPreviewUrls = useMemo(() => uniqueUrls([...deliveryPreviewUrls, ...assets.map((a) => a.url), ...filePreviews]), [deliveryPreviewUrls, assets, filePreviews]);
  const openPreview = useCallback<OpenPreview>(
    (url: string, urls?: Array<string | null | undefined>) => {
      const scoped = uniqueUrls(urls?.length ? urls : allPreviewUrls);
      const nextUrls = scoped.length ? scoped : [url];
      const idx = nextUrls.indexOf(url);
      setPreview({ urls: nextUrls, index: idx >= 0 ? idx : 0, zoom: 1 });
    },
    [allPreviewUrls],
  );
  const shiftPreview = useCallback((delta: number) => {
    setPreview((p) => (p && p.urls.length > 1 ? { ...p, index: (p.index + delta + p.urls.length) % p.urls.length, zoom: 1 } : p));
  }, []);
  const zoomPreview = useCallback((delta: number) => {
    setPreview((p) => (p ? { ...p, zoom: clampZoom(p.zoom + delta) } : p));
  }, []);
  useEffect(() => {
    if (!preview) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPreview(null);
      else if (e.key === 'ArrowLeft') shiftPreview(-1);
      else if (e.key === 'ArrowRight') shiftPreview(1);
      else if (e.key === '+' || e.key === '=') zoomPreview(0.2);
      else if (e.key === '-') zoomPreview(-0.2);
      else if (e.key === '0') setPreview((p) => (p ? { ...p, zoom: 1 } : p));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [preview, shiftPreview, zoomPreview]);
  // 新建的空项目还没落盘（listProjects 扫不到），前端补一个置顶项以便高亮显示
  const shownProjects = projects.some((p) => p.id === projectId)
    ? projects
    : [{ id: projectId, title: projectId === 'default' ? '默认项目' : '新项目', assetCount: 0, updatedAt: '' }, ...projects];
  const currentTitle = shownProjects.find((p) => p.id === projectId)?.title ?? projectId;

  return (
    <main className="flex h-dvh overflow-hidden bg-ink-900 text-ink-100">
      {/* ───────── 左：项目面板 ───────── */}
      <nav className="flex w-64 shrink-0 flex-col border-r border-ink-800 bg-ink-950">
        {/* 品牌头 */}
        <div className="flex items-center gap-2.5 px-4 pt-5 pb-4">
          <span className="inline-block h-2 w-2 shrink-0 rounded-[2px] bg-signal" />
          <span className="text-[15px] font-semibold tracking-[0.14em] text-ink-50">RHEMOS</span>
          <span className="mono-tag ml-auto text-ink-500">v2</span>
        </div>

        <div className="px-3 pb-3">
          <button
            onClick={() => router.push(`/projects/${newProjectId()}`)}
            className="u-tap u-press flex w-full items-center justify-center gap-2 rounded-lg border border-ink-700 bg-ink-850 py-2.5 text-[13px] font-medium text-ink-100 hover:border-accent/60 hover:bg-ink-800 hover:text-white"
          >
            <PlusIcon /> 新建项目
          </button>
        </div>

        <div className="mono-tag px-4 pb-2 text-ink-500">项目 / Projects</div>
        <div className="flex-1 space-y-1 overflow-y-auto px-2 pb-2">
          {shownProjects.length === 0 && <p className="px-2 py-4 text-xs text-ink-500">还没有项目</p>}
          {shownProjects.map((p, i) => {
            const active = p.id === projectId;
            return (
              <div
                key={p.id}
                onClick={() => !active && router.push(`/projects/${p.id}`)}
                className={`group relative flex cursor-pointer items-center gap-2.5 rounded-lg p-2 u-tap ${
                  active ? 'bg-ink-800' : 'hover:bg-ink-850'
                }`}
              >
                {/* active 左光条 */}
                {active && <span className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-full bg-accent" />}
                {p.thumbnailUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={p.thumbnailUrl} alt="" className="h-10 w-10 shrink-0 rounded-md object-cover ring-1 ring-ink-700" />
                ) : (
                  <div className="bp-grid-fine grid h-10 w-10 shrink-0 place-items-center rounded-md bg-ink-900 ring-1 ring-ink-700">
                    <span className="mono-tag text-ink-600">{String(i + 1).padStart(2, '0')}</span>
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className={`truncate text-[13px] ${active ? 'font-medium text-ink-50' : 'text-ink-200'}`}>{p.title}</div>
                  <div className="mono-tag mt-0.5 text-ink-500">
                    {p.assetCount} 张{p.updatedAt ? ` · ${timeAgo(p.updatedAt)}` : ''}
                  </div>
                </div>
                {p.id !== 'default' && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      void deleteProj(p.id);
                    }}
                    className="u-tap absolute right-1.5 hidden shrink-0 rounded-md p-1.5 text-ink-500 hover:bg-ink-700 hover:text-signal group-hover:block"
                    title="删除项目"
                  >
                    <TrashIcon />
                  </button>
                )}
              </div>
            );
          })}
        </div>

        <label className="flex cursor-pointer items-center gap-2 border-t border-ink-800 px-4 py-3 text-[12px] text-ink-400 hover:text-ink-200">
          <span
            className={`relative inline-flex h-4 w-7 items-center rounded-full transition-colors ${debug ? 'bg-accent' : 'bg-ink-700'}`}
          >
            <span className={`h-3 w-3 rounded-full bg-white transition-transform ${debug ? 'translate-x-3.5' : 'translate-x-0.5'}`} />
          </span>
          <input type="checkbox" checked={debug} onChange={(e) => setDebug(e.target.checked)} className="sr-only" />
          <span className="mono-tag">调试视图</span>
        </label>
      </nav>

      {/* ───────── 中：对话 ───────── */}
      <section className="flex min-w-0 flex-1 flex-col bg-ink-900">
        <header className="flex shrink-0 items-center justify-between border-b border-ink-800 px-6 py-3.5">
          <h1 className="truncate text-[15px] font-medium text-ink-50">{currentTitle}</h1>
          <span className="mono-tag flex shrink-0 items-center gap-1.5 text-ink-400">
            <span className={`h-1.5 w-1.5 rounded-full ${busy ? 'bg-signal pulse-dot' : 'bg-accent'}`} />
            {busy ? '在制中' : 'READY'}
          </span>
        </header>

        <div ref={scrollRef} className="bp-grid flex-1 overflow-y-auto px-6 py-6">
          <div className="mx-auto flex max-w-3xl flex-col gap-6">
            {messages.length === 0 && (
              <div className="fade-up mt-[10vh] flex flex-col items-center text-center">
                <span className="mono-tag text-ink-600">RHEMOS · BOOTH DESIGN AGENT</span>
                <h2 className="mt-4 max-w-md text-2xl font-semibold leading-snug text-ink-50">说出你的展台需求</h2>
                <p className="mt-3 max-w-md text-[13.5px] leading-relaxed text-ink-300">
                  也可上传参考图 / PDF / Word / Excel。Rhemos 会澄清 → 写方案 → 并行生图 → 客观择优 → 交付。深化、换风格、多视角、修改都直接对它说。
                </p>
                <div className="mt-7 flex w-full max-w-lg flex-col gap-2">
                  {SUGGESTIONS.map((s, i) => (
                    <button
                      key={s}
                      onClick={() => {
                        setInput(s);
                        inputRef.current?.focus();
                      }}
                      className="u-tap group flex items-center gap-3 rounded-lg border border-ink-800 bg-ink-850/60 px-4 py-3 text-left text-[13px] text-ink-200 hover:border-accent/50 hover:bg-ink-800 hover:text-ink-50"
                    >
                      <span className="mono-tag text-ink-600 group-hover:text-accent">{String(i + 1).padStart(2, '0')}</span>
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((m) => {
              const deliveries = m.role === 'assistant' ? extractDeliveries(m.parts) : [];
              const isUser = m.role === 'user';
              return (
                <div key={m.id} className={`fade-up flex flex-col gap-2 ${isUser ? 'items-end' : 'items-start'}`}>
                  {!isUser && (
                    <div className="mono-tag flex items-center gap-1.5 text-ink-500">
                      <span className="inline-block h-1.5 w-1.5 rounded-[1px] bg-accent" /> RHEMOS
                    </div>
                  )}
                  <div className={`flex flex-col gap-2 ${isUser ? 'items-end' : 'w-full items-start'}`}>
                    {m.parts.map((part, i) => {
                      if (part.type === 'text') {
                        if (!part.text.trim()) return null;
                        return isUser ? (
                          <div key={i} className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-ink-800 px-4 py-2.5 text-[14px] leading-relaxed text-ink-50">
                            {part.text}
                          </div>
                        ) : (
                          <div key={i} className="w-full">
                            <Prose>{part.text}</Prose>
                          </div>
                        );
                      }
                      if (part.type === 'file') {
                        const fp = part as unknown as { url?: string; mediaType?: string; filename?: string };
                        if (fp.mediaType?.startsWith('image/') && fp.url) {
                          return (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img key={i} src={fp.url} alt="附件" onClick={() => openPreview(fp.url!)} className="max-h-44 cursor-zoom-in rounded-lg ring-1 ring-ink-700 transition hover:ring-accent/60" title="点击放大" />
                          );
                        }
                        return (
                          <div key={i} className="flex items-center gap-2 rounded-lg border border-ink-700 bg-ink-850 px-3 py-2 text-[12px] text-ink-300">
                            <PaperclipIcon className="text-ink-500" /> {fp.filename ?? '附件'}
                          </div>
                        );
                      }
                      // present_choices：始终渲染成可点击卡片（用户交互，非调试）
                      if (isToolUIPart(part) && getToolName(part) === 'present_choices') {
                        const tp = part as unknown as ToolPartLike;
                        if (tp.state === 'output-available' && tp.output) {
                          return <ChoiceCards key={i} data={tp.output as ChoiceData} onSubmit={(t) => void send(t)} busy={busy} />;
                        }
                        return null;
                      }
                      // present_layout：方案后推布局 → 自动弹编辑器 + 精调/跳过卡片
                      if (isToolUIPart(part) && getToolName(part) === 'present_layout') {
                        const tp = part as unknown as ToolPartLike;
                        if (tp.state === 'output-available' && tp.output) {
                          return <LayoutGate key={i} data={tp.output as { layout: BoothLayout; intro?: string }} onOpen={openEditor} onSkip={handleEditorSkip} busy={busy} />;
                        }
                        return null;
                      }
                      if (debug && isToolUIPart(part)) {
                        const tp = part as unknown as ToolPartLike;
                        return (
                          <details key={i} className="w-full rounded-lg border border-ink-700 bg-ink-850 p-2 text-[11px]">
                            <summary className="mono-tag cursor-pointer text-accent">
                              {getToolName(part)} · {tp.state}
                            </summary>
                            {tp.input != null && <pre className="mt-2 max-h-40 overflow-auto font-mono text-[11px] text-ink-400">{JSON.stringify(tp.input, null, 2)}</pre>}
                            {tp.output != null && <pre className="mt-2 max-h-40 overflow-auto font-mono text-[11px] text-ink-200">{JSON.stringify(tp.output, null, 2)}</pre>}
                          </details>
                        );
                      }
                      return null;
                    })}

                    {deliveries.map((g, gi) =>
                      g.grouped ? (
                        <ViewSet key={gi} group={g} onZoom={openPreview} />
                      ) : (
                        <div key={gi} className={`mt-1 w-full gap-3 ${g.type === 'candidate-set' ? 'grid sm:grid-cols-2' : 'flex flex-wrap'}`}>
                          {g.items.map((img, ii) => {
                            const rec = img.recommended;
                            const candidate = g.type === 'candidate-set';
                            const selected = !!img.assetId && state?.baseAssetId === img.assetId;
                            const groupUrls = g.items.map((item) => item.url);
                            return (
                              <figure key={img.url} className="group relative m-0">
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                  src={img.url}
                                  alt="交付结果"
                                  onClick={() => openPreview(img.url, groupUrls)}
                                  className={`max-h-96 cursor-zoom-in rounded-xl object-contain ring-1 transition group-hover:brightness-105 ${candidate ? 'w-full' : ''} ${rec ? 'ring-signal/40' : 'ring-ink-700'}`}
                                  title="点击放大"
                                />
                                <figcaption
                                  className={`mono-tag absolute left-3 top-3 flex items-center gap-1 rounded-md px-2 py-1 backdrop-blur-sm ${
                                    rec ? 'bg-signal/15 text-signal' : 'bg-ink-950/60 text-ink-200'
                                  }`}
                                >
                                  {rec && <span className="inline-block h-1.5 w-1.5 rounded-full bg-signal" />}
                                  {candidate ? `候选 ${ii + 1}` : rec ? '推荐交付' : '交付'}
                                </figcaption>
                                {candidate && (
                                  <button
                                    type="button"
                                    disabled={!img.assetId || busy || selectingCandidate != null || selected}
                                    onClick={() => void selectCandidate(img.assetId)}
                                    className="u-press mt-2 w-full rounded-lg border border-accent/50 bg-accent-soft px-3 py-1.5 text-[12px] text-accent disabled:opacity-40"
                                  >
                                    {selected ? '已选为基准' : selectingCandidate === img.assetId ? '登记中…' : '选为基准'}
                                  </button>
                                )}
                              </figure>
                            );
                          })}
                        </div>
                      ),
                    )}
                  </div>
                </div>
              );
            })}

            {busy && (
              <div className="fade-up flex items-center gap-3 rounded-lg border border-ink-800 bg-ink-850 px-4 py-3">
                <span className="relative flex h-4 w-4 items-center justify-center">
                  <span className="absolute h-4 w-4 rounded-full border border-accent/30" />
                  <span className="h-2 w-2 rounded-full bg-accent pulse-dot" />
                </span>
                <span className="text-[13px] text-ink-100">{progress}…</span>
                <span className="mono-tag ml-auto text-ink-500">{isRendering ? 'RENDERING · 生图较慢' : 'WORKING'}</span>
              </div>
            )}
            {error && !busy && (
              <div className="rounded-lg border border-signal/30 bg-signal-soft px-4 py-3 text-[13px] text-signal">
                出错了，请重试一次。若反复失败，点左上角「新建项目」重开对话。
              </div>
            )}
          </div>
        </div>

        {/* composer */}
        <div className="shrink-0 px-6 pb-6 pt-2">
          <div className="mx-auto max-w-3xl">
            {files.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-2">
                {files.map((f, i) => {
                  const url = filePreviews[i];
                  const ext = (f.name.split('.').pop() || 'file').toUpperCase();
                  return (
                    <div key={i} className="group relative">
                      {url ? (
                        <>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={url}
                            alt={f.name}
                            onClick={() => openPreview(url, filePreviews)}
                            className="h-14 w-14 cursor-zoom-in rounded-lg object-cover ring-1 ring-ink-700"
                            title="点击放大"
                          />
                          <div className="pointer-events-none absolute bottom-full left-0 z-30 mb-2 hidden group-hover:block">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={url} alt="" className="max-h-64 max-w-xs rounded-lg ring-1 ring-ink-600 shadow-2xl shadow-black/60" />
                          </div>
                        </>
                      ) : (
                        <div className="flex h-14 w-48 items-center gap-2.5 rounded-lg border border-ink-700 bg-ink-850 px-2.5" title={f.name}>
                          <div className="mono-tag grid h-9 w-9 shrink-0 place-items-center rounded-md bg-accent-soft text-accent">{ext.slice(0, 4)}</div>
                          <span className="truncate text-[12px] text-ink-200">{f.name}</span>
                        </div>
                      )}
                      <button
                        type="button"
                        onClick={() => setFiles(files.filter((_, j) => j !== i))}
                        title="移除"
                        className="absolute -right-1.5 -top-1.5 z-10 hidden h-5 w-5 items-center justify-center rounded-full bg-ink-700 text-ink-100 ring-2 ring-ink-900 hover:bg-signal group-hover:flex"
                      >
                        <CloseIcon className="h-3 w-3" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}

            <div className="u-tap rounded-2xl border border-ink-700 bg-ink-850 p-2.5 focus-within:border-accent/60 focus-within:shadow-[0_0_0_3px] focus-within:shadow-accent/10">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  // Enter 发送；Shift+Enter 换行；输入法组字中不误发
                  if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    void send(input);
                  }
                }}
                rows={1}
                placeholder="描述你的展台需求，或粘贴 / 上传参考资料…"
                className="max-h-40 min-h-[40px] w-full resize-none bg-transparent px-2 py-1.5 text-[14px] leading-relaxed text-ink-50 outline-none placeholder:text-ink-500"
              />
              <div className="mt-1 flex items-center gap-1.5">
                {/* label 关联触发：浏览器原生打开文件框，不依赖 .click()（避免 display:none 在 Safari 点击无反应）。input 用 sr-only。 */}
                <input
                  id="rhemos-upload"
                  type="file"
                  multiple
                  accept="image/*,.pdf,.docx,.xlsx,.xls"
                  className="sr-only"
                  onChange={(e) => {
                    // 必须先同步读出文件再清空：setFiles 的 updater 是延迟闭包，
                    // 若在其中读 e.target.files 会读到被下一行 value='' 清空后的空列表（经典 React 事件陷阱）。
                    const picked = Array.from(e.target.files ?? []);
                    e.target.value = '';
                    if (picked.length) setFiles((cur) => [...cur, ...picked]);
                  }}
                />
                <label
                  htmlFor="rhemos-upload"
                  title="上传图片 / PDF / Word / Excel"
                  className={`u-tap flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-lg text-ink-400 hover:bg-ink-700 hover:text-ink-100 ${busy ? 'pointer-events-none opacity-40' : ''}`}
                >
                  <PaperclipIcon />
                </label>
                <VoiceInputButton disabled={busy} onTranscribed={(t) => setInput((c) => (c.trim() ? `${c.trim()} ${t}` : t))} />
                <span className="mono-tag ml-auto hidden text-ink-600 sm:block">Enter 发送 · Shift+Enter 换行</span>
                <button
                  type="button"
                  onClick={() => void send(input)}
                  disabled={busy || (!input.trim() && files.length === 0)}
                  className="u-press flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent text-ink-950 transition hover:bg-accent-deep disabled:bg-ink-700 disabled:text-ink-500"
                  title="发送"
                >
                  <SendIcon />
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ───────── 右：资产画廊 ───────── */}
      <aside className="flex w-72 shrink-0 flex-col border-l border-ink-800 bg-ink-950">
        <header className="flex shrink-0 items-baseline justify-between border-b border-ink-800 px-4 py-3.5">
          <span className="mono-tag text-ink-400">资产 / Assets</span>
          <span className="font-mono text-[15px] tabular-nums text-ink-100">{String(assets.length).padStart(2, '0')}</span>
        </header>
        <div className="flex-1 overflow-y-auto p-3">
          {assets.length === 0 && (
            <div className="bp-grid-fine mt-6 rounded-lg border border-dashed border-ink-700 px-4 py-10 text-center">
              <p className="text-[12.5px] leading-relaxed text-ink-500">还没有图。<br />对中间说出需求即可生成。</p>
            </div>
          )}
          <div className="flex flex-col gap-3">
            {assets.map((a, idx) => (
              <figure key={a.id} className="u-tap group m-0 overflow-hidden rounded-lg border border-ink-800 bg-ink-900 hover:border-ink-600">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={a.url} alt={a.kind} onClick={() => openPreview(a.url, assets.map((asset) => asset.url))} className="w-full cursor-zoom-in transition group-hover:brightness-105" title="点击放大" />
                <figcaption className="flex items-center justify-between px-2.5 py-2">
                  <span className="flex items-center gap-1.5">
                    <span className="mono-tag text-ink-600">#{String(assets.length - idx).padStart(2, '0')}</span>
                    {idx === 0 && <span className="mono-tag rounded bg-accent-soft px-1.5 py-0.5 text-accent">最新</span>}
                    <span className="text-[11px] text-ink-300">{assetKindLabel(a.kind)}</span>
                  </span>
                  <a href={a.url} download className="u-tap rounded-md p-1 text-ink-400 hover:bg-ink-800 hover:text-ink-100" title="下载">
                    <DownloadIcon />
                  </a>
                </figcaption>
              </figure>
            ))}
          </div>
        </div>
      </aside>

      {/* ───────── lightbox ───────── */}
      {preview && (
        <div onClick={() => setPreview(null)} className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-ink-950/92 p-8 backdrop-blur-sm">
          <div className="mono-tag mb-3 flex items-center gap-2 text-ink-400">
            <span className="h-1.5 w-1.5 rounded-full bg-accent" />
            预览 · {preview.index + 1}/{preview.urls.length} · {Math.round(preview.zoom * 100)}%
          </div>
          <div className="mb-3 flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
            <button type="button" onClick={() => shiftPreview(-1)} disabled={preview.urls.length < 2} className="u-tap rounded-lg border border-ink-700 bg-ink-850 px-3 py-1.5 text-[12px] text-ink-200 disabled:opacity-35" title="上一张">
              ←
            </button>
            <button type="button" onClick={() => zoomPreview(-0.2)} className="u-tap rounded-lg border border-ink-700 bg-ink-850 px-3 py-1.5 text-[12px] text-ink-200" title="缩小">
              -
            </button>
            <button type="button" onClick={() => setPreview((p) => (p ? { ...p, zoom: 1 } : p))} className="u-tap rounded-lg border border-ink-700 bg-ink-850 px-3 py-1.5 text-[12px] text-ink-200" title="重置缩放">
              1:1
            </button>
            <button type="button" onClick={() => zoomPreview(0.2)} className="u-tap rounded-lg border border-ink-700 bg-ink-850 px-3 py-1.5 text-[12px] text-ink-200" title="放大">
              +
            </button>
            <button type="button" onClick={() => shiftPreview(1)} disabled={preview.urls.length < 2} className="u-tap rounded-lg border border-ink-700 bg-ink-850 px-3 py-1.5 text-[12px] text-ink-200 disabled:opacity-35" title="下一张">
              →
            </button>
          </div>
          <div
            onClick={(e) => e.stopPropagation()}
            onWheel={(e) => {
              e.preventDefault();
              zoomPreview(e.deltaY < 0 ? 0.15 : -0.15);
            }}
            className="flex max-h-[82vh] w-full max-w-[92vw] items-center justify-center overflow-auto"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={preview.urls[preview.index]}
              alt="预览"
              style={{ transform: `scale(${preview.zoom})` }}
              className="origin-center rounded-xl ring-1 ring-ink-700 shadow-2xl shadow-black/70 transition-transform"
            />
          </div>
        </div>
      )}

      {editor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink-950/92 p-6 backdrop-blur-sm">
          <div className="max-h-full overflow-auto rounded-xl border border-ink-800 bg-ink-900 p-5">
            <div className="mb-3 flex items-center justify-between gap-4">
              <span className="text-[14px] font-medium text-ink-50">布局编辑器 · 拖拽 / 缩放 / 改形状，确认后按它出 3D 图</span>
              <button type="button" onClick={handleEditorSkip} className="u-press shrink-0 rounded-lg border border-ink-600 px-3 py-1.5 text-[12px] text-ink-300 hover:text-ink-100">
                ⤴ 按原方案直接出
              </button>
            </div>
            <LayoutEditorDyn footprint={editor.footprint} initial={editor.modules} openings={editor.openings} onConfirm={handleEditorConfirm} onCancel={() => setEditor(null)} />
          </div>
        </div>
      )}
    </main>
  );
}
