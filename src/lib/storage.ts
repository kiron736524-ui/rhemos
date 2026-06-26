import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import type { Asset, AssetAnalysis, Attachment, AttachmentKind, AttachmentUseRef, BoothLayout, Deliverable, DesignSpec, ProjectState, ProjectSummary, RenderInputSnapshot, RunBudget, RunEvent, RunRecord, RunStatus } from './types';

// 本地文件系统存储（Phase 4：projectId-keyed 隔离 + per-project 写锁；DB/Blob 留 Phase 5）。
const ROOT = path.join(/*turbopackIgnore: true*/ process.cwd(), '.data', 'projects');
export const DEFAULT_PROJECT = 'default';

const projDir = (id: string) => path.join(ROOT, id);
const assetsDir = (id: string) => path.join(projDir(id), 'assets');
const attachmentsDir = (id: string) => path.join(projDir(id), 'attachments');
const runsDir = (id: string) => path.join(projDir(id), 'runs');
const candidatesDir = (id: string) => path.join(projDir(id), 'candidates');
const renderInputsDir = (id: string) => path.join(projDir(id), 'render-inputs');
const analysesDir = (id: string) => path.join(projDir(id), 'asset-analyses');
const statePath = (id: string) => path.join(projDir(id), 'state.json');

/** 从工具的 experimental_context 取 projectId（由 /api/agent 注入）；非法则回退 default。 */
export function projectIdFromContext(ctx: unknown): string {
  const id = (ctx as { projectId?: unknown } | undefined)?.projectId;
  return typeof id === 'string' && /^[\w-]+$/.test(id) ? id : DEFAULT_PROJECT;
}

export function runIdFromContext(ctx: unknown): string | null {
  const id = (ctx as { runId?: unknown } | undefined)?.runId;
  return typeof id === 'string' && /^[\w-]+$/.test(id) ? id : null;
}

// 墓碑：进程内已删除项目集合。删除后若仍有飞行中的生图/存盘回来，命中墓碑即跳过写盘，
// 杜绝"删完又被重建复活"。跨进程无需持久化——进程重启后已删目录本就不存在。
// （完整的长任务取消 / run 队列归 Phase 5，这里只堵住数据正确性这一处。）
const tombstoned = new Set<string>();

// per-project 写串行化：同一 project 的并发请求不竞写 state.json（进程内；跨进程需 DB，Phase 5）。
const locks = new Map<string, Promise<unknown>>();
function withLock<T>(id: string, fn: () => Promise<T>): Promise<T> {
  const run = (locks.get(id) ?? Promise.resolve()).then(fn, fn);
  locks.set(
    id,
    run.then(
      () => {},
      () => {},
    ),
  );
  return run;
}

