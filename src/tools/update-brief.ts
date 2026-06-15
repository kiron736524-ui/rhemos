import { tool } from 'ai';
import { z } from 'zod';
import { mergeBrief, projectIdFromContext } from '@/lib/storage';

export const updateBrief = tool({
  description:
    '把"已和用户确认的事实"增量写入项目记忆 brief —— 澄清/拍板后立刻调（别拖到 update_spec）。brief 是跨轮业务记忆：面积、墙高/层高、行业、品牌、预算档、必含功能区、硬约束、已锁定的设计取向等。增量合并、多次调用累积，不必一次写全。这样下一轮 read_project_state 能读到，避免重复追问、保持上下文。',
  inputSchema: z.object({
    facts: z
      .record(z.string(), z.unknown())
      .describe(
        '要并入 brief 的已确认事实键值（键用中文短语、值简洁）。例：{"面积":"12×15m（180㎡）","墙高":"约4m","行业":"能源/石油石化","品牌":"中国石化","开口":"双面开口（主通道+侧通道）","必含":["接待","洽谈室","产品展示","影音区"],"取向":"稳重科技、企业蓝为主"}',
      ),
  }),
  execute: async ({ facts }, opts) => {
    const pid = projectIdFromContext((opts as { experimental_context?: unknown }).experimental_context);
    await mergeBrief(pid, facts);
    return { saved: true, keys: Object.keys(facts) };
  },
});
