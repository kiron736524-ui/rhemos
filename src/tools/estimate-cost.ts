import { generateText, tool } from 'ai';
import { gateway } from '@ai-sdk/gateway';
import { z } from 'zod';
import { MODEL_IDS } from '@/models/gateway';
import { estimateRunsCost } from '@/lib/cost-estimate';
import { appendRunEvent, listProjects, listRunRecords, projectIdFromContext, runIdFromContext } from '@/lib/storage';

export const estimateCost = tool({
  description:
    '低成本成本估算/解释工具。读取 run usage，估算文本模型花费，并用 DeepSeek V4 Flash 生成简短解释。用于回答“余额为什么掉这么快/哪部分最贵/怎么降本”。',
  inputSchema: z.object({
    scope: z.enum(['current_project', 'all_projects']).default('current_project'),
    limit: z.number().int().min(1).max(200).default(80),
  }),
  execute: async ({ scope, limit }, opts) => {
    const ctx = (opts as { experimental_context?: unknown }).experimental_context;
    const pid = projectIdFromContext(ctx);
    const runId = runIdFromContext(ctx);
    const projects = scope === 'all_projects' ? await listProjects() : [{ id: pid }];
    const runs = (await Promise.all(projects.map((p) => listRunRecords(p.id, limit)))).flat();
    const estimate = estimateRunsCost(runs);
    const prompt = `请用中文简洁解释这份 Rhemos 成本估算，指出最可能的烧钱来源和降本建议。不要编造未给出的价格。JSON:\n${JSON.stringify(estimate).slice(0, 12000)}`;
    const model = MODEL_IDS.costEstimator;
    const r = await generateText({
      model: gateway.languageModel(model),
      prompt,
    });
    await appendRunEvent(pid, runId, {
      type: 'tool',
      toolName: 'estimate_cost',
      outputSummary: {
        model,
        scope,
        runs: runs.length,
        usage: (r as { totalUsage?: unknown; usage?: unknown }).totalUsage ?? (r as { usage?: unknown }).usage,
      },
    });
    return { estimate, explanation: r.text.trim(), model };
  },
});
