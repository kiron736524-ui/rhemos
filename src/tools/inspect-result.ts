import { tool } from 'ai';
import { z } from 'zod';
import { DEFAULT_PROJECT, loadAssetBytes, readState } from '@/lib/storage';
import { inspectImage } from '@/agent/inspect';

export const inspectResult = tool({
  description:
    '视觉判图（内部用，对用户隐形）：对照客观要点检查某资产，返回 score/fails/summary。用于临时核对或 revise 后复检（generate_best_of_n 已内置判图，无需重复）。结果只驱动你自己纠正，不要原样转给用户。',
  inputSchema: z.object({
    assetId: z.string().describe('要判图的资产 id'),
    criteria: z.string().describe('客观判图要点（来自 DesignSpec.selfCheckCriteria / 意图）'),
  }),
  execute: async ({ assetId, criteria }) => {
    const state = await readState(DEFAULT_PROJECT);
    if (!state.assets.find((a) => a.id === assetId)) return { error: `未找到资产 ${assetId}` };
    const bytes = await loadAssetBytes(DEFAULT_PROJECT, assetId);
    const insp = await inspectImage(bytes, criteria);
    return { assetId, ...insp };
  },
});
