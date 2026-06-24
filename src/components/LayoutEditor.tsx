'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Arrow, Ellipse, Group, Layer, Line, Rect, Stage, Text, Transformer } from 'react-konva';
import type Konva from 'konva';
import { checkBoothLayout } from '@/lib/booth-rules';
import type { BoothLayout, LayoutFacing, LayoutLayer, LayoutOpening, LayoutShape, LayoutZoneType } from '@/lib/types';

// Professional booth layout editor.
// Coordinates are stored in meters; the exported PNG and the object table are both used as render locks.

export type LayoutModule = {
  id: string;
  name: string;
  type: string;
  shape: LayoutShape | 'L';
  x: number;
  y: number;
  w: number;
  h: number;
  note?: string;
  height?: number;
  facing?: LayoutFacing;
  material?: string;
  description?: string;
  layer?: LayoutLayer;
  parentId?: string;
};

type ModulePreset = {
  type: LayoutZoneType | 'default';
  label: string;
  name: string;
  shape: LayoutShape;
  w: number;
  h: number;
  height?: number;
  layer: LayoutLayer;
  facing?: LayoutFacing;
  material?: string;
  description: string;
};

const MODULE_TYPES: Record<string, { label: string; fill: string; stroke: string; layer: LayoutLayer }> = {
  led: { label: 'LED主屏', fill: '#CFE8FF', stroke: '#2B7DB8', layer: 'object' },
  screen: { label: '屏幕', fill: '#CFE8FF', stroke: '#2B7DB8', layer: 'object' },
  stage: { label: '舞台区', fill: '#E4F2FF', stroke: '#2B7DB8', layer: 'space' },
  brand: { label: '品牌面', fill: '#FFE1DD', stroke: '#C23A31', layer: 'object' },
  wall: { label: '墙体', fill: '#E9ECF2', stroke: '#344054', layer: 'object' },
  reception: { label: '接待台', fill: '#EEF2F7', stroke: '#667085', layer: 'object' },
  counter: { label: '吧台/柜台', fill: '#EEF2F7', stroke: '#667085', layer: 'object' },
  meeting: { label: '洽谈室', fill: '#D8DEE8', stroke: '#4B5563', layer: 'space' },
  storage: { label: '储物间', fill: '#C7CEDA', stroke: '#344054', layer: 'space' },
  product: { label: '产品区', fill: '#E8ECF3', stroke: '#667085', layer: 'space' },
  showcase: { label: '展柜', fill: '#F4F6FA', stroke: '#667085', layer: 'object' },
  table: { label: '桌', fill: '#FFF4CC', stroke: '#B7791F', layer: 'detail' },
  chair: { label: '椅', fill: '#FFF7E6', stroke: '#B7791F', layer: 'detail' },
  totem: { label: '立牌', fill: '#FDE4E0', stroke: '#C23A31', layer: 'object' },
  truss: { label: 'Truss柱', fill: '#E6F4FF', stroke: '#2B7DB8', layer: 'detail' },
  door: { label: '门', fill: '#FFFFFF', stroke: '#344054', layer: 'detail' },
  plant: { label: '绿植', fill: '#DFF3E5', stroke: '#398A56', layer: 'detail' },
  aisle: { label: '通道', fill: '#FFFFFF', stroke: '#B9C4D2', layer: 'space' },
  default: { label: '模块', fill: '#E5E7EB', stroke: '#667085', layer: 'space' },
};

