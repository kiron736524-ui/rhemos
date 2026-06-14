import { generateText, tool } from 'ai';
import { z } from 'zod';
import { brain } from '@/models/gateway';

export const analyzeReference = tool({
  description:
    '看用户提供的参考图，抽取可迁移到展台设计的特征（空间结构/材质/灯光/色彩/主次/品牌表达），转译为设计策略而非机械复制。输入图片 URL（绝对地址）。',
  inputSchema: z.object({
    imageUrl: z.string().describe('参考图 URL（绝对地址）'),
    focus: z.string().optional().describe('关注点，如 风格 / 结构 / 品牌落位'),
  }),
  execute: async ({ imageUrl, focus }) => {
    const r = await generateText({
      model: brain(),
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: `分析这张参考图，抽取可迁移到展台设计的特征：空间骨架、材质与表面、灯光策略、色彩主辅、视觉主次、品牌表达。${
                focus ? `重点关注：${focus}。` : ''
              } 不要机械复制画面，转译成可执行的设计策略；并指出哪些不适合照搬。`,
            },
            { type: 'image', image: new URL(imageUrl) },
          ],
        },
      ],
    });
    return { analysis: r.text };
  },
});
