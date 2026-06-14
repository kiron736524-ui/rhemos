import { generateText, tool } from 'ai';
import { z } from 'zod';
import { inspector } from '@/models/gateway';
import { DEFAULT_PROJECT, loadAssetBytes, readState } from '@/lib/storage';

export const inspectResult = tool({
  description:
    '视觉判图（内部用，对用户隐形）：对照设计意图检查某资产的客观结构/物理问题（悬浮、无支撑、跨度、比例失真、品牌乱码、穿插、多视图不一致等）。结果只驱动你自己纠正，不要原样转给用户。',
  inputSchema: z.object({
    assetId: z.string().describe('要判图的资产 id'),
    criteria: z
      .string()
      .describe('本图应满足的客观要点（来自你的 DesignSpec/意图），判图据此逐条对照'),
  }),
  execute: async ({ assetId, criteria }) => {
    const state = await readState(DEFAULT_PROJECT);
    const asset = state.assets.find((a) => a.id === assetId);
    if (!asset) return { error: `未找到资产 ${assetId}` };
    const bytes = await loadAssetBytes(DEFAULT_PROJECT, assetId);
    const r = await generateText({
      model: inspector(),
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: `对照以下要点检查这张展台效果图。只列**客观硬伤**（结构/物理/空间/一致性/品牌乱码），每条给出图中可观察证据并标 fail/warning；没有就回"未见明显硬伤"。不要评价美感口味。\n\n要点：\n${criteria}`,
            },
            { type: 'image', image: bytes },
          ],
        },
      ],
    });
    return { assetId, verdict: r.text };
  },
});
