import { tool } from 'ai';
import { z } from 'zod';
import { projectIdFromContext, setSpec } from '@/lib/storage';

export const updateSpec = tool({
  description:
    '把你写好的 DesignSpec 存入项目状态（生图前先写）。一物多用：narrative 给用户看的中文方案；identity 身份锁定串（基础信息 schema，所有生图据此保持一致）；invariants 跨视图不可变量；selfCheckCriteria 供判图的客观要点。',
  inputSchema: z.object({
    narrative: z.string().describe('给用户看的中文方案：空间骨架/分区/材质灯光/品牌占位'),
    identity: z
      .string()
      .describe(
        '身份锁定串（英文，基础信息 schema）：一段精确锁定该展台"DNA"的描述——footprint 尺寸 + 开口方式 + 各功能区位置关系 + 关键部件清单(务必含数量，如 "exactly ONE round table with 4 white armchairs") + 形状 + 材质 + 配色(具体，如 technology blue #1E6FE0) + 品牌占位。所有视角、所有次生图都会强制前置它，是跨视图与跨次一致性的锚。',
      ),
    invariants: z.array(z.string()).default([]).describe('跨视图不可变量（尺寸/开口/墙位/品牌位置/材质色温等）'),
    selfCheckCriteria: z.string().describe('客观判图要点：本图应满足的结构/物理/空间/品牌落位要点'),
  }),
  execute: async ({ narrative, identity, invariants, selfCheckCriteria }, opts) => {
    const pid = projectIdFromContext((opts as { experimental_context?: unknown }).experimental_context);
    await setSpec(pid, { narrative, identity, invariants, selfCheckCriteria, updatedAt: new Date().toISOString() });
    return { saved: true };
  },
});
