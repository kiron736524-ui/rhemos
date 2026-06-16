import { tool } from 'ai';
import { z } from 'zod';
import { projectIdFromContext, readState } from '@/lib/storage';

export const readProjectState = tool({
  description:
    '读取当前 project 状态：brief、DesignSpec、已生成资产**摘要**（id / 类型 / lineage / 最近一次判图）。用于 gap 分析、避免重复、保持跨轮记忆。',
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
      layout: s.layout ?? null,
      assetCount: s.assets.length,
      attachmentCount: s.attachments?.length ?? 0,
      recentRuns: (s.runs ?? []).slice(0, 5),
      // 瘦身（D26）：不回传长 prompt 与全部判图史，只给最近一次判图摘要，抗大脑上下文膨胀。
      assets: s.assets.map((a) => {
        const last = a.inspections?.[a.inspections.length - 1];
        return {
          id: a.id,
          kind: a.kind,
          url: a.url,
          parentId: a.parentId,
          lastCheck: last ? { score: last.score, pass: last.pass, summary: last.summary } : undefined,
        };
      }),
    };
  },
});
