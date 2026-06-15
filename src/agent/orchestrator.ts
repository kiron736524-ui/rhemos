import { hasToolCall, stepCountIs, type StopCondition } from 'ai';
import { gateway } from '@ai-sdk/gateway';
import { MODEL_IDS } from '@/models/gateway';
import { buildSystemPrompt } from './system-prompt';
import { analyzeReference } from '@/tools/analyze-reference';
import { generateBestOfN } from '@/tools/generate-best-of-n';
import { inspectResult } from '@/tools/inspect-result';
import { readProjectState } from '@/tools/read-project-state';
import { reviseAsset } from '@/tools/revise-asset';
import { taskComplete } from '@/tools/task-complete';
import { updateSpec } from '@/tools/update-spec';
import { renderMultiviewSheet } from '@/tools/render-multiview-sheet';

// 工具注册表（名字即大脑看到的工具名）
export const tools = {
  read_project_state: readProjectState,
  analyze_reference: analyzeReference,
  update_spec: updateSpec,
  generate_best_of_n: generateBestOfN,
  render_multiview_sheet: renderMultiviewSheet,
  inspect_result: inspectResult,
  revise_asset: reviseAsset,
  task_complete: taskComplete,
};

// 正式生图预算：统计 generate_best_of_n 的 n + revise_asset 次数，超额即停（防失控）。
function imageBudget(maxImages: number): StopCondition<typeof tools> {
  return ({ steps }) => {
    let imgs = 0;
    for (const s of steps) {
      for (const c of s.toolCalls ?? []) {
        if (c.toolName === 'generate_best_of_n' || c.toolName === 'render_multiview_sheet') {
          imgs += (c as { input?: { n?: number } }).input?.n ?? 1;
        } else if (c.toolName === 'revise_asset') {
          imgs += 1;
        }
      }
    }
    return imgs >= maxImages;
  };
}

/**
 * Orchestrator（单脑 = Opus 4.8）。inspect 在工具内部用 Sonnet 4.6（天然分档）。
 * 退出：大脑自己 task_complete。兜底：总生图 ≤5、步数 ≤16。
 */
export async function orchestratorConfig() {
  return {
    model: gateway.languageModel(MODEL_IDS.brain),
    system: await buildSystemPrompt(),
    tools,
    stopWhen: [hasToolCall('task_complete'), imageBudget(5), stepCountIs(16)],
  };
}