/** 原子写：先写临时文件再 rename（同目录 rename 在常见文件系统是原子操作），避免崩溃/并发产生半截 JSON。 */
async function writeFileAtomic(file: string, data: string | Uint8Array): Promise<void> {
  const tmp = `${file}.tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await writeFile(tmp, data);
  await rename(tmp, file);
}

const emptyState = (id: string): ProjectState => ({ id, brief: {}, assets: [], updatedAt: new Date().toISOString() });

export async function readState(id: string = DEFAULT_PROJECT): Promise<ProjectState> {
  const p = statePath(id);
  if (!existsSync(p)) return emptyState(id);
  try {
    return JSON.parse(await readFile(p, 'utf8')) as ProjectState;
  } catch (e) {
    // 损坏的 state.json 不再让整个项目 500：备份为 .corrupt 保留证据，回退空态（不静默覆盖丢数据）。
    console.error(`[storage] state.json 解析失败（${id}）：${e instanceof Error ? e.message : e}；备份为 .corrupt 并回退空态`);
    try {
      await rename(p, `${p}.corrupt-${Date.now()}`);
    } catch {
      /* 备份失败也不阻断 */
    }
    return emptyState(id);
  }
}

async function writeStateUnlocked(state: ProjectState): Promise<void> {
  if (tombstoned.has(state.id)) return; // 项目已删除，绝不重建其状态文件
  await mkdir(projDir(state.id), { recursive: true });
  state.updatedAt = new Date().toISOString();
  await writeFileAtomic(statePath(state.id), JSON.stringify(state, null, 2));
}

/** 生图输入快照用的 spec/layout 轻量摘要（render / revise 共用，避免两处各抄一份）。 */
export function buildSnapshotSummaries(s: ProjectState): Pick<RenderInputSnapshot, 'specSummary' | 'layoutSummary'> {
  return {
    specSummary: { hasSpec: !!s.spec, identity: s.spec?.identity, invariants: s.spec?.invariants, selfCheckCriteria: s.spec?.selfCheckCriteria, updatedAt: s.spec?.updatedAt },
    layoutSummary: s.layout ? { status: s.layout.status, planAssetId: s.layout.planAssetId, proposal: s.layout.proposal } : undefined,
  };
}

export function writeState(state: ProjectState): Promise<void> {
  return withLock(state.id, () => writeStateUnlocked(state));
}

export function setSpec(id: string, spec: DesignSpec): Promise<void> {
  return withLock(id, async () => {
    const s = await readState(id);
    s.spec = spec;
    // 新 spec 会改变空间骨架，旧布局决策不再可信，必须重新 present_layout / 确认或跳过。
    s.layout = undefined;
    await writeStateUnlocked(s);
  });
}

/** 增量并入已确认的 brief 事实（用户拍板的面积/墙高/行业/品牌/必答约束等）。
 *  brief 是跨轮的业务记忆——澄清确认后立即落盘，read_project_state 据此避免重复追问、保持上下文。 */
export function mergeBrief(id: string, patch: Record<string, unknown>): Promise<void> {
  return withLock(id, async () => {
    const s = await readState(id);
    // 自由 patch 增量并入；brief 是 BoothBrief & Record（强类型骨架 + 自由键），
    // 自由 record 合并后类型收窄不到强类型字段，故按交叉类型断言（运行时即纯对象展开）。
    s.brief = { ...s.brief, ...patch } as ProjectState['brief'];
    await writeStateUnlocked(s);
  });
}

const candidatePath = (id: string, assetId: string) => path.join(candidatesDir(id), `${assetId}.json`);

type AssetMeta = Pick<Asset, 'kind'> &
  Partial<Pick<Asset, 'prompt' | 'parentId' | 'provider' | 'model' | 'quality' | 'size' | 'mode' | 'durationMs' | 'renderInputId' | 'sourceAttachmentIds' | 'sourceAssetIds'>>;

/**
 * 存一张生成图（saveAsset / saveCandidateAsset 的统一实现，去除两者 ~90% 重复）。
 * candidate=false（默认）→ 正式资产，push 进 state.assets；
 * candidate=true → 只落 PNG + candidates/<id>.json 旁证，不进资产库（用户 promote 后才入库）。
 * 文件名唯一、原子写；tombstone 项目直接丢弃返回（不重建已删目录）。
 */
export async function saveAssetFile(id: string, bytes: Uint8Array, meta: AssetMeta, opts: { candidate?: boolean } = {}): Promise<Asset> {
  const candidate = opts.candidate ?? false;
  const assetId = `${candidate ? 'candidate' : meta.kind}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const file = path.join(assetsDir(id), `${assetId}.png`);
  const asset: Asset = {
    id: assetId,
    kind: meta.kind,
    prompt: meta.prompt,
    parentId: meta.parentId,
    provider: meta.provider,
    model: meta.model,
    quality: meta.quality,
    size: meta.size,
    mode: meta.mode,
    durationMs: meta.durationMs,
    renderInputId: meta.renderInputId,
    sourceAttachmentIds: meta.sourceAttachmentIds,
    sourceAssetIds: meta.sourceAssetIds,
    path: path.relative(process.cwd(), file),
    url: `/api/assets/${assetId}?project=${id}`,
    createdAt: new Date().toISOString(),
  };
  if (tombstoned.has(id)) return asset; // 项目已删除：丢弃飞行中的生图结果，绝不重建已删目录
  await mkdir(assetsDir(id), { recursive: true });
  await writeFileAtomic(file, bytes); // 唯一文件名，无需锁
  if (candidate) {
    await mkdir(candidatesDir(id), { recursive: true });
    await writeFileAtomic(candidatePath(id, assetId), JSON.stringify(asset, null, 2));
  } else {
    await withLock(id, async () => {
      const s = await readState(id);
      s.assets.push(asset);
      await writeStateUnlocked(s);
    });
  }
  return asset;
}

