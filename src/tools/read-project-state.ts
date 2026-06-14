import { tool } from 'ai';
import { z } from 'zod';
import { DEFAULT_PROJECT, readState } from '@/lib/storage';

export const readProjectState = tool({
  description:
    '读取当前 project 状态：已确认的 brief、已生成资产清单（含各资产的 prompt 与历次自检）。用于 gap 分析、避免重复生成。',
  inputSchema: z.object({}),
  execute: async () => {
    const s = await readState(DEFAULT_PROJECT);
    return {
      brief: s.brief,
      assets: s.assets.map((a) => ({
        id: a.id,
        kind: a.kind,
        prompt: a.prompt,
        url: a.url,
        inspections: a.inspections,
      })),
    };
  },
});