const PRESETS: ModulePreset[] = [
  { type: 'wall', label: '品牌背墙', name: '品牌背墙', shape: 'rect', w: 6, h: 0.35, height: 4.2, layer: 'object', facing: 'front', material: 'painted wall / brand surface', description: 'main vertical brand wall, kept on a closed edge' },
  { type: 'led', label: 'LED主屏', name: 'LED主屏', shape: 'rect', w: 4.8, h: 0.45, height: 3.2, layer: 'object', facing: 'front', material: 'LED screen', description: 'large main visual screen embedded in or attached to the back wall' },
  { type: 'reception', label: '接待台', name: '接待台', shape: 'capsule', w: 2.4, h: 0.8, height: 1, layer: 'object', facing: 'front', material: 'white counter with brand face', description: 'front reception counter placed aside from the main entrance path' },
  { type: 'product', label: '体验岛台', name: '产品体验岛台', shape: 'capsule', w: 2.8, h: 1.2, height: 0.9, layer: 'object', facing: 'center', material: 'white display plinth', description: 'low product experience island, kept inside circulation' },
  { type: 'showcase', label: '展柜', name: '产品展柜', shape: 'rect', w: 1.8, h: 0.55, height: 1, layer: 'object', facing: 'front', material: 'glass showcase', description: 'linear product showcase with transparent top' },
  { type: 'meeting', label: '洽谈室', name: '半封闭洽谈室', shape: 'rect', w: 3.2, h: 2.6, height: 2.7, layer: 'space', facing: 'front', material: 'glass + solid wall', description: 'semi enclosed meeting room with clear entrance and table inside' },
  { type: 'storage', label: '储物间', name: '储物间', shape: 'rect', w: 1.8, h: 1.4, height: 2.7, layer: 'space', facing: 'front', material: 'solid service wall', description: 'back-of-house storage hidden at rear or corner' },
  { type: 'table', label: '圆桌', name: '洽谈圆桌', shape: 'circle', w: 1.2, h: 1.2, height: 0.75, layer: 'detail', material: 'round table', description: 'round meeting table inside meeting area' },
  { type: 'chair', label: '座椅', name: '座椅', shape: 'circle', w: 0.55, h: 0.55, height: 0.85, layer: 'detail', material: 'chair', description: 'single visitor chair' },
  { type: 'totem', label: '立牌', name: '信息立牌', shape: 'rect', w: 0.65, h: 0.25, height: 2.2, layer: 'object', facing: 'front', material: 'slim freestanding sign', description: 'slim rectangular freestanding signage, not a wall extension' },
  { type: 'truss', label: 'Truss柱', name: 'Truss柱', shape: 'rect', w: 0.35, h: 0.35, height: 5, layer: 'detail', material: 'silver truss column', description: 'vertical truss support column' },
  { type: 'plant', label: '绿植', name: '绿植', shape: 'circle', w: 0.7, h: 0.7, height: 0.9, layer: 'detail', material: 'planting', description: 'soft landscape marker' },
  { type: 'aisle', label: '通道', name: '主通道留白', shape: 'rect', w: 3, h: 1.2, layer: 'space', material: 'clear circulation', description: 'clear circulation zone; no bulky objects here' },
];

const SHAPE_LABEL: Record<LayoutShape, string> = { rect: '矩形', l: 'L形', circle: '圆形', capsule: '圆角台', line: '线性' };
const FACING_LABEL: Record<LayoutFacing, string> = { front: '朝前', back: '朝后', left: '朝左', right: '朝右', center: '居中' };
const OPENINGS: LayoutOpening[] = ['front', 'back', 'left', 'right'];
const LAYERS: LayoutLayer[] = ['space', 'object', 'detail'];
const BASE_W = 720;
const BASE_H = 500;
const BASE_PAD = 54;
const SNAP = 0.25;

const snap = (m: number) => Math.round(m / SNAP) * SNAP;
const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, Number.isFinite(n) ? n : min));
const shortId = (type: string, index: number) => `${type.slice(0, 1).toUpperCase()}${index}`;
const normShape = (shape?: LayoutModule['shape']): LayoutShape => (shape === 'L' ? 'l' : shape ?? 'rect');
const typeMeta = (type: string) => MODULE_TYPES[type] ?? MODULE_TYPES.default;

function lPoints(w: number, h: number) {
  const nx = w * 0.42;
  const ny = h * 0.45;
  return [0, 0, w - nx, 0, w - nx, ny, w, ny, w, h, 0, h];
}

