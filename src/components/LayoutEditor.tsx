'use client';

import { useEffect, useRef, useState } from 'react';
import { Stage, Layer, Rect, Line, Text, Group, Transformer } from 'react-konva';
import type Konva from 'konva';

// 可交互展台布局编辑器（react-konva）：拖拽 / 缩放 / 网格吸附 / 矩形+L形 / 导出 PNG。
// 模块坐标全部存"米"，渲染时 × scale 映射到像素；导出的 PNG 直接作参考图喂 gpt-image-2。

export type LayoutModule = {
  id: string;
  name: string;
  type: string;
  shape: 'rect' | 'L';
  x: number; // 米，左上角
  y: number;
  w: number;
  h: number;
  note?: string;
};

const TYPE_COLOR: Record<string, { fill: string; stroke: string }> = {
  led: { fill: '#CFE8FF', stroke: '#2B7DB8' },
  stage: { fill: '#E4F2FF', stroke: '#2B7DB8' },
  reception: { fill: '#EEF2F7', stroke: '#667085' },
  meeting: { fill: '#D8DEE8', stroke: '#4B5563' },
  storage: { fill: '#C7CEDA', stroke: '#344054' },
  product: { fill: '#E8ECF3', stroke: '#667085' },
  brand: { fill: '#FFE1DD', stroke: '#C23A31' },
  plant: { fill: '#DFF3E5', stroke: '#398A56' },
  default: { fill: '#E5E7EB', stroke: '#667085' },
};

const CW = 660,
  CH = 460,
  PAD = 44,
  SNAP = 0.5; // 吸附到 0.5m
const snap = (m: number) => Math.round(m / SNAP) * SNAP;

// L 形多边形（挖掉右上角，notch=0.45）相对 bbox 的点（米）
const lPoints = (w: number, h: number) => {
  const nx = w * 0.45,
    ny = h * 0.45;
  return [0, 0, w - nx, 0, w - nx, ny, w, ny, w, h, 0, h];
};

