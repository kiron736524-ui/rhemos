import { hasToolCall, stepCountIs, type StopCondition } from 'ai';
import { gateway } from '@ai-sdk/gateway';
import { MODEL_IDS } from '@/models/gateway';
import { buildSystemPrompt } from './system-prompt';
import { analyzeReference } from '@/tools/analyze-reference';
import { generateBoothImage } from '@/tools/generate-booth-image';
import { inspectResult } from '@/tools/inspect-result';
import { readProjectState } from '@/tools/read-project-state';
import { taskComplete } from '@/tools/task-complete';

// 工具注册表（名字即大脑看到的工具名）
export const tools = {
  read_project_state: readProjectState,
  analyze_reference: analyzeReference,
  generate_booth_image: generateBoothImage,
  inspect_result: inspectResult,
  task_complete: taskComplete,
};

/**
 * Orchestrator（单脑 = Opus 4.8）。
 * 模型分档天然成立：主脑恒为 Opus，inspect_result 工具内部用 Sonnet 4.6（便宜视觉判图），
 * 故 Phase 1 不需 prepareStep 切模型。
 * 退出：大脑自己调 task_complete（hasToolCall）；stepCountIs(40) 仅防失控硬上限。
 */
// Phase 1 兜底预算：最多 2 次生图就停，防止无预算时反复重生跑飞。Phase 2 换成完整重试预算。
function maxImageGenerations(n: number): StopCondition<typeof tools> {
  return ({ steps }) => {
    let gens = 0;
    for (const s of steps) {
      for (const c of s.toolCalls ?? []) {
        if (c.toolName === 'generate_booth_image') gens++;
      }
    }
    return gens >= n;
  };
}

export async function orchestratorConfig() {
  return {
    model: gateway.languageModel(MODEL_IDS.brain),
    system: await buildSystemPrompt(),
    tools,
    // 正常退出：大脑自己 task_complete。兜底：≤2 次生图、≤10 步（防失控）。
    stopWhen: [hasToolCall('task_complete'), maxImageGenerations(2), stepCountIs(10)],
  };
}