function normalizeModule(m: LayoutModule, idx: number): LayoutModule {
  const meta = typeMeta(m.type || 'default');
  return {
    id: m.id || shortId(m.type || 'M', idx + 1),
    name: m.name || meta.label,
    type: m.type || 'default',
    shape: normShape(m.shape),
    x: snap(m.x),
    y: snap(m.y),
    w: Math.max(SNAP, snap(m.w || 1)),
    h: Math.max(SNAP, snap(m.h || 1)),
    ...(m.note ? { note: m.note } : {}),
    ...(m.height != null ? { height: m.height } : {}),
    ...(m.facing ? { facing: m.facing } : {}),
    ...(m.material ? { material: m.material } : {}),
    ...(m.description ? { description: m.description } : {}),
    layer: m.layer ?? meta.layer,
    ...(m.parentId ? { parentId: m.parentId } : {}),
  };
}

function moduleToZone(m: LayoutModule) {
  return {
    id: m.id,
    name: m.name,
    ...(m.type !== 'default' ? { type: m.type as LayoutZoneType } : {}),
    shape: normShape(m.shape),
    x: m.x,
    y: m.y,
    w: m.w,
    h: m.h,
    ...(m.height != null ? { height: m.height } : {}),
    ...(m.facing ? { facing: m.facing } : {}),
    ...(m.material?.trim() ? { material: m.material.trim() } : {}),
    ...(m.description?.trim() ? { description: m.description.trim() } : {}),
    ...(m.layer ? { layer: m.layer } : {}),
    ...(m.parentId?.trim() ? { parentId: m.parentId.trim() } : {}),
    ...(m.note?.trim() ? { note: m.note.trim() } : {}),
  };
}

