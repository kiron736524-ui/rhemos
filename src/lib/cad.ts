import type { BoothLayout, DesignSpec, LayoutOpening } from './types';
import { EDGES, edgeLength, touchesEdge } from './geometry';

export type CadUnit = 'm';

export interface CadEdge {
  id: LayoutOpening;
  label: string;
  orientation: 'horizontal' | 'vertical';
  length: number;
  open: boolean;
}

export interface CadObject {
  id: string;
  name: string;
  type: string;
  layer: 'space' | 'object' | 'detail';
  shape: string;
  bbox: { x: number; y: number; w: number; h: number };
  height?: number;
  facing?: string;
  material?: string;
  description?: string;
  parentId?: string;
  touches: LayoutOpening[];
}

export interface CadDocument {
  version: 'rhemos-cad-v1';
  unit: CadUnit;
  coordinateSystem: {
    origin: 'back-left';
    xAxis: 'left-to-right along booth length';
    yAxis: 'back-to-front along booth depth';
  };
  footprint: { shape: 'rectangle'; length: number; width: number };
  edges: CadEdge[];
  objects: CadObject[];
  constraints: string[];
}

const fmt = (n: number) => Number(n.toFixed(2));
const edgeLabel = (edge: LayoutOpening) =>
  ({
    back: 'BACK/top long side',
    front: 'FRONT/main aisle long side',
    left: 'LEFT short side',
    right: 'RIGHT short side',
  })[edge];

export function layoutToCadDocument(layout: BoothLayout): CadDocument {
  const open = new Set(layout.openings ?? []);
  return {
    version: 'rhemos-cad-v1',
    unit: 'm',
    coordinateSystem: {
      origin: 'back-left',
      xAxis: 'left-to-right along booth length',
      yAxis: 'back-to-front along booth depth',
    },
    footprint: { shape: 'rectangle', length: fmt(layout.length), width: fmt(layout.width) },
    edges: EDGES.map((edge) => ({
      id: edge,
      label: edgeLabel(edge),
      orientation: edge === 'back' || edge === 'front' ? 'horizontal' : 'vertical',
      length: fmt(edgeLength(layout, edge)),
      open: open.has(edge),
    })),
    objects: layout.zones.map((z, idx) => ({
      id: z.id || `O${idx + 1}`,
      name: z.name,
      type: z.type ?? 'zone',
      layer: z.layer ?? 'object',
      shape: z.shape ?? 'rect',
      bbox: { x: fmt(z.x), y: fmt(z.y), w: fmt(z.w), h: fmt(z.h) },
      ...(z.height != null ? { height: fmt(z.height) } : {}),
      ...(z.facing ? { facing: z.facing } : {}),
      ...(z.material ? { material: z.material } : {}),
      ...(z.description ? { description: z.description } : {}),
      ...(z.parentId ? { parentId: z.parentId } : {}),
      touches: touchesEdge(z, layout),
    })),
    constraints: [
      'The footprint is the authoritative booth boundary and must remain a strict rectangle unless the document shape changes.',
      'Open edges must remain open and cannot be blocked by bulky objects.',
      'Objects are authoritative by id, bbox, shape, layer, height, facing, material, and description.',
      'Detail-layer or overhead objects may visually sit above the plan but do not change the floor footprint.',
      'Freestanding totems/standees are interior objects only and never become walls or footprint protrusions.',
    ],
  };
}

export function cadPromptLock(layout?: BoothLayout): string {
  if (!layout) return '';
  const cad = layoutToCadDocument(layout);
  return `RHEMOS_CAD_DOCUMENT_V1 (authoritative machine-readable layout, metric):
${JSON.stringify(cad, null, 2)}

Use this CAD document as the source of truth. The PNG floor plan, if attached, is only a visual rendering of this same CAD data. Do not infer a different layout from prose. Do not swap left/right/front/back. Do not merge unrelated CAD objects. Do not move objects to another edge. Do not convert the strict rectangular footprint into a polygon, notch, chamfer, protrusion, curved edge, or add-on island.`;
}

/**
 * footprint 外轮廓硬规则文案的**单一来源**（footprint 在 DesignSpec.footprint 一处声明，此处资产化、多处复用）。
 * 优先用 spec.footprint.boundaryRule（用户/方案显式写的轮廓规则）；否则按 layout 实测尺寸生成带具体米数的矩形硬规则；
 * 都没有时给通用矩形硬规则。render 注入 identity、其它生图调用点也可复用，避免同一约束在代码里抄多份。
 */
export function buildFootprintLock(spec?: DesignSpec, layout?: BoothLayout): string {
  if (spec?.footprint?.boundaryRule) return spec.footprint.boundaryRule;
  if (layout) {
    return `Booth outer footprint shape is a STRICT RECTANGLE, exactly ${layout.length}m x ${layout.width}m. The raised platform, carpet/floor finish edge, truss perimeter, back wall line, and booth boundary must be one unbroken rectilinear outline with four 90-degree corners. Do NOT create a hexagonal, octagonal, chamfered, diagonal-cut, curved, notched, stepped, bitten-out, protruding, warped, or polygonal outer perimeter. No random add-on floor islands, no corner bulges, and no facade piece may extend outside the rectangle unless the user explicitly requested that irregular shape. Any circular route, ring feature, totem, standee, or decorative feature is an interior design element only, never the booth outline.`;
  }
  return 'Booth outer footprint shape is a STRICT RECTANGLE with four 90-degree corners unless the user explicitly requested an irregular custom perimeter. The platform/carpet edge and truss perimeter must be one unbroken rectangle: no hexagonal, octagonal, chamfered, diagonal-cut, curved, notched, stepped, bitten-out, protruding, warped, add-on, or polygonal outer perimeter. Totems and standees are interior elements only.';
}
