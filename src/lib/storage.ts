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

export async function saveAsset(
  id: string,
  bytes: Uint8Array,
  meta: Pick<Asset, 'kind'> & Partial<Pick<Asset, 'prompt' | 'parentId' | 'inspections'>>,
): Promise<Asset> {
  await mkdir(assetsDir(id), { recursive: true });
  const assetId = `${meta.kind}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const file = path.join(assetsDir(id), `${assetId}.png`);
  await writeFile(file, bytes); // 唯一文件名，无需锁
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

/** 删除项目（default 保护不删）。 */
export async function deleteProject(id: string): Promise<void> {
  if (id === DEFAULT_PROJECT) return;
  await withLock(id, async () => {
    await rm(projDir(id), { recursive: true, force: true });
  });
}
