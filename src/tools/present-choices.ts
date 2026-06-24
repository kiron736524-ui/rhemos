import { tool } from 'ai';
import { z } from 'zod';
import { boothLayoutSchema, normalizeBoothLayout } from '@/lib/layout';
import { checkBoothLayout } from '@/lib/booth-rules';
import type { BoothLayout, LayoutOpening } from '@/lib/types';

// 结构化卡片提问（替代纯文字问答）。大脑调用它，前端渲染成可点击卡片，用户点选后零打字回传。
// 每个布局选项可带结构化 BoothLayout，前端自动渲染俯视草图。非阻塞：execute 纯透传，前端据此渲染。

const EDGES: LayoutOpening[] = ['front', 'back', 'left', 'right'];
const closedEdges = (layout: BoothLayout): LayoutOpening[] => {
  const open = new Set(layout.openings ?? []);
  return EDGES.filter((e) => !open.has(e));
};
const edgeLength = (layout: BoothLayout, edge: LayoutOpening): number => (edge === 'front' || edge === 'back' ? layout.length : layout.width);
const edgeNameZh = (edge: LayoutOpening): string => ({ front: 'front/前边', back: 'back/后边', left: 'left/左边', right: 'right/右边' })[edge];

function layoutLabelIssues(label: string, detail: string | undefined, layout: BoothLayout) {
  const text = `${label} ${detail ?? ''} ${layout.facing ?? ''} ${layout.zones.map((z) => `${z.name} ${z.note ?? ''}`).join(' ')}`;
  if (!/(封闭|背墙|主墙|closed|back wall|main wall)/i.test(text)) return [];
  const closed = closedEdges(layout);
  if (closed.length !== 1) return [];
  const closedLen = edgeLength(layout, closed[0]);
  const min = Math.min(layout.length, layout.width);
  const max = Math.max(layout.length, layout.width);
  const saysShort = /短边|short side|12m|12\s*米/i.test(text);
  const saysLong = /长边|long side|15m|15\s*米/i.test(text);
  const issues: string[] = [];
  if (saysShort && Math.abs(closedLen - max) < 0.01 && max !== min) {
    issues.push(`选项文字说封闭短边/约${min}m，但 layout 实际关闭的是 ${edgeNameZh(closed[0])}，长度为 ${closedLen}m（长边）。`);
  }
  if (saysLong && Math.abs(closedLen - min) < 0.01 && max !== min) {
    issues.push(`选项文字说封闭长边/约${max}m，但 layout 实际关闭的是 ${edgeNameZh(closed[0])}，长度为 ${closedLen}m（短边）。`);
  }
  return issues;
}

export const presentChoices = tool({
  description:
    '结构化卡片提问（**所有需要用户拍板的澄清都走这个，不要输出纯文字问题**）：一次只问 1 个会改骨架的问题。用户点选后，你必须 read_project_state/结合该选择重新思考，再生成下一个问题或布局。每个布局相关选项**应带结构化 layout 数据**（轮廓 + 功能区位置/尺寸/类型），前端自动渲染成精致俯视平面图，让用户看着结构选。先在 locked 里列已锁定的（让用户安心），再问当前最关键的 1 个硬核问题，并给 recommended 下标。绝不要把相互依赖的 2-3 个布局问题并列抛出。',
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
      .max(1)
      .describe('只能问 1 个硬核问题；依赖后续布局的问题等用户回答后重新推导'),
  }),
  // 非阻塞透传：前端检测此工具输出 → 渲染卡片；用户点选 → sendMessage 回传选择。
  execute: async (input) => {
    const questions = input.questions.map((q) => ({
      ...q,
      options: q.options.map((o) => {
        if (!o.layout) return o;
        const layout = normalizeBoothLayout(o.layout);
        const ruleIssues = checkBoothLayout(layout);
        const labelIssues = layoutLabelIssues(o.label, o.detail, layout).map((message) => ({
          severity: 'fail' as const,
          code: 'LAYOUT_LABEL_MISMATCH',
          message,
          suggestedFix: '修正 label/detail 或 openings，让文字语义与结构化 layout 一致。',
        }));
        return { ...o, layout, issues: [...labelIssues, ...ruleIssues] };
      }),
    }));
    const blocking: string[] = [];
    for (const q of questions) {
      for (const o of q.options) {
        if (!('issues' in o) || !Array.isArray(o.issues)) continue;
        for (const issue of o.issues as { code?: string; message: string }[]) {
          if (issue.code === 'LAYOUT_LABEL_MISMATCH') blocking.push(`${q.key}/${o.label}: ${issue.message}`);
        }
      }
    }
    if (blocking.length) {
      return {
        error: `选择卡片的文字语义与平面图结构冲突，请修正后重新调用 present_choices：${blocking.join('；')}`,
        code: 'CHOICE_LAYOUT_CONFLICT',
        issues: blocking,
      };
    }
    return { ...input, questions, _kind: 'choices' as const };
  },
});
