import { tool } from 'ai';
import { z } from 'zod';
import { boothLayoutSchema, normalizeBoothLayout } from '@/lib/layout';
import { checkBoothLayout, failMessages, hasBlocker } from '@/lib/booth-rules';
import { projectIdFromContext, saveLayoutProposal } from '@/lib/storage';

// 方案定稿(update_spec)后,大脑调它把俯视布局推给前端 → 用户明确打开布局编辑器(用此 layout 初始化),
// 拖好确认 → 截图存 reference → render(planAssetId) 出图;或"按原方案直接出" → render(中文意图)。
// 非阻塞透传:execute 纯透传,前端据此显示布局确认入口。
export const presentLayout = tool({
  description:
    '**方案写好(update_spec)后调用**:把专业对象级俯视布局推给前端,前端会显示“打开编辑器 / 按原方案出图”的确认入口，用户明确点击后再进入布局编辑器。layout 不要只给几个抽象大方块；必须包含真实展台对象：背墙/LED/接待台/展柜/体验台/洽谈室/储物/立牌/Truss柱/通道留白等。每个对象给稳定 id、type、shape、x/y/w/h、height、facing、material、description；文本方案要能用这些 id 指代。用户随后会发来"已用布局编辑器定稿平面图(参考资产 xxx)" → 你 render(planAssetId);或发"按原方案直接出图" → 你直接 render(给中文意图)。',
  inputSchema: z.object({
    intro: z.string().optional().describe('一句话:请用户精调这个布局(可选)'),
    layout: boothLayoutSchema.describe('俯视布局结构化数据，前端 FloorPlan / LayoutEditor 据此渲染与初始化'),
  }),
  execute: async (input, opts) => {
    const pid = projectIdFromContext((opts as { experimental_context?: unknown }).experimental_context);
    const layout = normalizeBoothLayout(input.layout);
    // 规则校验（纯函数）：blocker 打回让大脑重做布局；fail/warning 不阻断，随透传给前端/大脑。
    const ruleIssues = checkBoothLayout(layout);
    if (hasBlocker(ruleIssues)) {
      return { error: `布局存在硬性问题，请修正后重新 present_layout：${failMessages(ruleIssues).join('；')}`, code: 'LAYOUT_RULE_BLOCKER', issues: ruleIssues };
    }
    await saveLayoutProposal(pid, layout);
    return { ...input, layout, ruleIssues, _kind: 'layout' as const };
  },
});
