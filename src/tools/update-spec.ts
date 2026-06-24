import { tool } from 'ai';
import { z } from 'zod';
import { projectIdFromContext, readState, setSpec } from '@/lib/storage';
import type { DesignSpec } from '@/lib/types';

const rectangleBoundaryRule = (length?: number, width?: number) =>
  [
    `Booth outer footprint shape is a STRICT RECTANGLE${length && width ? `, exactly ${length}m x ${width}m` : ''}.`,
    'The raised platform, carpet/floor finish edge, truss perimeter, back wall line, and booth boundary must be one unbroken rectilinear outline with four 90-degree corners.',
    'Do NOT create a hexagonal, octagonal, chamfered, diagonal-cut, curved, notched, stepped, bitten-out, protruding, warped, or polygonal outer perimeter.',
    'No random add-on floor islands, no corner bulges, no decorative cutouts in the booth footprint, and no facade piece may extend outside the rectangle unless the user explicitly requested that irregular shape.',
    'Any circular route, round table, ring light, ring screen, curved LED strip, product plinth, totem, standee, or decorative feature is an interior design element only, never the booth outline.',
  ].join(' ');

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
    footprint: z
      .object({
        shape: z.enum(['rectangle', 'l-shape', 'custom']).default('rectangle'),
        dimensions: z.object({ length: z.number().optional(), width: z.number().optional() }).optional(),
        source: z.enum(['user', 'default']).default('default'),
        boundaryRule: z.string().optional(),
        allowChamfer: z.boolean().default(false),
        allowCurvedPerimeter: z.boolean().default(false),
      })
      .optional()
      .describe('展台外轮廓形状。用户未明确异形时必须用 rectangle；环形动线/吊挂不等于异形外轮廓。'),
  }),
  execute: async ({ narrative, identity, invariants, selfCheckCriteria, footprint }, opts) => {
    const pid = projectIdFromContext((opts as { experimental_context?: unknown }).experimental_context);
    const s = await readState(pid);
    const length = footprint?.dimensions?.length ?? s.layout?.proposal?.length ?? s.brief.space?.length;
    const width = footprint?.dimensions?.width ?? s.layout?.proposal?.width ?? s.brief.space?.width;
    const normalizedFootprint: NonNullable<DesignSpec['footprint']> = {
      shape: footprint?.shape ?? 'rectangle',
      dimensions: { length, width },
      source: footprint?.source ?? (length && width ? 'user' : 'default'),
      boundaryRule: footprint?.boundaryRule ?? rectangleBoundaryRule(length, width),
      allowChamfer: footprint?.allowChamfer ?? false,
      allowCurvedPerimeter: footprint?.allowCurvedPerimeter ?? false,
    };
    const boundary = `FOOTPRINT BOUNDARY HARD RULE: ${normalizedFootprint.boundaryRule}`;
    const nextIdentity = identity.includes('FOOTPRINT BOUNDARY HARD RULE') ? identity : `${identity}\n\n${boundary}`;
    const nextCriteria = selfCheckCriteria.includes('外轮廓') ? selfCheckCriteria : `${selfCheckCriteria}\n外轮廓硬规则：${normalizedFootprint.boundaryRule}`;
    await setSpec(pid, { narrative, identity: nextIdentity, footprint: normalizedFootprint, invariants: [...invariants, normalizedFootprint.boundaryRule], selfCheckCriteria: nextCriteria, updatedAt: new Date().toISOString() });
    return { saved: true };
  },
});
