import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import type { Asset, DesignSpec, ProjectState } from './types';

// Phase 1-2：本地文件系统存储（暂不接 DB/Blob）。单一默认 project。
const ROOT = path.join(process.cwd(), '.data', 'projects');
export const DEFAULT_PROJECT = 'default';

const projDir = (id: string) => path.join(ROOT, id);
const assetsDir = (id: string) => path.join(projDir(id), 'assets');
const statePath = (id: string) => path.join(projDir(id), 'state.json');

export async function readState(id: string = DEFAULT_PROJECT): Promise<ProjectState> {
  const p = statePath(id);
  if (existsSync(p)) {
    return JSON.parse(await readFile(p, 'utf8')) as ProjectState;
  }
  return { id, brief: {}, assets: [], updatedAt: new Date().toISOString() };
}

export async function writeState(state: ProjectState): Promise<void> {
  await mkdir(projDir(state.id), { recursive: true });
  state.updatedAt = new Date().toISOString();
  await writeFile(statePath(state.id), JSON.stringify(state, null, 2), 'utf8');
}

export async function setSpec(id: string, spec: DesignSpec): Promise<void> {
  const state = await readState(id);
  state.spec = spec;
  await writeState(state);
}

// 注意：并行生图时不要并行调用本函数（会竞写 state.json）。先并行生成字节，再顺序保存。
export async function saveAsset(
  id: string,
  bytes: Uint8Array,
  meta: Pick<Asset, 'kind'> & Partial<Pick<Asset, 'prompt' | 'parentId' | 'inspections'>>,
): Promise<Asset> {
  await mkdir(assetsDir(id), { recursive: true });
  const assetId = `${meta.kind}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const file = path.join(assetsDir(id), `${assetId}.png`);
  await writeFile(file, bytes);
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
  const state = await readState(id);
  state.assets.push(asset);
  await writeState(state);
  return asset;
}

export async function loadAssetBytes(id: string, assetId: string): Promise<Uint8Array> {
  const file = path.join(assetsDir(id), `${assetId}.png`);
  return new Uint8Array(await readFile(file));
}
