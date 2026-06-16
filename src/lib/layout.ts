import { z } from 'zod';
import type { BoothLayout, LayoutOpening } from './types';

const OPENINGS: LayoutOpening[] = ['front', 'back', 'left', 'right'];

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
        name: z.string().min(1).max(40).describe('区名'),
        type: z.enum(['led', 'stage', 'brand', 'reception', 'meeting', 'storage', 'product', 'plant', 'aisle']).optional().describe('类型（决定配色）'),
        x: z.number().describe('左上角 X（米）'),
        y: z.number().describe('左上角 Y（米）'),
        w: z.number().positive().describe('宽（米，沿长边）'),
        h: z.number().positive().describe('进深（米，沿短边）'),
        note: z.string().max(40).optional().describe('备注，如 "12㎡"'),
      }),
    )
    .min(1)
    .max(40)
    .describe('所有功能区（精确位置+尺寸，米制）'),
});

export function normalizeBoothLayout(layout: BoothLayout): BoothLayout {
  const length = clamp(layout.length, 1, 100);
  const width = clamp(layout.width, 1, 100);
  const openings = Array.from(new Set((layout.openings ?? []).filter((x): x is LayoutOpening => OPENINGS.includes(x as LayoutOpening))));
  const zones = layout.zones.slice(0, 40).map((z) => {
    const w = clamp(z.w, 0.2, length);
    const h = clamp(z.h, 0.2, width);
    return {
      name: short(z.name, 40) || '功能区',
      type: z.type,
      x: clamp(z.x, 0, Math.max(0, length - w)),
      y: clamp(z.y, 0, Math.max(0, width - h)),
      w,
      h,
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
