import { tool } from 'ai';
import { z } from 'zod';

export const taskComplete = tool({
  description:
    '显式声明本轮任务完成，结束循环。在已交付合格结果、或诚实判断做不到（给出建议）时调用。summary 是给用户看的简短中文收尾。',
  inputSchema: z.object({
    summary: z.string().describe('给用户的简短中文收尾：交付了什么 / 或为何做不到 + 建议调整方向'),
    delivered: z.array(z.string()).default([]).describe('交付的资产 id 列表'),
    gaps: z.array(z.string()).default([]).describe('仍存在的缺口或待用户拍板项（如有）'),
  }),
  execute: async ({ summary, delivered, gaps }) => {
    return { done: true, summary, delivered, gaps };
  },
});
