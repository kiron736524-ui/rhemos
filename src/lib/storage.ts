import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import type { Asset, DesignSpec, InspectionResult, ProjectState, ProjectSummary } from './types';

// 本地文件系统存储（Phase 4：projectId-keyed 隔离 + per-project 写锁；DB/Blob 留 Phase 5）。
const ROOT = path.join(process.cwd(), '.data', 'projects');
export const DEFAULT_PROJECT = 'default';

const projDir = (id: string) => path.join(ROOT, id);
const assetsDir = (id: string) => path.join(projDir(id), 'assets');
const statePath = (id: string) => path.join(projDir(id), 'state.json');

/** 从工具的 experimental_context 取 projectId（由 /api/agent 注入）；非法则回退 default。 */
export function projectIdFromContext(ctx: unknown): string {
  const id = (ctx as { projectId?: unknown } | undefined)?.projectId;
  return typeof id === 'string' && /^[\w-]+$/.test(id) ? id : DEFAULT_PROJECT;
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

export async function readState(id: string = DEFAULT_PROJECT): Promise<ProjectState> {
  const p = statePath(id);
  if (existsSync(p)) return JSON.parse(await readFile(p, 'utf8')) as ProjectState;
  return { id, brief: {}, assets: [], updatedAt: new Date().toISOString() };
}

async function writeStateUnlocked(state: ProjectState): Promise<void> {
  if (tombstoned.has(state.id)) return; // 项目已删除，绝不重建其状态文件
  await mkdir(projDir(state.id), { recursive: true });
  state.updatedAt = new Date().toISOString();
  await writeFile(statePath(state.id), JSON.stringify(state, null, 2), 'utf8');
}

export function writeState(state: ProjectState): Promise<void> {
  return withLock(state.id, () => writeStateUnlocked(state));
}

export function setSpec(id: string, spec: DesignSpec): Promise<void> {
  return withLock(id, async () => {
    const s = await readState(id);
    s.spec = spec;
    await writeStateUnlocked(s);
  });
}

/** 增量并入已确认的 brief 事实（用户拍板的面积/墙高/行业/品牌/必答约束等）。
 *  brief 是跨轮的业务记忆——澄清确认后立即落盘，read_project_state 据此避免重复追问、保持上下文。 */
export function mergeBrief(id: string, patch: Record<string, unknown>): Promise<void> {
  return withLock(id, async () => {
    const s = await readState(id);
    s.brief = { ...s.brief, ...patch };
    await writeStateUnlocked(s);
  });
}

export async function saveAsset(
  id: string,
  bytes: Uint8Array,
  meta: Pick<Asset, 'kind'> & Partial<Pick<Asset, 'prompt' | 'parentId' | 'inspections'>>,
): Promise<Asset> {
  const assetId = `${meta.kind}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const file = path.join(assetsDir(id), `${assetId}.png`);
  const asset: Asset = {
    id: assetId,
    kind: meta.kind,
    prompt: meta.prompt,
    parentId: meta.parentId,
    inspections: meta.inspections,
    path: path.relative(process.cwd(), file),
    url: `/api/assets/${assetId}?project=${id}`,
    createdAt: new Date().toISOString(),
  };
  if (tombstoned.has(id)) return asset; // 项目已删除：丢弃飞行中的生图结果，绝不重建已删目录
  await mkdir(assetsDir(id), { recursive: true });
  await writeFile(file, bytes); // 唯一文件名，无需锁
  await withLock(id, async () => {
    const s = await readState(id);
    s.assets.push(asset);
    await writeStateUnlocked(s);
  });
  return asset;
}

/** 把判图结果沉淀回资产历史（修 bug：之前判完不写回，read_project_state 永远空）。 */
export function addInspection(id: string, assetId: string, insp: InspectionResult): Promise<void> {
  return withLock(id, async () => {
    const s = await readState(id);
    const a = s.assets.find((x) => x.id === assetId);
    if (!a) return;
    (a.inspections ??= []).push(insp);
    await writeStateUnlocked(s);
  });
}

export async function loadAssetBytes(id: string, assetId: string): Promise<Uint8Array> {
  return new Uint8Array(await readFile(path.join(assetsDir(id), `${assetId}.png`)));
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
    await writeFile(conversationPath(id), JSON.stringify(messages), 'utf8');
  });
}
