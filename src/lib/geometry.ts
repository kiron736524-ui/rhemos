import type { BoothLayout, BoothLayoutZone, LayoutOpening } from './types';

/**
 * 几何单一真相源（纯函数，不依赖模型 / 不调 API）。booth-rules / cad / present-choices 共用此处，
 * 不再各自重复定义 EDGES / edgeLength / closedEdges / 贴边判定（见 DECISIONS D39）。
 *
 * 坐标系（与前端 FloorPlan / LayoutEditor、CAD 文档一致）：
 *   x 沿长边 ∈ [0, length]，y 沿进深 ∈ [0, width]；
 *   back = y0(顶) · front = y最大(底/主通道侧) · left = x0 · right = x最大。
 *
 * 贴边判定有**两套语义不同、容差不同**的实现，集中声明于此：
 *   - touchesEdge（严格，EDGE_TOUCH_EPS=0.05m）：用于「序列化」(CAD 文档 touches[])——
 *     回答"对象的边是否几乎压在展台边线上"，要求近乎贴合，求精确。
 *   - hugsEdge（相对容差，max(EDGE_HUG_MIN=0.3m, 边长*EDGE_HUG_FRAC=8%)）：用于「规则判定」
 *     (booth-rules)——回答"对象大体上算靠这条边吗"，求容错。
 *   二者刻意不同：序列化要精确、规则要宽松。要调容差只改下面的常量。
 */
export const EDGES: readonly LayoutOpening[] = ['back', 'front', 'left', 'right'];

/** 严格贴边容差（序列化用，米）。 */
export const EDGE_TOUCH_EPS = 0.05;
/** 规则贴边容差下限（米）。 */
export const EDGE_HUG_MIN = 0.3;
/** 规则贴边容差占边长比例。 */
export const EDGE_HUG_FRAC = 0.08;

/** 边长：back/front 沿长边 = length；left/right 沿短边 = width。 */
export const edgeLength = (l: BoothLayout, edge: LayoutOpening): number =>
  edge === 'back' || edge === 'front' ? l.length : l.width;

/** 展台外轮廓面积。 */
export const footprintArea = (l: BoothLayout): number => Math.max(0, l.length) * Math.max(0, l.width);

/** zone 面积。 */
export const area = (z: BoothLayoutZone): number => Math.max(0, z.w) * Math.max(0, z.h);

/** 两 zone 重叠面积。 */
export function overlapArea(a: BoothLayoutZone, b: BoothLayoutZone): number {
  const ox = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const oy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  return ox * oy;
}

/** 封闭边 = EDGES 中不在 openings 里的（顺序按 EDGES）。 */
export const closedEdges = (openings: LayoutOpening[] = []): LayoutOpening[] => {
  const open = new Set(openings);
  return EDGES.filter((e) => !open.has(e));
};

/** 两面开关系：相对(parallel) vs 相邻(corner) vs 未知。 */
export function openingRelation(openings: LayoutOpening[]): 'parallel' | 'corner' | 'unknown' {
  if (openings.length !== 2) return 'unknown';
  const s = new Set(openings);
  if ((s.has('front') && s.has('back')) || (s.has('left') && s.has('right'))) return 'parallel';
  return 'corner';
}

/** 规则贴边容差：max(EDGE_HUG_MIN, 该方向尺寸 * EDGE_HUG_FRAC)。 */
export function edgeTol(l: BoothLayout, axis: 'x' | 'y'): number {
  return Math.max(EDGE_HUG_MIN, (axis === 'x' ? l.length : l.width) * EDGE_HUG_FRAC);
}

/** zone 是否「大体靠」某条边（相对容差，规则判定用）。 */
export function hugsEdge(z: BoothLayoutZone, l: BoothLayout, edge: LayoutOpening): boolean {
  switch (edge) {
    case 'back':
      return z.y <= edgeTol(l, 'y');
    case 'front':
      return l.width - (z.y + z.h) <= edgeTol(l, 'y');
    case 'left':
      return z.x <= edgeTol(l, 'x');
    case 'right':
      return l.length - (z.x + z.w) <= edgeTol(l, 'x');
  }
}

/** zone「严格压在」哪些边上（EDGE_TOUCH_EPS，序列化用）。返回边按 back/front/left/right。 */
export function touchesEdge(z: BoothLayoutZone, l: BoothLayout): LayoutOpening[] {
  const eps = EDGE_TOUCH_EPS;
  const out: LayoutOpening[] = [];
  if (z.y <= eps) out.push('back');
  if (z.y + z.h >= l.width - eps) out.push('front');
  if (z.x <= eps) out.push('left');
  if (z.x + z.w >= l.length - eps) out.push('right');
  return out;
}

/** zone 沿某条边的占边比例（0-1+）。 */
export function edgeSpanFrac(z: BoothLayoutZone, l: BoothLayout, edge: LayoutOpening): number {
  if (edge === 'front' || edge === 'back') return l.length > 0 ? z.w / l.length : 0;
  return l.width > 0 ? z.h / l.width : 0;
}

/** zone 是否大致居中于某条边（中点靠近边中点 ±20%）。 */
export function centeredOnEdge(z: BoothLayoutZone, l: BoothLayout, edge: LayoutOpening): boolean {
  if (edge === 'front' || edge === 'back') {
    return Math.abs(z.x + z.w / 2 - l.length / 2) <= l.length * 0.2;
  }
  return Math.abs(z.y + z.h / 2 - l.width / 2) <= l.width * 0.2;
}

/** zone 是否覆盖展台几何中心点。 */
export function coversCenter(z: BoothLayoutZone, l: BoothLayout): boolean {
  const cx = l.length / 2;
  const cy = l.width / 2;
  return z.x <= cx && cx <= z.x + z.w && z.y <= cy && cy <= z.y + z.h;
}
