import { tool } from 'ai';
import { z } from 'zod';
import { boothLayoutSchema, normalizeBoothLayout } from '@/lib/layout';

// 结构化卡片提问（替代纯文字问答）。大脑调用它，前端渲染成可点击卡片，用户点选后零打字回传。
// 每个选项可带一张 SVG 俯视布局草图，让用户看着结构选。非阻塞：execute 纯透传，前端据此渲染。
export const presentChoices = tool({
  description:
    '结构化卡片提问（**所有需要用户拍板的澄清都走这个，不要输出纯文字问题**）：把问题做成可点击卡片让用户选，零打字。每个布局相关选项**应带结构化 layout 数据**（轮廓 + 功能区位置/尺寸/类型），前端自动渲染成精致俯视平面图，让用户看着结构选。先在 locked 里列已锁定的（让用户安心），再问最多 3 个真正改骨架的硬核问题，每题给 recommended 下标。用户点选后会把选择作为新消息发回，你据此继续。',
  inputSchema: z.object({
    intro: z.string().optional().describe('一句话背景/开场（可选）'),
    locked: z.array(z.string()).optional().describe('已锁定、不再问的要点（让用户安心，体现"信息密度克制"）'),
    questions: z
      .array(
        z.object({
          key: z.string().describe('字段标识，如 led_position'),
          question: z.string().describe('问题：具体、说清为什么问/代价'),
          recommended: z.number().int().min(0).optional().describe('推荐选项下标（0 起），前端高亮 + 支持"按推荐来"一键'),
          options: z
            .array(
              z.object({
                label: z.string().describe('选项简短标题'),
                detail: z.string().optional().describe('选项说明 + designImpact（选了会怎样）'),
                layout: boothLayoutSchema
                  .optional()
                  .describe('结构化俯视布局数据，前端 FloorPlan 渲染器自动画成精致平面图（真实比例+尺寸标注+网格+配色）。布局类选项一律用它，绝不输出原始 SVG/HTML。'),
              }),
            )
            .min(2)
            .describe('2-4 个互斥选项'),
        }),
      )
      .min(1)
      .max(3)
      .describe('最多 3 个硬核问题'),
  }),
  // 非阻塞透传：前端检测此工具输出 → 渲染卡片；用户点选 → sendMessage 回传选择。
  execute: async (input) => ({
    ...input,
    questions: input.questions.map((q) => ({
      ...q,
      options: q.options.map((o) => (o.layout ? { ...o, layout: normalizeBoothLayout(o.layout) } : o)),
    })),
    _kind: 'choices' as const,
  }),
});
