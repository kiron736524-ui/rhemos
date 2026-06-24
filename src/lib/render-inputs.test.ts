import { describe, it, expect, afterAll } from 'vitest';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import { saveRenderInputSnapshot, readRenderInputSnapshot, listRenderInputSnapshots, saveAsset, readState } from './storage';
import type { RenderInputSnapshot } from './types';

// 纯 storage 级测试：写真实 .data 但用专用 projectId，测后清理；不调模型 / 不需 key / 不联网。
const PID = `test-render-inputs-${Date.now()}`;
const dirOf = (pid: string) => path.join(process.cwd(), '.data', 'projects', pid);
const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const baseSnapshot = (): Omit<RenderInputSnapshot, 'id' | 'projectId' | 'createdAt'> => ({
  runId: 'run-test',
  mode: 'final',
  provider: 'fal',
  model: 'openai/gpt-image-2',
  quality: 'high',
  size: '1024x1024',
  prompt: 'a photorealistic exhibition booth, technology blue, V-Ray render',
  intent: '正面主视角，科技蓝',
  operation: 'text-to-image',
  specSummary: { hasSpec: true, identity: 'booth DNA: 6x6m, technology blue', invariants: ['blue'], selfCheckCriteria: 'no floating structure', updatedAt: '2026-06-24T00:00:00.000Z' },
  refs: [{ id: 'asset-1', kind: 'asset', role: 'previous_render', url: `/api/assets/asset-1?project=${PID}` }],
});

describe('RenderInputSnapshot 存储（D32）', () => {
  afterAll(async () => {
    await rm(dirOf(PID), { recursive: true, force: true });
    await rm(dirOf(`${PID}-list`), { recursive: true, force: true });
  });

  it('saveRenderInputSnapshot 返回 id/projectId/createdAt', async () => {
    const snap = await saveRenderInputSnapshot(PID, baseSnapshot());
    expect(snap.id).toMatch(/^render-input-/);
    expect(snap.projectId).toBe(PID);
    expect(snap.createdAt).toBeTruthy();
    expect(snap.prompt).toContain('booth');
  });

  it('readRenderInputSnapshot 能读回同一内容', async () => {
    const saved = await saveRenderInputSnapshot(PID, baseSnapshot());
    const read = await readRenderInputSnapshot(PID, saved.id);
    expect(read).not.toBeNull();
    expect(read?.id).toBe(saved.id);
    expect(read?.prompt).toBe(saved.prompt);
    expect(read?.operation).toBe('text-to-image');
    expect(read?.refs[0]?.id).toBe('asset-1');
  });

  it('未知 / 非法 id 返回 null', async () => {
    expect(await readRenderInputSnapshot(PID, 'does-not-exist')).toBeNull();
    expect(await readRenderInputSnapshot(PID, '../escape')).toBeNull();
  });

  it('listRenderInputSnapshots 按 createdAt 倒序 + limit 生效', async () => {
    const lpid = `${PID}-list`;
    const a = await saveRenderInputSnapshot(lpid, baseSnapshot());
    await delay(5);
    const b = await saveRenderInputSnapshot(lpid, baseSnapshot());
    await delay(5);
    const c = await saveRenderInputSnapshot(lpid, baseSnapshot());
    const list = await listRenderInputSnapshots(lpid, 2);
    expect(list).toHaveLength(2);
    expect(list[0].id).toBe(c.id); // 最新在前
    expect(list[1].id).toBe(b.id);
    expect(list[0].createdAt >= list[1].createdAt).toBe(true);
    expect(a.id).toBeTruthy(); // a 存在但被 limit 截掉
  });

  it('snapshot 不含 base64 / data:image 大字段', async () => {
    const snap = await saveRenderInputSnapshot(PID, baseSnapshot());
    const json = JSON.stringify(await readRenderInputSnapshot(PID, snap.id));
    expect(json).not.toContain('data:image');
    expect(json).not.toContain('base64');
    expect(json.length).toBeLessThan(8000);
  });

  it('saveAsset 关联 renderInputId/sourceAssetIds/sourceAttachmentIds 并能在 state 读回', async () => {
    const snap = await saveRenderInputSnapshot(PID, baseSnapshot());
    const asset = await saveAsset(PID, new Uint8Array([1, 2, 3]), {
      kind: 'booth-image',
      prompt: 'test',
      renderInputId: snap.id,
      sourceAssetIds: ['asset-1', 'asset-2'],
      sourceAttachmentIds: ['att-1'],
    });
    const state = await readState(PID);
    const found = state.assets.find((x) => x.id === asset.id);
    expect(found?.renderInputId).toBe(snap.id);
    expect(found?.sourceAssetIds).toEqual(['asset-1', 'asset-2']);
    expect(found?.sourceAttachmentIds).toEqual(['att-1']);
  });
});
