import type { BoothLayout, BoothLayoutZone, LayoutOpening } from './types';

const EDGES: LayoutOpening[] = ['back', 'front', 'left', 'right'];

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
const edgeLength = (layout: BoothLayout, edge: LayoutOpening) => (edge === 'back' || edge === 'front' ? layout.length : layout.width);
const edgeLabel = (edge: LayoutOpening) =>
  ({
    back: 'BACK/top long side',
    front: 'FRONT/main aisle long side',
    left: 'LEFT short side',
    right: 'RIGHT short side',
  })[edge];

function touches(layout: BoothLayout, z: BoothLayoutZone): LayoutOpening[] {
  const eps = 0.05;
  const out: LayoutOpening[] = [];
  if (z.y <= eps) out.push('back');
  if (z.y + z.h >= layout.width - eps) out.push('front');
  if (z.x <= eps) out.push('left');
  if (z.x + z.w >= layout.length - eps) out.push('right');
  return out;
}

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
      touches: touches(layout, z),
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
