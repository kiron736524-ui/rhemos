import { tool } from 'ai';
import { z } from 'zod';

// 方案定稿(update_spec)后,大脑调它把俯视布局推给前端 → 前端**自动弹出布局编辑器**(用此 layout 初始化),
// 用户拖好确认 → 截图存 reference → render(planAssetId) 出图;或"按原方案直接出" → render(中文意图)。
// 非阻塞透传:execute 纯透传,前端据此弹编辑器。
export const presentLayout = tool({
  description:
    '**方案写好(update_spec)后调用**:把方案的俯视布局推给前端,前端会自动弹出布局编辑器让用户拖拽精调(位置/尺寸/L 形)。layout 填结构化布局(轮廓 + 各功能区位置/尺寸/类型,米制),前端据此初始化编辑器。用户随后会发来"已用布局编辑器定稿平面图(参考资产 xxx)" → 你 render(planAssetId);或发"按原方案直接出图" → 你直接 render(给中文意图)。',
  inputSchema: z.object({
    intro: z.string().optional().describe('一句话:请用户精调这个布局(可选)'),
    layout: z
      .object({
        length: z.number().describe('长边长度（米）'),
        width: z.number().describe('短边长度（米）'),
        openings: z.array(z.enum(['front', 'back', 'left', 'right'])).optional().describe('开口的边'),
        facing: z.string().optional().describe('主视觉朝向'),
        zones: z
          .array(
            z.object({
              name: z.string().describe('区名'),
              type: z
                .enum(['led', 'stage', 'brand', 'reception', 'meeting', 'storage', 'product', 'plant', 'aisle'])
                .optional()
                .describe('类型（决定配色）'),
              x: z.number().describe('左上角 X（米）'),
              y: z.number().describe('左上角 Y（米）'),
              w: z.number().describe('宽（米，沿长边）'),
              h: z.number().describe('进深（米，沿短边）'),
              note: z.string().optional().describe('备注，如 "12㎡"'),
            }),
          )
          .min(1)
          .describe('所有功能区（精确位置+尺寸，米制）'),
      })
      .describe('俯视布局结构化数据，前端 FloorPlan / LayoutEditor 据此渲染与初始化'),
  }),
  execute: async (input) => ({ ...input, _kind: 'layout' as const }),
});
