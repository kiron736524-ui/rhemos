import { tool } from 'ai';
import { z } from 'zod';
import { projectIdFromContext, readState } from '@/lib/storage';

export const readProjectState = tool({
  description:
    '读取当前 project 状态：已确认的 brief、DesignSpec、已生成资产清单（含各资产的 prompt / lineage / 历次判图）。用于 gap 分析、避免重复生成、保持记忆。',
  // 注意：不能用空 z.object({})——模型空参调用会把 tool_use.input 序列化成 ""，
  // 多轮回传历史时 Anthropic 报 "Input should be a valid dictionary" 而 400。加一个可选字段规避。
  inputSchema: z.object({ note: z.string().optional().describe('可留空') }),
  execute: async (_args, opts) => {
    const pid = projectIdFromContext((opts as { experimental_context?: unknown }).experimental_context);
    const s = await readState(pid);
    return {
      projectId: pid,
      brief: s.brief,
      spec: s.spec ?? null,
      assets: s.assets.map((a) => ({
        id: a.id,
        kind: a.kind,
        prompt: a.prompt,
        url: a.url,
        parentId: a.parentId,
        inspections: a.inspections,
      })),
    };
  },
});