/** 正式资产（进 state.assets）。 */
export const saveAsset = (id: string, bytes: Uint8Array, meta: AssetMeta): Promise<Asset> => saveAssetFile(id, bytes, meta);
/** 首稿候选（只落候选旁证，不进资产库；promote 后才入库）。 */
export const saveCandidateAsset = (id: string, bytes: Uint8Array, meta: AssetMeta): Promise<Asset> => saveAssetFile(id, bytes, meta, { candidate: true });

export function promoteCandidateAsset(id: string, assetId: string): Promise<Asset> {
  return withLock(id, async () => {
    if (!/^[\w-]+$/.test(assetId)) throw new Error('bad asset id');
    const s = await readState(id);
    const existing = s.assets.find((a) => a.id === assetId);
    if (existing) {
      s.baseAssetId = existing.id;
      await writeStateUnlocked(s);
      return existing;
    }
    const p = candidatePath(id, assetId);
    if (!existsSync(p)) throw new Error(`candidate not found: ${assetId}`);
    const asset = JSON.parse(await readFile(p, 'utf8')) as Asset;
    if (asset.id !== assetId) throw new Error(`candidate id mismatch: ${assetId}`);
    if (!existsSync(path.join(assetsDir(id), `${assetId}.png`))) throw new Error(`candidate file missing: ${assetId}`);
    s.assets.push(asset);
    s.baseAssetId = asset.id;
    await writeStateUnlocked(s);
    return asset;
  });
}

/** 资产库重命名（用户自定义显示名，限长 80）。 */
export function renameAsset(id: string, assetId: string, name: string): Promise<void> {
  return withLock(id, async () => {
    if (!/^[\w-]+$/.test(assetId)) throw new Error('bad asset id');
    const s = await readState(id);
    const a = s.assets.find((x) => x.id === assetId);
    if (!a) throw new Error(`asset not found: ${assetId}`);
    a.name = name.trim().slice(0, 80) || undefined;
    await writeStateUnlocked(s);
  });
}

/** 资产库置顶开关（前端排序时 pinned 浮到最前）。 */
export function setAssetPinned(id: string, assetId: string, pinned: boolean): Promise<void> {
  return withLock(id, async () => {
    if (!/^[\w-]+$/.test(assetId)) throw new Error('bad asset id');
    const s = await readState(id);
    const a = s.assets.find((x) => x.id === assetId);
    if (!a) throw new Error(`asset not found: ${assetId}`);
    a.pinned = pinned || undefined;
    await writeStateUnlocked(s);
  });
}

const rand = () => Math.random().toString(36).slice(2, 8);
const safeExt = (filename: string, mediaType: string) => {
  const ext = filename.toLowerCase().match(/\.([a-z0-9]{1,8})$/)?.[1];
  if (ext) return ext;
  if (mediaType === 'application/pdf') return 'pdf';
  if (mediaType.includes('wordprocessingml')) return 'docx';
  if (mediaType.includes('spreadsheetml')) return 'xlsx';
  if (mediaType === 'image/jpeg') return 'jpg';
  if (mediaType === 'image/png') return 'png';
  if (mediaType === 'image/webp') return 'webp';
  return 'bin';
};

