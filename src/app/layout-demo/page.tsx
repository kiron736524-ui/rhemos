'use client';

import dynamic from 'next/dynamic';
import { useState } from 'react';
import type { LayoutModule } from '@/components/LayoutEditor';

// react-konva 用 canvas，禁用 SSR
const LayoutEditor = dynamic(() => import('@/components/LayoutEditor'), { ssr: false });

const INITIAL: LayoutModule[] = [
  { id: 'a', name: '封闭洽谈', type: 'meeting', shape: 'rect', x: 0.5, y: 0.5, w: 4, h: 3.5 },
  { id: 'b', name: '储物间', type: 'storage', shape: 'rect', x: 10.5, y: 0.5, w: 4, h: 2.5 },
  { id: 'c', name: '产品展示墙', type: 'product', shape: 'rect', x: 10.5, y: 3.5, w: 4, h: 5 },
  { id: 'd', name: 'LED中心塔', type: 'led', shape: 'rect', x: 5.5, y: 4, w: 4, h: 3.5 },
  { id: 'e', name: '舞台发布区', type: 'stage', shape: 'rect', x: 5, y: 8, w: 5, h: 2.5 },
  { id: 'f', name: '接待台', type: 'reception', shape: 'L', x: 0.5, y: 9, w: 3.5, h: 2.5 },
];

export default function LayoutDemo() {
  const [shot, setShot] = useState<string | null>(null);
  return (
    <main className="min-h-dvh bg-ink-900 p-6 text-ink-100">
      <h1 className="mb-1 text-lg font-semibold">布局编辑器 Demo · 中国石化 12×15m 四面开</h1>
      <p className="mb-5 text-[13px] text-ink-400">拖拽移动 / 选中后手柄缩放 / 改尺寸·形状 / +模块 —— 确认后导出平面图，即喂给 gpt-image-2 的参考图。</p>
      {shot ? (
        <div className="space-y-3">
          <p className="text-[13px] text-ink-300">导出的平面图（这张就是参考图）：</p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={shot} alt="导出平面图" className="rounded-lg ring-1 ring-ink-700" style={{ maxWidth: 680 }} />
          <button onClick={() => setShot(null)} className="rounded-lg border border-ink-700 px-4 py-2 text-[13px] text-ink-200 hover:bg-ink-800">
            ← 回编辑
          </button>
        </div>
      ) : (
        <LayoutEditor
          footprint={{ length: 15, width: 12 }}
          initial={INITIAL}
          openings={['front', 'back', 'left', 'right']}
          onConfirm={(url) => setShot(url)}
          onCancel={() => {}}
        />
      )}
    </main>
  );
}
