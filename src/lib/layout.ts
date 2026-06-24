import { z } from 'zod';
import type { BoothLayout, LayoutFacing, LayoutLayer, LayoutOpening, LayoutShape, LayoutZoneType } from './types';

const OPENINGS: LayoutOpening[] = ['front', 'back', 'left', 'right'];
const ZONE_TYPES: LayoutZoneType[] = ['led', 'screen', 'stage', 'brand', 'wall', 'reception', 'counter', 'meeting', 'storage', 'product', 'showcase', 'table', 'chair', 'totem', 'truss', 'door', 'plant', 'aisle'];
const SHAPES: LayoutShape[] = ['rect', 'l', 'circle', 'capsule', 'line'];
const FACINGS: LayoutFacing[] = ['front', 'back', 'left', 'right', 'center'];
const LAYERS: LayoutLayer[] = ['space', 'object', 'detail'];

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, Number.isFinite(n) ? n : min));
const short = (s: string | undefined, max: number) => (s ? s.trim().slice(0, max) : undefined);

export const boothLayoutSchema = z.object({
  length: z.number().positive().max(100).describe('长边长度（米）'),
  width: z.number().positive().max(100).describe('短边长度（米）'),
  openings: z.array(z.enum(OPENINGS)).max(4).optional().describe('开口的边'),
  facing: z.string().max(80).optional().describe('主视觉朝向'),
  zones: z
    .array(
      z.object({
        id: z.string().max(40).optional().describe('稳定对象 ID，如 A1/B2，用于文本方案与图形互相指代'),
        name: z.string().min(1).max(40).describe('区名'),
        type: z.enum(ZONE_TYPES).optional().describe('类型（决定配色与专业图例）'),
        shape: z.enum(SHAPES).optional().describe('图形：rect/l/circle/capsule/line'),
        x: z.number().describe('左上角 X（米）'),
        y: z.number().describe('左上角 Y（米）'),
        w: z.number().positive().describe('宽（米，沿长边）'),
        h: z.number().positive().describe('进深（米，沿短边）'),
        height: z.number().nonnegative().max(12).optional().describe('高度（米），用于墙体/屏幕/立牌/家具等'),
        facing: z.enum(FACINGS).optional().describe('朝向：front/back/left/right/center'),
        material: z.string().max(60).optional().describe('材质/表面处理'),
        description: z.string().max(160).optional().describe('对象说明，给文本方案与生图 prompt 使用'),
        layer: z.enum(LAYERS).optional().describe('层级：space=空间块，object=实体对象，detail=细节/家具'),
        parentId: z.string().max(40).optional().describe('所属父模块 ID，用于模块内部布局'),
        note: z.string().max(40).optional().describe('备注，如 "12㎡"'),
      }),
    )
    .min(1)
    .max(80)
    .describe('所有功能区（精确位置+尺寸，米制）'),
});

export function normalizeBoothLayout(layout: BoothLayout): BoothLayout {
  const length = clamp(layout.length, 1, 100);
  const width = clamp(layout.width, 1, 100);
  const openings = Array.from(new Set((layout.openings ?? []).filter((x): x is LayoutOpening => OPENINGS.includes(x as LayoutOpening))));
  const zones = layout.zones.slice(0, 80).map((z, idx) => {
    const w = clamp(z.w, 0.2, length);
    const h = clamp(z.h, 0.2, width);
    return {
      ...(z.id ? { id: short(z.id, 40) } : { id: `O${idx + 1}` }),
      name: short(z.name, 40) || '功能区',
      type: z.type,
      ...(z.shape ? { shape: z.shape } : {}),
      x: clamp(z.x, 0, Math.max(0, length - w)),
      y: clamp(z.y, 0, Math.max(0, width - h)),
      w,
      h,
      ...(z.height != null ? { height: clamp(z.height, 0, 12) } : {}),
      ...(z.facing ? { facing: z.facing } : {}),
      ...(z.material ? { material: short(z.material, 60) } : {}),
      ...(z.description ? { description: short(z.description, 160) } : {}),
      ...(z.layer ? { layer: z.layer } : {}),
      ...(z.parentId ? { parentId: short(z.parentId, 40) } : {}),
      ...(z.note ? { note: short(z.note, 40) } : {}),
    };
  });
  return {
    length,
    width,
    ...(openings.length ? { openings } : {}),
    ...(layout.facing ? { facing: short(layout.facing, 80) } : {}),
    zones: zones.length ? zones : [{ name: '主展示区', type: 'brand', x: 0, y: 0, w: length, h: width }],
  };
}