function attachmentKind(mediaType: string, filename: string): AttachmentKind {
  const lower = filename.toLowerCase();
  if (mediaType.startsWith('image/')) return 'image';
  if (mediaType === 'application/pdf' || lower.endsWith('.pdf')) return 'pdf';
  if (mediaType.includes('wordprocessingml') || lower.endsWith('.docx')) return 'docx';
  if (mediaType.includes('spreadsheetml') || lower.endsWith('.xlsx') || lower.endsWith('.xls')) return 'xlsx';
  return 'file';
}

export async function saveAttachment(
  id: string,
  bytes: Uint8Array,
  meta: { filename: string; mediaType: string },
): Promise<Attachment> {
  const attachmentId = `att-${Date.now()}-${rand()}`;
  const ext = safeExt(meta.filename, meta.mediaType);
  const file = path.join(attachmentsDir(id), `${attachmentId}.${ext}`);
  const attachment: Attachment = {
    id: attachmentId,
    kind: attachmentKind(meta.mediaType, meta.filename),
    filename: meta.filename,
    mediaType: meta.mediaType || 'application/octet-stream',
    size: bytes.byteLength,
    path: path.relative(process.cwd(), file),
    url: `/api/projects/${id}/attachments/${attachmentId}`,
    createdAt: new Date().toISOString(),
  };
  if (tombstoned.has(id)) return attachment;
  await mkdir(attachmentsDir(id), { recursive: true });
  await writeFileAtomic(file, bytes);
  await withLock(id, async () => {
    const s = await readState(id);
    (s.attachments ??= []).push(attachment);
    await writeStateUnlocked(s);
  });
  return attachment;
}

export async function loadAttachment(id: string, attachmentId: string): Promise<{ attachment: Attachment; bytes: Uint8Array }> {
  if (!/^[\w-]+$/.test(attachmentId)) throw new Error('bad attachment id');
  const s = await readState(id);
  const attachment = s.attachments?.find((x) => x.id === attachmentId);
  if (!attachment) throw new Error(`attachment not found: ${attachmentId}`);
  return { attachment, bytes: new Uint8Array(await readFile(path.join(process.cwd(), attachment.path))) };
}

export async function loadAssetBytes(id: string, assetId: string): Promise<Uint8Array> {
  return new Uint8Array(await readFile(path.join(assetsDir(id), `${assetId}.png`)));
}

export function saveLayoutProposal(id: string, layout: BoothLayout): Promise<void> {
  return withLock(id, async () => {
    const s = await readState(id);
    s.layout = { status: 'pending', proposal: layout, updatedAt: new Date().toISOString() };
    await writeStateUnlocked(s);
  });
}

export function markLayoutConfirmed(id: string, planAssetId: string, proposal?: BoothLayout): Promise<void> {
  return withLock(id, async () => {
    const s = await readState(id);
    s.layout = {
      status: 'confirmed',
      proposal: proposal ?? s.layout?.proposal,
      planAssetId,
      updatedAt: new Date().toISOString(),
    };
    await writeStateUnlocked(s);
  });
}

export function markLayoutSkipped(id: string): Promise<void> {
  return withLock(id, async () => {
    const s = await readState(id);
    s.layout = {
      status: 'skipped',
      proposal: s.layout?.proposal,
      updatedAt: new Date().toISOString(),
    };
    await writeStateUnlocked(s);
  });
}

/** 项目卡片标题：优先 spec.narrative 首句，否则占位名。 */
function projectTitle(s: ProjectState): string {
  const n = s.spec?.narrative?.trim();
  if (n) {
    const first = n.split(/[\n。.!！?？]/)[0].trim();
    if (first) return first.length > 24 ? `${first.slice(0, 24)}…` : first;
  }
  return s.id === DEFAULT_PROJECT ? '默认项目' : '未命名项目';
}