export default function LayoutEditor({
  footprint,
  initial,
  openings = [],
  onConfirm,
  onCancel,
}: {
  footprint: { length: number; width: number };
  initial: LayoutModule[];
  openings?: string[];
  onConfirm: (dataUrl: string, modules: LayoutModule[]) => void;
  onCancel: () => void;
}) {
  const L = footprint.length,
    W = footprint.width;
  const scale = Math.min((CW - PAD * 2) / L, (CH - PAD * 2) / W);
  const px = (m: number) => m * scale;
  const ox = PAD,
    oy = PAD; // footprint 原点（像素）

  const [modules, setModules] = useState<LayoutModule[]>(initial);
  const [selId, setSelId] = useState<string | null>(null);
  const stageRef = useRef<Konva.Stage>(null);
  const trRef = useRef<Konva.Transformer>(null);

  useEffect(() => {
    const stage = stageRef.current;
    const node = selId ? stage?.findOne('#' + selId) : null;
    if (trRef.current) {
      trRef.current.nodes(node ? [node as Konva.Node] : []);
      trRef.current.getLayer()?.batchDraw();
    }
  }, [selId, modules]);

  const update = (id: string, patch: Partial<LayoutModule>) => setModules((ms) => ms.map((m) => (m.id === id ? { ...m, ...patch } : m)));

  const addModule = (shape: 'rect' | 'L') => {
    const id = 'm' + Math.random().toString(36).slice(2, 7);
    setModules((ms) => [...ms, { id, name: shape === 'L' ? 'L形区' : '新模块', type: 'default', shape, x: snap(L / 2 - 1.5), y: snap(W / 2 - 1), w: 3, h: 2 }]);
    setSelId(id);
  };
  const removeSel = () => {
    if (!selId) return;
    setModules((ms) => ms.filter((m) => m.id !== selId));
    setSelId(null);
  };
  const confirm = () => {
    setSelId(null); // 去掉选中手柄再截图
    requestAnimationFrame(() => {
      const url = stageRef.current?.toDataURL({ pixelRatio: 2 }) ?? '';
      onConfirm(url, modules);
    });
  };

  const grid: React.ReactElement[] = [];
  for (let m = 1; m < L; m++) grid.push(<Line key={'gx' + m} points={[ox + px(m), oy, ox + px(m), oy + px(W)]} stroke="#D7E3EF" strokeWidth={0.7} />);
  for (let m = 1; m < W; m++) grid.push(<Line key={'gy' + m} points={[ox, oy + px(m), ox + px(L), oy + px(m)]} stroke="#D7E3EF" strokeWidth={0.7} />);

  const sel = modules.find((m) => m.id === selId) ?? null;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={() => addModule('rect')} className="u-tap rounded-md border border-ink-700 bg-ink-850 px-3 py-1.5 text-[12.5px] text-ink-100 hover:border-accent/60">+ 矩形</button>
        <button onClick={() => addModule('L')} className="u-tap rounded-md border border-ink-700 bg-ink-850 px-3 py-1.5 text-[12.5px] text-ink-100 hover:border-accent/60">+ L 形</button>
        <button onClick={removeSel} disabled={!selId} className="u-tap rounded-md border border-ink-700 bg-ink-850 px-3 py-1.5 text-[12.5px] text-ink-200 hover:border-signal/60 hover:text-signal disabled:opacity-40">删除选中</button>
        <span className="mono-tag ml-auto text-ink-500">{L}×{W}m · 拖拽移动 · 手柄缩放 · 吸附 {SNAP}m</span>
      </div>

      {/* 选中模块属性编辑 */}
      {sel && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-ink-800 bg-ink-850/60 px-3 py-2 text-[12px] text-ink-300">
          <input value={sel.name} onChange={(e) => update(sel.id, { name: e.target.value })} className="w-28 rounded border border-ink-700 bg-ink-900 px-2 py-1 text-ink-100 outline-none focus:border-accent" />
          <select value={sel.type} onChange={(e) => update(sel.id, { type: e.target.value })} className="rounded border border-ink-700 bg-ink-900 px-2 py-1 text-ink-100 outline-none">
            {['led', 'stage', 'reception', 'meeting', 'storage', 'product', 'brand', 'plant', 'default'].map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <label className="flex items-center gap-1">宽<input type="number" step={SNAP} value={sel.w} onChange={(e) => update(sel.id, { w: snap(+e.target.value) })} className="w-14 rounded border border-ink-700 bg-ink-900 px-1.5 py-1 text-ink-100 outline-none" />m</label>
          <label className="flex items-center gap-1">深<input type="number" step={SNAP} value={sel.h} onChange={(e) => update(sel.id, { h: snap(+e.target.value) })} className="w-14 rounded border border-ink-700 bg-ink-900 px-1.5 py-1 text-ink-100 outline-none" />m</label>
          <button onClick={() => update(sel.id, { shape: sel.shape === 'rect' ? 'L' : 'rect' })} className="u-tap rounded border border-ink-700 px-2 py-1 hover:border-accent/60">切 {sel.shape === 'rect' ? 'L形' : '矩形'}</button>
        </div>
      )}

      <div className="overflow-hidden rounded-lg ring-1 ring-ink-800" style={{ width: CW, maxWidth: '100%' }}>
        <Stage ref={stageRef} width={CW} height={CH} style={{ background: '#F8FAFC' }} onMouseDown={(e) => { if (e.target === e.target.getStage()) setSelId(null); }}>
          <Layer>
            <Rect x={0} y={0} width={CW} height={CH} fill="#F8FAFC" listening={false} />
            {grid}
            {/* footprint 四边：开口虚线 */}
            {([['back', ox, oy, ox + px(L), oy], ['front', ox, oy + px(W), ox + px(L), oy + px(W)], ['left', ox, oy, ox, oy + px(W)], ['right', ox + px(L), oy, ox + px(L), oy + px(W)]] as const).map(([side, x1, y1, x2, y2]) => {
              const o = openings.includes(side);
              return <Line key={side} points={[x1, y1, x2, y2]} stroke={o ? '#2B7DB8' : '#111827'} strokeWidth={2.4} dash={o ? [8, 6] : undefined} opacity={o ? 0.95 : 1} />;
            })}
            <Text text="BACK / 后" x={ox + px(L) / 2 - 36} y={oy - 24} fontSize={12} fill="#344054" fontStyle="bold" listening={false} />
            <Text text="FRONT / 前" x={ox + px(L) / 2 - 40} y={oy + px(W) + 10} fontSize={12} fill="#344054" fontStyle="bold" listening={false} />
            <Text text="LEFT" x={ox - 36} y={oy + px(W) / 2 - 7} fontSize={11} fill="#344054" fontStyle="bold" listening={false} />
            <Text text="RIGHT" x={ox + px(L) + 8} y={oy + px(W) / 2 - 7} fontSize={11} fill="#344054" fontStyle="bold" listening={false} />
            {/* 模块 */}
            {modules.map((m) => {
              const c = TYPE_COLOR[m.type] ?? TYPE_COLOR.default;
              const wpx = px(m.w),
                hpx = px(m.h);
              return (
                <Group
                  key={m.id}
                  id={m.id}
                  x={ox + px(m.x)}
                  y={oy + px(m.y)}
                  draggable
                  onClick={() => setSelId(m.id)}
                  onTap={() => setSelId(m.id)}
                  onDragEnd={(e) => update(m.id, { x: snap((e.target.x() - ox) / scale), y: snap((e.target.y() - oy) / scale) })}
                  onTransformEnd={(e) => {
                    const node = e.target;
                    const sx = node.scaleX(),
                      sy = node.scaleY();
                    node.scaleX(1);
                    node.scaleY(1);
                    update(m.id, { w: Math.max(SNAP, snap(m.w * sx)), h: Math.max(SNAP, snap(m.h * sy)), x: snap((node.x() - ox) / scale), y: snap((node.y() - oy) / scale) });
                  }}
                >
                  {m.shape === 'L' ? (
                    <Line points={lPoints(wpx, hpx)} closed fill={c.fill} stroke={c.stroke} strokeWidth={1.3} />
                  ) : (
                    <Rect width={wpx} height={hpx} fill={c.fill} stroke={c.stroke} strokeWidth={1.3} cornerRadius={2} />
                  )}
                  <Text text={m.name} x={4} y={hpx / 2 - 14} width={wpx - 8} align="center" fontSize={12} fill="#111827" fontStyle="bold" listening={false} />
                  <Text text={`${m.w}×${m.h}m${m.note ? ` · ${m.note}` : ''}`} x={4} y={hpx / 2 + 2} width={wpx - 8} align="center" fontSize={9.5} fill="#475467" fontStyle="bold" listening={false} />
                </Group>
              );
            })}
            <Transformer ref={trRef} rotateEnabled={false} anchorSize={8} borderStroke="#6FA1C9" anchorStroke="#6FA1C9" anchorFill="#0B0C0F" boundBoxFunc={(oldB, newB) => (newB.width < 16 || newB.height < 16 ? oldB : newB)} />
          </Layer>
        </Stage>
      </div>

      <div className="flex gap-2">
        <button onClick={confirm} className="u-press rounded-lg bg-accent px-4 py-2 text-[13px] font-medium text-ink-950 hover:bg-accent-deep">确认布局 → 出图</button>
        <button onClick={onCancel} className="u-press rounded-lg border border-ink-700 px-4 py-2 text-[13px] text-ink-200 hover:bg-ink-800">取消</button>
      </div>
    </div>
  );
}
