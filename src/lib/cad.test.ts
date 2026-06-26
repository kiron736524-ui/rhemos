import { describe, expect, it } from 'vitest';
import { cadPromptLock, layoutToCadDocument } from './cad';
import type { BoothLayout } from './types';

const layout: BoothLayout = {
  length: 15,
  width: 12,
  openings: ['front', 'left', 'right'],
  zones: [
    { id: 'W1', name: '品牌墙', type: 'brand', x: 0, y: 0, w: 15, h: 0.5, layer: 'object', height: 4, facing: 'front' },
    { id: 'T1', name: '顶部灯架', type: 'truss', x: 0, y: 0, w: 15, h: 12, layer: 'detail', height: 5 },
  ],
};

describe('Rhemos CAD v1', () => {
  it('把 BoothLayout 转为标准 CAD 文档', () => {
    const cad = layoutToCadDocument(layout);
    expect(cad.version).toBe('rhemos-cad-v1');
    expect(cad.footprint).toEqual({ shape: 'rectangle', length: 15, width: 12 });
    expect(cad.edges.find((e) => e.id === 'back')?.open).toBe(false);
    expect(cad.edges.find((e) => e.id === 'front')?.open).toBe(true);
    expect(cad.objects.find((o) => o.id === 'T1')?.layer).toBe('detail');
  });

  it('生成机器可读布局硬锁', () => {
    const lock = cadPromptLock(layout);
    expect(lock).toContain('RHEMOS_CAD_DOCUMENT_V1');
    expect(lock).toContain('"id": "W1"');
    expect(lock).toContain('"shape": "rectangle"');
  });
});