/** 列出所有项目（最近更新在前），供左侧项目面板。损坏目录跳过。 */
export async function listProjects(): Promise<ProjectSummary[]> {
  if (!existsSync(ROOT)) return [];
  const dirs = await readdir(ROOT, { withFileTypes: true });
  const out: ProjectSummary[] = [];
  for (const d of dirs) {
    if (!d.isDirectory() || !existsSync(statePath(d.name))) continue;
    try {
      const s = await readState(d.name);
      out.push({
        id: s.id,
        title: projectTitle(s),
        assetCount: s.assets.length,
        updatedAt: s.updatedAt,
        thumbnailUrl: s.assets[s.assets.length - 1]?.url,
      });
    } catch {
      /* 跳过解析失败的项目 */
    }
  }
  return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/** 删除项目（default 保护不删）。先立墓碑再 rm：堵住此刻可能正在跑的生图回来重建目录。 */
export async function deleteProject(id: string): Promise<void> {
  if (id === DEFAULT_PROJECT) return;
  tombstoned.add(id);
  await withLock(id, async () => {
    await rm(projDir(id), { recursive: true, force: true });
  });
}

const runPath = (id: string, runId: string) => path.join(runsDir(id), `${runId}.json`);

async function readRun(id: string, runId: string): Promise<RunRecord | null> {
  const p = runPath(id, runId);
  if (!existsSync(p)) return null;
  return JSON.parse(await readFile(p, 'utf8')) as RunRecord;
}

async function writeRunUnlocked(run: RunRecord): Promise<void> {
  if (tombstoned.has(run.projectId)) return;
  await mkdir(runsDir(run.projectId), { recursive: true });
  run.updatedAt = new Date().toISOString();
  await writeFileAtomic(runPath(run.projectId, run.id), JSON.stringify(run, null, 2));
}

function runSummary(run: RunRecord) {
  return {
    id: run.id,
    status: run.status,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    budget: run.budget,
    delivered: run.delivered,
    error: run.error,
  };
}

export function createRun(id: string, budget: RunBudget): Promise<RunRecord> {
  return withLock(id, async () => {
    const now = new Date().toISOString();
    const run: RunRecord = {
      id: `run-${Date.now()}-${rand()}`,
      projectId: id,
      status: 'running',
      startedAt: now,
      updatedAt: now,
      budget,
      events: [{ at: now, type: 'status', message: 'started' }],
    };
    await writeRunUnlocked(run);
    const s = await readState(id);
    s.runs = [runSummary(run), ...(s.runs ?? []).filter((x) => x.id !== run.id)].slice(0, 30);
    await writeStateUnlocked(s);
    return run;
  });
}

export function appendRunEvent(id: string, runId: string | null, event: Omit<RunEvent, 'at'>): Promise<void> {
  if (!runId) return Promise.resolve();
  return withLock(id, async () => {
    const run = await readRun(id, runId);
    if (!run || run.status !== 'running') return;
    run.events.push({ ...event, at: new Date().toISOString() });
    if (run.events.length > 200) run.events = run.events.slice(-200);
    await writeRunUnlocked(run);
  });
}

export async function listRunRecords(projectId: string, limit = 100): Promise<RunRecord[]> {
  const dir = runsDir(projectId);
  if (!existsSync(dir)) return [];
  const files = (await readdir(dir)).filter((f) => f.endsWith('.json'));
  const runs: RunRecord[] = [];
  for (const f of files) {
    try {
      runs.push(JSON.parse(await readFile(path.join(dir, f), 'utf8')) as RunRecord);
    } catch {
      /* 跳过损坏 run */
    }
  }
  return runs.sort((a, b) => b.startedAt.localeCompare(a.startedAt)).slice(0, limit);
}

export function recordRunDeliverable(id: string, runId: string | null, deliverable: Deliverable): Promise<void> {
  if (!runId) return Promise.resolve();
  return withLock(id, async () => {
    const run = await readRun(id, runId);
    if (!run || run.status !== 'running') return;
    run.deliverable = deliverable;
    run.delivered = deliverable.assets.map((a) => a.assetId).filter(Boolean);
    run.budget.actualImages = (run.budget.actualImages ?? 0) + deliverable.assets.filter((a) => a.url).length;
    run.events.push({
      at: new Date().toISOString(),
      type: 'deliverable',
      outputSummary: { type: deliverable.type, recommendedId: deliverable.recommendedId, assets: deliverable.assets.length, issues: deliverable.issues?.length ?? 0 },
    });
    await writeRunUnlocked(run);
  });
}

export function finishRun(
  id: string,
  runId: string | null,
  status: Exclude<RunStatus, 'running'>,
  detail: { error?: string; totalUsage?: unknown; delivered?: string[] } = {},
): Promise<void> {
  if (!runId) return Promise.resolve();
  return withLock(id, async () => {
    const run = await readRun(id, runId);
    if (!run || run.status !== 'running') return;
    run.status = status;
    run.completedAt = new Date().toISOString();
    run.error = detail.error;
    run.totalUsage = detail.totalUsage;
    if (detail.delivered) run.delivered = detail.delivered;
    run.events.push({ at: run.completedAt, type: 'status', message: status });
    await writeRunUnlocked(run);
    const s = await readState(id);
    s.runs = [runSummary(run), ...(s.runs ?? []).filter((x) => x.id !== run.id)].slice(0, 30);
    await writeStateUnlocked(s);
  });
}

// ── RenderInputSnapshot（D32）：每次真正调用图像模型前固化输入证据链，落 render-inputs/<id>.json ──
// 只存轻量引用（不存图片 base64）；tombstone 项目不写；与现有 per-project lock 一致串行化；JSON 格式化便于人工审计。
const renderInputPath = (id: string, snapshotId: string) => path.join(renderInputsDir(id), `${snapshotId}.json`);

export function saveRenderInputSnapshot(
  projectId: string,
  snapshot: Omit<RenderInputSnapshot, 'id' | 'projectId' | 'createdAt'>,
): Promise<RenderInputSnapshot> {
  const snap: RenderInputSnapshot = { ...snapshot, id: `render-input-${Date.now()}-${rand()}`, projectId, createdAt: new Date().toISOString() };
  if (tombstoned.has(projectId)) return Promise.resolve(snap); // 项目已删除：不重建目录，仍返回快照对象
  return withLock(projectId, async () => {
    await mkdir(renderInputsDir(projectId), { recursive: true });
    await writeFileAtomic(renderInputPath(projectId, snap.id), JSON.stringify(snap, null, 2));
    return snap;
  });
}

export async function readRenderInputSnapshot(projectId: string, snapshotId: string): Promise<RenderInputSnapshot | null> {
  if (!/^[\w-]+$/.test(snapshotId)) return null;
  const p = renderInputPath(projectId, snapshotId);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(await readFile(p, 'utf8')) as RenderInputSnapshot;
  } catch {
    return null;
  }
}

