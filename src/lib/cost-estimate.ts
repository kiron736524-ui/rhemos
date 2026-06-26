import type { RunRecord } from './types';

type Usage = { inputTokens?: number; outputTokens?: number; totalTokens?: number };

export interface CostLine {
  model: string;
  source: string;
  inputTokens: number;
  outputTokens: number;
  estimatedUsd: number | null;
}

export interface CostEstimate {
  runs: number;
  inputTokens: number;
  outputTokens: number;
  estimatedUsd: number;
  unknownUsd: boolean;
  byModel: CostLine[];
  notes: string[];
}

const PRICE_PER_M = new Map<string, { input: number; output: number }>([
  ['anthropic/claude-opus-4.8', { input: 5, output: 25 }],
  ['anthropic/claude-sonnet-4.6', { input: 3, output: 15 }],
  ['anthropic/claude-haiku-4.5', { input: 1, output: 5 }],
  // DeepSeek 在这里主要用于便宜解释层；不同网关/账号价格可能变化，未知时不把它计入硬估价。
]);

function usageOf(value: unknown): Usage {
  if (!value || typeof value !== 'object') return {};
  const u = value as Record<string, unknown>;
  return {
    inputTokens: Number(u.inputTokens ?? u.promptTokens ?? 0) || 0,
    outputTokens: Number(u.outputTokens ?? u.completionTokens ?? 0) || 0,
    totalTokens: Number(u.totalTokens ?? u.total ?? 0) || 0,
  };
}

function price(model: string, input: number, output: number): number | null {
  const p = PRICE_PER_M.get(model);
  if (!p) return null;
  return (input / 1_000_000) * p.input + (output / 1_000_000) * p.output;
}

function addLine(lines: CostLine[], model: string, source: string, usage: Usage) {
  const inputTokens = usage.inputTokens ?? 0;
  const outputTokens = usage.outputTokens ?? 0;
  if (!inputTokens && !outputTokens) return;
  const estimatedUsd = price(model, inputTokens, outputTokens);
  lines.push({ model, source, inputTokens, outputTokens, estimatedUsd });
}

function firstStepModel(run: RunRecord): string {
  for (const e of run.events) {
    if (e.type !== 'step') continue;
    const out = e.outputSummary as { model?: unknown } | undefined;
    if (typeof out?.model === 'string') return out.model;
  }
  return 'unknown';
}

export function estimateRunsCost(runs: RunRecord[]): CostEstimate {
  const lines: CostLine[] = [];
  for (const run of runs) {
    addLine(lines, firstStepModel(run), `run:${run.id}:brain`, usageOf(run.totalUsage));
    for (const e of run.events) {
      const out = e.outputSummary as { model?: string; usage?: unknown } | undefined;
      if (!out?.usage) continue;
      addLine(lines, out.model ?? 'unknown', `run:${run.id}:${e.toolName ?? e.type}`, usageOf(out.usage));
    }
  }

  const byKey = new Map<string, CostLine>();
  for (const l of lines) {
    const k = `${l.model}::${l.source.replace(/run:[^:]+:/, '')}`;
    const prev = byKey.get(k);
    if (!prev) {
      byKey.set(k, { ...l, source: l.source.replace(/run:[^:]+:/, '') });
    } else {
      prev.inputTokens += l.inputTokens;
      prev.outputTokens += l.outputTokens;
      prev.estimatedUsd = prev.estimatedUsd == null || l.estimatedUsd == null ? null : prev.estimatedUsd + l.estimatedUsd;
    }
  }
  const byModel = [...byKey.values()].sort((a, b) => b.inputTokens + b.outputTokens - (a.inputTokens + a.outputTokens));
  const inputTokens = lines.reduce((s, l) => s + l.inputTokens, 0);
  const outputTokens = lines.reduce((s, l) => s + l.outputTokens, 0);
  const known = byModel.filter((l) => l.estimatedUsd != null).reduce((s, l) => s + (l.estimatedUsd ?? 0), 0);
  return {
    runs: runs.length,
    inputTokens,
    outputTokens,
    estimatedUsd: +known.toFixed(4),
    unknownUsd: byModel.some((l) => l.estimatedUsd == null && (l.inputTokens || l.outputTokens)),
    byModel: byModel.map((l) => ({ ...l, estimatedUsd: l.estimatedUsd == null ? null : +l.estimatedUsd.toFixed(4) })),
    notes: [
      '历史 run 只能估算已经记录到 run.totalUsage / hidden tool usage 的文本模型成本。',
      'fal.ai 图像费用不在 token usage 中，需按 fal 账单另算。',
      '本次改造后 prompt_writer / inspect 会写入 hidden usage；旧 run 没有这些隐藏用量，实际历史成本偏低估。',
    ],
  };
}
