'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * 画笔涂抹蒙版编辑器（独立弹窗，移植自 rhemax InpaintOverlay 内核 + 补橡皮擦/清空/可重编辑）。
 * 纯 props 组件，不依赖画布工作室/全局 store。
 *
 * 双 canvas：
 *  - maskCanvas（隐藏，原图分辨率）：存红色涂抹痕迹（destination-out 实现橡皮擦）。
 *  - displayCanvas（可见，缩放到视口）：实时画「原图 + 半透明红色蒙版」给用户看。
 *
 * onConfirm 回传 { maskDataUrl(黑白,白=改), paintedDataUrl(原图+红痕,给悬浮预览) }；
 * 都为 null = 用户清空了痕迹（该图回到无蒙版态）。initialMaskDataUrl 传入黑白蒙版可重编辑。
 */

type BrushMode = 'brush' | 'eraser' | 'pen';
interface PenPoint {
  nx: number;
  ny: number;
}

const BRUSH_SIZES = [
  { id: 's', label: '小', radius: 8 },
  { id: 'm', label: '中', radius: 18 },
  { id: 'l', label: '大', radius: 32 },
  { id: 'xl', label: '超大', radius: 52 },
] as const;

const MASK_FILL = 'rgba(229, 62, 62, 0.55)'; // 红色涂抹痕迹（canvas 像素，非 UI token）
const PEN_LINE = 'rgba(229, 62, 62, 0.9)';
const PEN_CLOSE_DISTANCE = 12;

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

export interface BrushEditorResult {
  maskDataUrl: string | null;
  paintedDataUrl: string | null;
}

interface BrushEditorProps {
  imageUrl: string;
  initialMaskDataUrl?: string | null;
  onConfirm: (result: BrushEditorResult) => void;
  onCancel: () => void;
}

function ToolBtn({ active, label, onClick, disabled, children }: { active?: boolean; label: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      className={`u-press flex h-9 min-w-9 items-center justify-center gap-1 rounded-lg border px-2.5 text-[12px] ${
        active ? 'border-accent bg-accent-soft text-accent' : 'border-ink-700 text-ink-300 hover:text-ink-100'
      } disabled:opacity-40`}
    >
      {children}
    </button>
  );
}

