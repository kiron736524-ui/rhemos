import { tool } from 'ai';
import { z } from 'zod';
import { projectIdFromContext, setSpec } from '@/lib/storage';

export const updateSpec = tool({
  description:
    '把你写好的 DesignSpec 存入项目状态（生图前先写）。一物三用：narrative 给用户看的中文方案；invariants 跨视图不可变量；selfCheckCriteria 供判图的客观要点（生图自检"输出 vs spec"据此）。',
  inputSchema: z.object({
    narrative: z.string().describe('给用户看的中文方案：空间骨架/分区/材质灯光/品牌占位'),
    invariants: z.array(z.string()).default([]).describe('跨视图不可变量（尺寸/开口/墙位/品牌位置/材质色温等）'),
    selfCheckCriteria: z.string().describe('客观判图要点：本图应满足的结构/物理/空间/品牌落位要点'),
  }),
  execute: async ({ narrative, invariants, selfCheckCriteria }, opts) => {
    const pid = projectIdFromContext((opts as { experimental_context?: unknown }).experimental_context);
    await setSpec(pid, { narrative, invariants, selfCheckCriteria, updatedAt: new Date().toISOString() });
    return { saved: true };
  },
});