export async function listRenderInputSnapshots(projectId: string, limit = 20): Promise<RenderInputSnapshot[]> {
  const dir = renderInputsDir(projectId);
  if (!existsSync(dir)) return [];
  const files = (await readdir(dir)).filter((f) => f.endsWith('.json'));
  const snaps: RenderInputSnapshot[] = [];
  for (const f of files) {
    try {
      snaps.push(JSON.parse(await readFile(path.join(dir, f), 'utf8')) as RenderInputSnapshot);
    } catch {
      /* 跳过解析失败的快照 */
    }
  }
  return snaps.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, Math.max(0, limit));
}

// ── selectedAttachments（D33）：标记本项目被选入方案/生图输入的素材（按 attachmentId+role 去重，丢弃引用不存在附件的 ref）──
function dedupeAttachmentRefs(refs: AttachmentUseRef[]): AttachmentUseRef[] {
  const seen = new Set<string>();
  const out: AttachmentUseRef[] = [];
  for (const r of refs) {
    const k = `${r.attachmentId}::${r.role}`;
    if (!seen.has(k)) {
      seen.add(k);
      out.push(r);
    }
  }
  return out;
}

export function setSelectedAttachments(projectId: string, refs: AttachmentUseRef[]): Promise<void> {
  return withLock(projectId, async () => {
    const s = await readState(projectId);
    const ids = new Set((s.attachments ?? []).map((a) => a.id));
    const valid = refs.filter((r) => ids.has(r.attachmentId));
    if (valid.length !== refs.length) console.warn(`[selectedAttachments] 丢弃 ${refs.length - valid.length} 个引用了不存在附件的 ref（${projectId}）`);
    s.selectedAttachments = dedupeAttachmentRefs(valid);
    await writeStateUnlocked(s);
  });
}