export default function BrushEditor({ imageUrl, initialMaskDataUrl, onConfirm, onCancel }: BrushEditorProps) {
  const [mode, setMode] = useState<BrushMode>('brush');
  const [brushIdx, setBrushIdx] = useState(1);
  const [penPoints, setPenPoints] = useState<PenPoint[]>([]);
  const [displaySize, setDisplaySize] = useState({ w: 0, h: 0 });
  const [ready, setReady] = useState(false);

  const maskCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const displayCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const dimsRef = useRef({ w: 0, h: 0 });
  const isDrawingRef = useRef(false);
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);
  const undoStackRef = useRef<ImageData[]>([]);
  const [undoDepth, setUndoDepth] = useState(0);

  /* ---- 重画显示层：原图 + 半透明红蒙版 ---- */
  const redrawDisplay = useCallback(() => {
    const dc = displayCanvasRef.current;
    const dctx = dc?.getContext('2d');
    const img = imgRef.current;
    const mask = maskCanvasRef.current;
    if (!dc || !dctx || !img || !mask) return;
    dctx.clearRect(0, 0, dc.width, dc.height);
    dctx.drawImage(img, 0, 0, dc.width, dc.height);
    dctx.drawImage(mask, 0, 0, dc.width, dc.height);
  }, []);

  /* ---- 载入图片 + 计算显示尺寸 + 可选回填已有蒙版 ---- */
  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 切换目标图时重置加载态，随后异步载入
    setReady(false);
    (async () => {
      try {
        const img = await loadImage(imageUrl);
        if (cancelled) return;
        imgRef.current = img;
        const w = img.naturalWidth || img.width;
        const h = img.naturalHeight || img.height;
        dimsRef.current = { w, h };
        const maxW = window.innerWidth * 0.78;
        const maxH = window.innerHeight * 0.66;
        const scale = Math.min(1, maxW / w, maxH / h);
        const dw = Math.round(w * scale);
        const dh = Math.round(h * scale);

        const mask = maskCanvasRef.current!;
        mask.width = w;
        mask.height = h;
        const mctx = mask.getContext('2d')!;
        mctx.clearRect(0, 0, w, h);
        // 重编辑：把传入的黑白蒙版(白=已涂)还原成红色痕迹
        if (initialMaskDataUrl) {
          try {
            const maskImg = await loadImage(initialMaskDataUrl);
            if (cancelled) return;
            const tmp = document.createElement('canvas');
            tmp.width = w;
            tmp.height = h;
            const tctx = tmp.getContext('2d')!;
            tctx.drawImage(maskImg, 0, 0, w, h);
            const md = tctx.getImageData(0, 0, w, h);
            const out = mctx.createImageData(w, h);
            for (let i = 0; i < md.data.length; i += 4) {
              if (md.data[i] > 128) {
                out.data[i] = 229;
                out.data[i + 1] = 62;
                out.data[i + 2] = 62;
                out.data[i + 3] = 140;
              }
            }
            mctx.putImageData(out, 0, 0);
          } catch {
            /* 蒙版载入失败：当无痕迹处理 */
          }
        }

        const dc = displayCanvasRef.current!;
        dc.width = dw;
        dc.height = dh;
        undoStackRef.current = [];
        setUndoDepth(0);
        setPenPoints([]);
        setDisplaySize({ w: dw, h: dh });
        setReady(true);
        // 下一帧重画（canvas 尺寸已就位）
        requestAnimationFrame(() => redrawDisplay());
      } catch {
        onCancel();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [imageUrl, initialMaskDataUrl, redrawDisplay, onCancel]);

  /* ---- 坐标换算 ---- */
  const evtNorm = useCallback((e: React.PointerEvent | React.MouseEvent) => {
    const dc = displayCanvasRef.current;
    if (!dc) return { nx: 0, ny: 0 };
    const rect = dc.getBoundingClientRect();
    return { nx: (e.clientX - rect.left) / rect.width, ny: (e.clientY - rect.top) / rect.height };
  }, []);

  const snapshot = useCallback(() => {
    const mctx = maskCanvasRef.current?.getContext('2d');
    const { w, h } = dimsRef.current;
    if (!mctx || !w) return;
    undoStackRef.current.push(mctx.getImageData(0, 0, w, h));
    if (undoStackRef.current.length > 30) undoStackRef.current.shift();
    setUndoDepth(undoStackRef.current.length);
  }, []);

  /* ---- 画笔/橡皮：在 mask 画布上落点/连线 ---- */
  const stroke = useCallback(
    (nx1: number, ny1: number, nx2: number, ny2: number, dot: boolean) => {
      const mctx = maskCanvasRef.current?.getContext('2d');
      const { w } = dimsRef.current;
      if (!mctx || !w || displaySize.w === 0) return;
      const scale = w / displaySize.w;
      const r = BRUSH_SIZES[brushIdx].radius * scale;
      const erase = mode === 'eraser';
      mctx.globalCompositeOperation = erase ? 'destination-out' : 'source-over';
      mctx.fillStyle = MASK_FILL;
      mctx.strokeStyle = MASK_FILL;
      if (dot) {
        mctx.beginPath();
        mctx.arc(nx1 * w, ny1 * dimsRef.current.h, r, 0, Math.PI * 2);
        mctx.fill();
      } else {
        mctx.lineWidth = r * 2;
        mctx.lineCap = 'round';
        mctx.lineJoin = 'round';
        mctx.beginPath();
        mctx.moveTo(nx1 * w, ny1 * dimsRef.current.h);
        mctx.lineTo(nx2 * w, ny2 * dimsRef.current.h);
        mctx.stroke();
      }
      mctx.globalCompositeOperation = 'source-over';
    },
    [brushIdx, mode, displaySize.w],
  );

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (mode === 'pen' || !ready) return;
      e.preventDefault();
      try {
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
      } catch {
        /* 某些指针/合成事件不支持 capture，忽略 */
      }
      isDrawingRef.current = true;
      snapshot();
      const { nx, ny } = evtNorm(e);
      lastPointRef.current = { x: nx, y: ny };
      stroke(nx, ny, nx, ny, true);
      redrawDisplay();
    },
    [mode, ready, snapshot, evtNorm, stroke, redrawDisplay],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (mode === 'pen' || !isDrawingRef.current) return;
      e.preventDefault();
      const { nx, ny } = evtNorm(e);
      const last = lastPointRef.current;
      if (last) stroke(last.x, last.y, nx, ny, false);
      lastPointRef.current = { x: nx, y: ny };
      redrawDisplay();
    },
    [mode, evtNorm, stroke, redrawDisplay],
  );

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    isDrawingRef.current = false;
    lastPointRef.current = null;
    try {
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  }, []);

  /* ---- 钢笔：点选多边形顶点，点回第一个点闭合填充 ---- */
  const onPenClick = useCallback(
    (e: React.MouseEvent) => {
      if (mode !== 'pen' || !ready) return;
      e.preventDefault();
      const { nx, ny } = evtNorm(e);
      if (penPoints.length >= 3) {
        const first = penPoints[0];
        const dx = (first.nx - nx) * displaySize.w;
        const dy = (first.ny - ny) * displaySize.h;
        if (Math.sqrt(dx * dx + dy * dy) < PEN_CLOSE_DISTANCE) {
          const mctx = maskCanvasRef.current?.getContext('2d');
          const { w, h } = dimsRef.current;
          if (mctx && w) {
            snapshot();
            mctx.fillStyle = MASK_FILL;
            mctx.beginPath();
            mctx.moveTo(penPoints[0].nx * w, penPoints[0].ny * h);
            for (let i = 1; i < penPoints.length; i++) mctx.lineTo(penPoints[i].nx * w, penPoints[i].ny * h);
            mctx.closePath();
            mctx.fill();
          }
          setPenPoints([]);
          redrawDisplay();
          return;
        }
      }
      setPenPoints((p) => [...p, { nx, ny }]);
    },
    [mode, ready, evtNorm, penPoints, displaySize, snapshot, redrawDisplay],
  );

  /* ---- 钢笔预览（虚线 + 顶点）画在显示层 ---- */
  useEffect(() => {
    if (mode !== 'pen') return;
    redrawDisplay();
    if (penPoints.length === 0) return;
    const dctx = displayCanvasRef.current?.getContext('2d');
    if (!dctx) return;
    dctx.strokeStyle = PEN_LINE;
    dctx.lineWidth = 2;
    dctx.setLineDash([6, 3]);
    dctx.beginPath();
    dctx.moveTo(penPoints[0].nx * displaySize.w, penPoints[0].ny * displaySize.h);
    for (let i = 1; i < penPoints.length; i++) dctx.lineTo(penPoints[i].nx * displaySize.w, penPoints[i].ny * displaySize.h);
    dctx.stroke();
    dctx.setLineDash([]);
    for (let i = 0; i < penPoints.length; i++) {
      dctx.fillStyle = PEN_LINE;
      dctx.beginPath();
      dctx.arc(penPoints[i].nx * displaySize.w, penPoints[i].ny * displaySize.h, i === 0 ? 6 : 4, 0, Math.PI * 2);
      dctx.fill();
    }
  }, [penPoints, mode, displaySize, redrawDisplay]);

  /* ---- 撤销 / 清空 ---- */
  const undo = useCallback(() => {
    const mctx = maskCanvasRef.current?.getContext('2d');
    const prev = undoStackRef.current.pop();
    setUndoDepth(undoStackRef.current.length);
    if (mctx && prev) mctx.putImageData(prev, 0, 0);
    setPenPoints([]);
    redrawDisplay();
  }, [redrawDisplay]);

  const clearAll = useCallback(() => {
    const mctx = maskCanvasRef.current?.getContext('2d');
    const { w, h } = dimsRef.current;
    if (!mctx || !w) return;
    snapshot();
    mctx.clearRect(0, 0, w, h);
    setPenPoints([]);
    redrawDisplay();
  }, [snapshot, redrawDisplay]);

  /* ---- 键盘：Esc 取消 / ⌘Z 撤销 ---- */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
      else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        undo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel, undo]);

  /* ---- 确认：导出黑白蒙版 + 涂抹预览 ---- */
  const confirm = useCallback(() => {
    const mask = maskCanvasRef.current;
    const img = imgRef.current;
    const { w, h } = dimsRef.current;
    if (!mask || !img || !w) {
      onCancel();
      return;
    }
    const mctx = mask.getContext('2d')!;
    const data = mctx.getImageData(0, 0, w, h).data;
    let painted = false;
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] > 10) {
        painted = true;
        break;
      }
    }
    if (!painted) {
      // 用户清空了痕迹 → 该图回到无蒙版态
      onConfirm({ maskDataUrl: null, paintedDataUrl: null });
      return;
    }
    // 黑白蒙版：涂抹处→白，其余→黑
    const bw = document.createElement('canvas');
    bw.width = w;
    bw.height = h;
    const bctx = bw.getContext('2d')!;
    bctx.fillStyle = 'rgb(0,0,0)';
    bctx.fillRect(0, 0, w, h);
    const dst = bctx.getImageData(0, 0, w, h);
    const src = mctx.getImageData(0, 0, w, h);
    for (let i = 0; i < src.data.length; i += 4) {
      if (src.data[i + 3] > 10) {
        dst.data[i] = 255;
        dst.data[i + 1] = 255;
        dst.data[i + 2] = 255;
        dst.data[i + 3] = 255;
      }
    }
    bctx.putImageData(dst, 0, 0);
    // 涂抹预览：原图 + 红色蒙版（给悬浮缩略图，用户只见这张）
    const pv = document.createElement('canvas');
    pv.width = w;
    pv.height = h;
    const pctx = pv.getContext('2d')!;
    pctx.drawImage(img, 0, 0, w, h);
    pctx.drawImage(mask, 0, 0, w, h);
    onConfirm({ maskDataUrl: bw.toDataURL('image/png'), paintedDataUrl: pv.toDataURL('image/png') });
  }, [onConfirm, onCancel]);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-ink-950/92 p-6 backdrop-blur-sm">
      <div className="flex max-h-full flex-col items-center gap-3 overflow-auto rounded-xl border border-ink-800 bg-ink-900 p-5">
        <div className="flex w-full items-center justify-between gap-4">
          <span className="text-[13.5px] font-medium text-ink-50">画笔涂抹 · 圈出要修改的区域</span>
          <span className="mono-tag text-ink-500">涂抹处会被重绘，其余保持不变</span>
        </div>

        {/* 画布 */}
        <div className="relative" style={{ width: displaySize.w || 320, height: displaySize.h || 200 }}>
          <canvas ref={maskCanvasRef} style={{ display: 'none' }} />
          <canvas
            ref={displayCanvasRef}
            className="rounded-lg ring-1 ring-ink-700"
            style={{ width: displaySize.w, height: displaySize.h, cursor: 'crosshair', touchAction: 'none' }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onClick={onPenClick}
          />
          {!ready && <div className="absolute inset-0 grid place-items-center text-[12px] text-ink-500">加载中…</div>}
        </div>

        {/* 工具栏 */}
        <div className="flex flex-wrap items-center justify-center gap-1.5">
          <ToolBtn active={mode === 'brush'} label="画笔 — 自由涂抹" onClick={() => { setMode('brush'); setPenPoints([]); }}>画笔</ToolBtn>
          <ToolBtn active={mode === 'eraser'} label="橡皮擦 — 擦掉痕迹" onClick={() => { setMode('eraser'); setPenPoints([]); }}>橡皮</ToolBtn>
          <ToolBtn active={mode === 'pen'} label="钢笔 — 点选多边形" onClick={() => setMode('pen')}>钢笔</ToolBtn>

          {mode !== 'pen' && (
            <span className="mx-1 flex items-center gap-1">
              {BRUSH_SIZES.map((bs, i) => (
                <button
                  key={bs.id}
                  type="button"
                  title={`笔刷：${bs.label}`}
                  onClick={() => setBrushIdx(i)}
                  className={`u-press grid h-9 w-9 place-items-center rounded-lg border ${brushIdx === i ? 'border-accent bg-accent-soft text-accent' : 'border-ink-700 text-ink-400 hover:text-ink-100'}`}
                >
                  <span style={{ width: 4 + i * 4, height: 4 + i * 4, borderRadius: '50%', background: 'currentColor', display: 'block' }} />
                </button>
              ))}
            </span>
          )}

          <ToolBtn label="撤销 (⌘Z)" onClick={undo} disabled={undoDepth === 0}>撤销</ToolBtn>
          <ToolBtn label="清空全部痕迹" onClick={clearAll}>清空</ToolBtn>

          <span className="mx-1 h-5 w-px bg-ink-700" />
          <ToolBtn label="取消 (Esc)" onClick={onCancel}>取消</ToolBtn>
          <button
            type="button"
            onClick={confirm}
            className="u-press flex h-9 items-center justify-center rounded-lg bg-accent px-4 text-[12.5px] font-medium text-ink-950 transition hover:bg-accent-deep"
          >
            完成
          </button>
        </div>

        {mode === 'pen' && penPoints.length > 0 && (
          <span className="mono-tag text-ink-500">{penPoints.length < 3 ? `已打 ${penPoints.length} 个点（≥3 可闭合）` : '点回第一个点闭合区域'}</span>
        )}
      </div>
    </div>
  );
}