function facingArrow(facing: LayoutFacing | undefined, w: number, h: number) {
  const cx = w / 2;
  const cy = h / 2;
  const len = Math.min(w, h) * 0.32;
  if (facing === 'front') return [cx, cy, cx, cy + len];
  if (facing === 'back') return [cx, cy, cx, cy - len];
  if (facing === 'left') return [cx, cy, cx - len, cy];
  if (facing === 'right') return [cx, cy, cx + len, cy];
  return null;
}

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
  const L = footprint.length;
  const W = footprint.width;
  const [zoom, setZoom] = useState(1);
  const cw = Math.round(BASE_W * zoom);
  const ch = Math.round(BASE_H * zoom);
  const pad = BASE_PAD * zoom;
  const scale = Math.min((cw - pad * 2) / L, (ch - pad * 2) / W);
  const ox = pad;
  const oy = pad;
  const px = (m: number) => m * scale;

  const [modules, setModules] = useState<LayoutModule[]>(() => initial.map(normalizeModule));
  const [selId, setSelId] = useState<string | null>(() => initial[0]?.id ?? null);
  const [past, setPast] = useState<LayoutModule[][]>([]);
  const [future, setFuture] = useState<LayoutModule[][]>([]);
  const stageRef = useRef<Konva.Stage>(null);
  const trRef = useRef<Konva.Transformer>(null);

  const commit = useCallback((next: LayoutModule[], nextSel = selId) => {
    setPast((p) => [...p.slice(-30), modules]);
    setFuture([]);
    setModules(next);
    setSelId(nextSel);
  }, [modules, selId]);

  const update = useCallback((id: string, patch: Partial<LayoutModule>) => {
    commit(
      modules.map((m) => {
        if (m.id !== id) return m;
        const next = { ...m, ...patch };
        const w = Math.max(SNAP, snap(next.w));
        const h = Math.max(SNAP, snap(next.h));
        return {
          ...next,
          shape: normShape(next.shape),
          w,
          h,
          x: clamp(snap(next.x), 0, Math.max(0, L - w)),
          y: clamp(snap(next.y), 0, Math.max(0, W - h)),
        };
      }),
      id,
    );
  }, [L, W, commit, modules]);

  const undo = () => {
    const prev = past[past.length - 1];
    if (!prev) return;
    setFuture((f) => [modules, ...f].slice(0, 30));
    setPast((p) => p.slice(0, -1));
    setModules(prev);
    setSelId(prev.find((m) => m.id === selId)?.id ?? prev[0]?.id ?? null);
  };

  const redo = () => {
    const next = future[0];
    if (!next) return;
    setPast((p) => [...p.slice(-30), modules]);
    setFuture((f) => f.slice(1));
    setModules(next);
    setSelId(next.find((m) => m.id === selId)?.id ?? next[0]?.id ?? null);
  };

  const makeId = (type: string) => {
    let i = modules.length + 1;
    let id = shortId(type, i);
    const taken = new Set(modules.map((m) => m.id));
    while (taken.has(id)) {
      i++;
      id = shortId(type, i);
    }
    return id;
  };

  const addPreset = (preset: ModulePreset) => {
    const id = makeId(preset.type);
    const x = clamp(snap(L / 2 - preset.w / 2), 0, Math.max(0, L - preset.w));
    const y = clamp(snap(W / 2 - preset.h / 2), 0, Math.max(0, W - preset.h));
    const next: LayoutModule = {
      id,
      name: preset.name,
      type: preset.type,
      shape: preset.shape,
      x,
      y,
      w: preset.w,
      h: preset.h,
      layer: preset.layer,
      note: id,
      description: preset.description,
      ...(preset.height != null ? { height: preset.height } : {}),
      ...(preset.facing ? { facing: preset.facing } : {}),
      ...(preset.material ? { material: preset.material } : {}),
    };
    commit([...modules, next], id);
  };

  const addModule = () => addPreset({ type: 'default', label: '自定义', name: '自定义模块', shape: 'rect', w: 2, h: 1.5, layer: 'space', description: 'custom functional module' });

  const removeSel = useCallback(() => {
    if (!selId) return;
    const next = modules.filter((m) => m.id !== selId);
    commit(next, next[0]?.id ?? null);
  }, [commit, modules, selId]);

  const duplicateSel = () => {
    const sel = modules.find((m) => m.id === selId);
    if (!sel) return;
    const copy = {
      ...sel,
      id: makeId(sel.type),
      name: `${sel.name} 副本`,
      x: clamp(sel.x + 0.5, 0, Math.max(0, L - sel.w)),
      y: clamp(sel.y + 0.5, 0, Math.max(0, W - sel.h)),
    };
    commit([...modules, copy], copy.id);
  };

  const alignSel = (where: 'back' | 'front' | 'left' | 'right' | 'center') => {
    const sel = modules.find((m) => m.id === selId);
    if (!sel) return;
    if (where === 'back') update(sel.id, { y: 0 });
    if (where === 'front') update(sel.id, { y: W - sel.h });
    if (where === 'left') update(sel.id, { x: 0 });
    if (where === 'right') update(sel.id, { x: L - sel.w });
    if (where === 'center') update(sel.id, { x: L / 2 - sel.w / 2, y: W / 2 - sel.h / 2 });
  };

  useEffect(() => {
    const stage = stageRef.current;
    const node = selId ? stage?.findOne(`#${selId}`) : null;
    if (trRef.current) {
      trRef.current.nodes(node ? [node as Konva.Node] : []);
      trRef.current.getLayer()?.batchDraw();
    }
  }, [selId, modules, zoom]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
      const sel = modules.find((m) => m.id === selId);
      if ((e.key === 'Delete' || e.key === 'Backspace') && sel) {
        e.preventDefault();
        removeSel();
      }
      if (!sel || !['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) return;
      e.preventDefault();
      const step = e.shiftKey ? 1 : SNAP;
      const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
      const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
      update(sel.id, { x: sel.x + dx, y: sel.y + dy });
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [modules, removeSel, selId, update]);

  const layout = useMemo<BoothLayout>(
    () => ({
      length: L,
      width: W,
      openings: (openings.filter((o): o is LayoutOpening => OPENINGS.includes(o as LayoutOpening)) ?? []),
      zones: modules.map(moduleToZone),
    }),
    [L, W, openings, modules],
  );
  const issues = useMemo(() => checkBoothLayout(layout).filter((i) => i.severity !== 'warning').slice(0, 4), [layout]);
  const sel = modules.find((m) => m.id === selId) ?? null;

  const confirm = () => {
    setSelId(null);
    requestAnimationFrame(() => {
      const url = stageRef.current?.toDataURL({ pixelRatio: 2 }) ?? '';
      onConfirm(url, modules.map((m) => ({ ...m, shape: normShape(m.shape) })));
    });
  };

  const grid: React.ReactElement[] = [];
  for (let m = 1; m < L; m++) grid.push(<Line key={`gx${m}`} points={[ox + px(m), oy, ox + px(m), oy + px(W)]} stroke="#D7E3EF" strokeWidth={0.7 * zoom} listening={false} />);
  for (let m = 1; m < W; m++) grid.push(<Line key={`gy${m}`} points={[ox, oy + px(m), ox + px(L), oy + px(m)]} stroke="#D7E3EF" strokeWidth={0.7 * zoom} listening={false} />);

  return (
    <div className="grid max-w-[1180px] grid-cols-1 gap-4 lg:grid-cols-[250px_minmax(0,1fr)_280px]">
      <aside className="rounded-lg border border-ink-800 bg-ink-850/55 p-3">
        <div className="mono-tag mb-2 text-ink-500">对象库 / LIBRARY</div>
        <div className="grid grid-cols-2 gap-2">
          {PRESETS.map((p) => {
            const meta = typeMeta(p.type);
            return (
              <button key={p.label} type="button" onClick={() => addPreset(p)} className="u-tap rounded-md border border-ink-700 bg-ink-900 px-2.5 py-2 text-left hover:border-accent/60">
                <span className="mb-1 block h-1.5 w-8 rounded" style={{ background: meta.stroke }} />
                <span className="block text-[12px] text-ink-100">{p.label}</span>
                <span className="mono-tag text-[9px] text-ink-600">{p.w}×{p.h}m</span>
              </button>
            );
          })}
        </div>
        <button type="button" onClick={addModule} className="u-press mt-3 w-full rounded-md border border-ink-700 px-3 py-2 text-[12px] text-ink-200 hover:bg-ink-800">
          + 自定义模块
        </button>

        <div className="mt-4 rounded-md border border-ink-800 bg-ink-900 p-2.5">
          <div className="mono-tag mb-2 text-ink-500">规则提示</div>
          {issues.length ? (
            <ul className="space-y-1.5 text-[11px] leading-relaxed text-signal">
              {issues.map((i) => (
                <li key={i.code}>· {i.message}</li>
              ))}
            </ul>
          ) : (
            <p className="text-[11.5px] leading-relaxed text-ink-400">当前没有明显硬伤。确认前仍建议检查主通道、入口和背墙关系。</p>
          )}
        </div>
      </aside>

      <section className="min-w-0">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <button type="button" onClick={undo} disabled={!past.length} className="u-tap rounded-md border border-ink-700 px-2.5 py-1.5 text-[12px] text-ink-200 disabled:opacity-35">撤销</button>
          <button type="button" onClick={redo} disabled={!future.length} className="u-tap rounded-md border border-ink-700 px-2.5 py-1.5 text-[12px] text-ink-200 disabled:opacity-35">重做</button>
          <button type="button" onClick={duplicateSel} disabled={!sel} className="u-tap rounded-md border border-ink-700 px-2.5 py-1.5 text-[12px] text-ink-200 disabled:opacity-35">复制</button>
          <button type="button" onClick={removeSel} disabled={!sel} className="u-tap rounded-md border border-ink-700 px-2.5 py-1.5 text-[12px] text-ink-200 hover:border-signal/60 hover:text-signal disabled:opacity-35">删除</button>
          <span className="mono-tag ml-auto text-ink-500">{L}×{W}m · snap {SNAP}m</span>
          <button type="button" onClick={() => setZoom((z) => Math.max(0.75, +(z - 0.15).toFixed(2)))} className="u-tap rounded-md border border-ink-700 px-2 py-1 text-[12px] text-ink-200">-</button>
          <span className="mono-tag text-ink-500">{Math.round(zoom * 100)}%</span>
          <button type="button" onClick={() => setZoom((z) => Math.min(1.8, +(z + 0.15).toFixed(2)))} className="u-tap rounded-md border border-ink-700 px-2 py-1 text-[12px] text-ink-200">+</button>
        </div>

        <div className="max-w-full overflow-auto rounded-lg ring-1 ring-ink-800">
          <Stage ref={stageRef} width={cw} height={ch} style={{ background: '#F8FAFC' }} onMouseDown={(e) => { if (e.target === e.target.getStage()) setSelId(null); }}>
            <Layer>
              <Rect x={0} y={0} width={cw} height={ch} fill="#F8FAFC" listening={false} />
              {grid}
              {([['back', ox, oy, ox + px(L), oy], ['front', ox, oy + px(W), ox + px(L), oy + px(W)], ['left', ox, oy, ox, oy + px(W)], ['right', ox + px(L), oy, ox + px(L), oy + px(W)]] as const).map(([side, x1, y1, x2, y2]) => {
                const isOpen = openings.includes(side);
                return <Line key={side} points={[x1, y1, x2, y2]} stroke={isOpen ? '#2B7DB8' : '#111827'} strokeWidth={2.4 * zoom} dash={isOpen ? [8 * zoom, 6 * zoom] : undefined} opacity={isOpen ? 0.95 : 1} listening={false} />;
              })}
              <Text text="BACK / 后" x={ox + px(L) / 2 - 40 * zoom} y={oy - 28 * zoom} fontSize={12 * zoom} fill="#344054" fontStyle="bold" listening={false} />
              <Text text="FRONT / 前" x={ox + px(L) / 2 - 42 * zoom} y={oy + px(W) + 12 * zoom} fontSize={12 * zoom} fill="#344054" fontStyle="bold" listening={false} />
              <Text text="LEFT" x={ox - 40 * zoom} y={oy + px(W) / 2 - 7 * zoom} fontSize={11 * zoom} fill="#344054" fontStyle="bold" listening={false} />
              <Text text="RIGHT" x={ox + px(L) + 9 * zoom} y={oy + px(W) / 2 - 7 * zoom} fontSize={11 * zoom} fill="#344054" fontStyle="bold" listening={false} />

              {modules.map((m) => {
                const meta = typeMeta(m.type);
                const shape = normShape(m.shape);
                const wpx = px(m.w);
                const hpx = px(m.h);
                const selected = m.id === selId;
                const hitH = Math.max(hpx, 16 * zoom);
                const arrow = facingArrow(m.facing, wpx, hpx);
                return (
                  <Group
                    key={m.id}
                    id={m.id}
                    x={ox + px(m.x)}
                    y={oy + px(m.y)}
                    draggable
                    dragBoundFunc={(pos) => ({
                      x: clamp(pos.x, ox, ox + px(Math.max(0, L - m.w))),
                      y: clamp(pos.y, oy, oy + px(Math.max(0, W - m.h))),
                    })}
                    onMouseDown={(e) => {
                      e.cancelBubble = true;
                      setSelId(m.id);
                    }}
                    onTap={(e) => {
                      e.cancelBubble = true;
                      setSelId(m.id);
                    }}
                    onDragStart={() => setSelId(m.id)}
                    onDragEnd={(e) => update(m.id, { x: (e.target.x() - ox) / scale, y: (e.target.y() - oy) / scale })}
                    onTransformEnd={(e) => {
                      const node = e.target;
                      const sx = node.scaleX();
                      const sy = node.scaleY();
                      node.scaleX(1);
                      node.scaleY(1);
                      update(m.id, { w: m.w * sx, h: m.h * sy, x: (node.x() - ox) / scale, y: (node.y() - oy) / scale });
                    }}
                  >
                    {shape === 'l' ? (
                      <Line points={lPoints(wpx, hpx)} closed fill={meta.fill} stroke={meta.stroke} strokeWidth={selected ? 2.2 * zoom : 1.4 * zoom} />
                    ) : shape === 'circle' ? (
                      <Ellipse x={wpx / 2} y={hpx / 2} radiusX={wpx / 2} radiusY={hpx / 2} fill={meta.fill} stroke={meta.stroke} strokeWidth={selected ? 2.2 * zoom : 1.4 * zoom} />
                    ) : shape === 'capsule' ? (
                      <Rect width={wpx} height={hpx} fill={meta.fill} stroke={meta.stroke} strokeWidth={selected ? 2.2 * zoom : 1.4 * zoom} cornerRadius={Math.min(wpx, hpx) / 2} />
                    ) : shape === 'line' ? (
                      <Line points={[0, hpx / 2, wpx, hpx / 2]} stroke={meta.stroke} strokeWidth={Math.max(4 * zoom, hpx)} lineCap="round" />
                    ) : (
                      <Rect width={wpx} height={hpx} fill={meta.fill} stroke={meta.stroke} strokeWidth={selected ? 2.2 * zoom : 1.4 * zoom} cornerRadius={2 * zoom} />
                    )}
                    <Rect width={Math.max(wpx, 16 * zoom)} height={hitH} y={(hpx - hitH) / 2} fill="rgba(255,255,255,0.01)" />
                    {arrow && <Arrow points={arrow} pointerLength={5 * zoom} pointerWidth={5 * zoom} stroke={meta.stroke} fill={meta.stroke} strokeWidth={1.4 * zoom} listening={false} />}
                    <Text text={`${m.id} · ${m.name}`} x={4 * zoom} y={Math.max(3 * zoom, hpx / 2 - 16 * zoom)} width={wpx - 8 * zoom} align="center" fontSize={10.5 * zoom} fill="#111827" fontStyle="bold" listening={false} />
                    <Text text={`${MODULE_TYPES[m.type]?.label ?? '模块'} · ${m.w}×${m.h}m${m.height ? ` · H${m.height}m` : ''}`} x={4 * zoom} y={Math.max(17 * zoom, hpx / 2)} width={wpx - 8 * zoom} align="center" fontSize={8.5 * zoom} fill="#475467" fontStyle="bold" listening={false} />
                  </Group>
                );
              })}
              <Transformer ref={trRef} rotateEnabled={false} anchorSize={8 * zoom} borderStroke="#6FA1C9" anchorStroke="#6FA1C9" anchorFill="#0B0C0F" boundBoxFunc={(oldB, newB) => (newB.width < 18 * zoom || newB.height < 18 * zoom ? oldB : newB)} />
            </Layer>
          </Stage>
        </div>

        <div className="mt-3 flex gap-2">
          <button onClick={confirm} className="u-press rounded-lg bg-accent px-4 py-2 text-[13px] font-medium text-ink-950 hover:bg-accent-deep">确认布局 → 出图</button>
          <button onClick={onCancel} className="u-press rounded-lg border border-ink-700 px-4 py-2 text-[13px] text-ink-200 hover:bg-ink-800">取消</button>
        </div>
      </section>

      <aside className="rounded-lg border border-ink-800 bg-ink-850/55 p-3">
        <div className="mono-tag mb-2 text-ink-500">属性 / INSPECTOR</div>
        {sel ? (
          <div className="space-y-3 text-[12px] text-ink-300">
            <label className="block">
              <span className="mb-1 block text-ink-500">ID / 名称</span>
              <div className="grid grid-cols-[70px_1fr] gap-2">
                <input value={sel.id} onChange={(e) => update(sel.id, { id: e.target.value.trim() || sel.id })} className="rounded border border-ink-700 bg-ink-900 px-2 py-1 text-ink-100 outline-none focus:border-accent" />
                <input value={sel.name} onChange={(e) => update(sel.id, { name: e.target.value })} className="rounded border border-ink-700 bg-ink-900 px-2 py-1 text-ink-100 outline-none focus:border-accent" />
              </div>
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label>
                <span className="mb-1 block text-ink-500">类型</span>
                <select value={sel.type} onChange={(e) => update(sel.id, { type: e.target.value, layer: typeMeta(e.target.value).layer })} className="w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 text-ink-100 outline-none">
                  {Object.entries(MODULE_TYPES).map(([value, meta]) => <option key={value} value={value}>{meta.label}</option>)}
                </select>
              </label>
              <label>
                <span className="mb-1 block text-ink-500">图形</span>
                <select value={normShape(sel.shape)} onChange={(e) => update(sel.id, { shape: e.target.value as LayoutShape })} className="w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 text-ink-100 outline-none">
                  {Object.entries(SHAPE_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </label>
            </div>
            <div className="grid grid-cols-4 gap-2">
              {(['x', 'y', 'w', 'h'] as const).map((key) => (
                <label key={key}>
                  <span className="mb-1 block text-ink-500">{key}</span>
                  <input type="number" step={SNAP} value={sel[key]} onChange={(e) => update(sel.id, { [key]: Number(e.target.value) } as Partial<LayoutModule>)} className="w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 text-ink-100 outline-none" />
                </label>
              ))}
            </div>
            <div className="grid grid-cols-3 gap-2">
              <label>
                <span className="mb-1 block text-ink-500">高度</span>
                <input type="number" step={0.1} value={sel.height ?? ''} onChange={(e) => update(sel.id, { height: e.target.value === '' ? undefined : Number(e.target.value) })} className="w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 text-ink-100 outline-none" />
              </label>
              <label>
                <span className="mb-1 block text-ink-500">朝向</span>
                <select value={sel.facing ?? ''} onChange={(e) => update(sel.id, { facing: e.target.value ? (e.target.value as LayoutFacing) : undefined })} className="w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 text-ink-100 outline-none">
                  <option value="">未设</option>
                  {Object.entries(FACING_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </label>
              <label>
                <span className="mb-1 block text-ink-500">层级</span>
                <select value={sel.layer ?? 'space'} onChange={(e) => update(sel.id, { layer: e.target.value as LayoutLayer })} className="w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 text-ink-100 outline-none">
                  {LAYERS.map((l) => <option key={l} value={l}>{l}</option>)}
                </select>
              </label>
            </div>
            <label className="block">
              <span className="mb-1 block text-ink-500">材质</span>
              <input value={sel.material ?? ''} onChange={(e) => update(sel.id, { material: e.target.value })} className="w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 text-ink-100 outline-none focus:border-accent" />
            </label>
            <label className="block">
              <span className="mb-1 block text-ink-500">描述 / 进入 prompt</span>
              <textarea value={sel.description ?? ''} onChange={(e) => update(sel.id, { description: e.target.value })} rows={3} className="w-full resize-none rounded border border-ink-700 bg-ink-900 px-2 py-1 text-ink-100 outline-none focus:border-accent" />
            </label>
            <div className="grid grid-cols-5 gap-1.5">
              {(['back', 'front', 'left', 'right', 'center'] as const).map((a) => (
                <button key={a} type="button" onClick={() => alignSel(a)} className="u-tap rounded border border-ink-700 px-1.5 py-1 text-[11px] text-ink-300 hover:border-accent/60">{a === 'center' ? '中' : a}</button>
              ))}
            </div>
          </div>
        ) : (
          <p className="text-[12px] leading-relaxed text-ink-500">点击画布中的对象进行编辑。可拖拽、缩放、方向键微调，Delete 删除。</p>
        )}
      </aside>
    </div>
  );
}