export function mergeSelectedAttachments(projectId: string, refs: AttachmentUseRef[]): Promise<void> {
  return withLock(projectId, async () => {
    const s = await readState(projectId);
    const ids = new Set((s.attachments ?? []).map((a) => a.id));
    const valid = refs.filter((r) => ids.has(r.attachmentId));
    if (valid.length !== refs.length) console.warn(`[selectedAttachments] merge 丢弃 ${refs.length - valid.length} 个无效 ref（${projectId}）`);
    s.selectedAttachments = dedupeAttachmentRefs([...(s.selectedAttachments ?? []), ...valid]);
    await writeStateUnlocked(s);
  });
}

// ── AssetAnalysis（D33）：上传素材的结构化理解，落 asset-analyses/<id>.json（不存 base64；list 按 updatedAt 倒序）──
const analysisPath = (id: string, analysisId: string) => path.join(analysesDir(id), `${analysisId}.json`);

export function saveAssetAnalysis(
  projectId: string,
  analysis: Omit<AssetAnalysis, 'id' | 'projectId' | 'createdAt' | 'updatedAt'>,
): Promise<AssetAnalysis> {
  const now = new Date().toISOString();
  const full: AssetAnalysis = { ...analysis, id: `analysis-${Date.now()}-${rand()}`, projectId, createdAt: now, updatedAt: now };
  if (tombstoned.has(projectId)) return Promise.resolve(full);
  return withLock(projectId, async () => {
    await mkdir(analysesDir(projectId), { recursive: true });
    await writeFileAtomic(analysisPath(projectId, full.id), JSON.stringify(full, null, 2));
    return full;
  });
}

export async function readAssetAnalysis(projectId: string, analysisId: string): Promise<AssetAnalysis | null> {
  if (!/^[\w-]+$/.test(analysisId)) return null;
  const p = analysisPath(projectId, analysisId);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(await readFile(p, 'utf8')) as AssetAnalysis;
  } catch {
    return null;
  }
}

export async function listAssetAnalyses(projectId: string, limit = 50): Promise<AssetAnalysis[]> {
  const dir = analysesDir(projectId);
  if (!existsSync(dir)) return [];
  const files = (await readdir(dir)).filter((f) => f.endsWith('.json'));
  const out: AssetAnalysis[] = [];
  for (const f of files) {
    try {
      out.push(JSON.parse(await readFile(path.join(dir, f), 'utf8')) as AssetAnalysis);
    } catch {
      /* 跳过解析失败的分析 */
    }
  }
  return out.sort((a, b) => (b.updatedAt || b.createdAt).localeCompare(a.updatedAt || a.createdAt)).slice(0, Math.max(0, limit));
}

export async function listAssetAnalysesForAttachment(projectId: string, attachmentId: string): Promise<AssetAnalysis[]> {
  return (await listAssetAnalyses(projectId, 1000)).filter((a) => a.attachmentId === attachmentId);
}

// ── 对话历史持久化（Phase 4 补：useChat messages 原本只在内存，切项目即丢）──
// 存 UIMessage[]（图片是 /api/assets URL、体积小）。结构松散用 unknown[]，类型归前端。
const conversationPath = (id: string) => path.join(projDir(id), 'conversation.json');

export async function loadConversation(id: string = DEFAULT_PROJECT): Promise<unknown[]> {
  const p = conversationPath(id);
  if (!existsSync(p)) return [];
  try {
    const parsed = JSON.parse(await readFile(p, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveConversation(id: string, messages: unknown[]): Promise<void> {
  return withLock(id, async () => {
    if (tombstoned.has(id)) return; // 项目已删除，不重建其对话文件
    await mkdir(projDir(id), { recursive: true });
    await writeFileAtomic(conversationPath(id), JSON.stringify(messages));
  });
}
