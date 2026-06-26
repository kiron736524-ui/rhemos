import { describe, expect, it } from 'vitest';
import { estimateRunsCost } from './cost-estimate';
import type { RunRecord } from './types';

describe('estimateRunsCost', () => {
  it('估算主脑与隐藏工具 usage', () => {
    const runs: RunRecord[] = [
      {
        id: 'run-a',
        projectId: 'p1',
        status: 'completed',
        startedAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:01.000Z',
        budget: { imageLimit: 16 },
        totalUsage: { inputTokens: 1_000_000, outputTokens: 100_000 },
        events: [
          { at: '2026-01-01T00:00:00.000Z', type: 'step', outputSummary: { model: 'anthropic/claude-opus-4.8' } },
          {
            at: '2026-01-01T00:00:00.500Z',
            type: 'tool',
            toolName: 'prompt_writer',
            outputSummary: { model: 'anthropic/claude-opus-4.8', usage: { inputTokens: 100_000, outputTokens: 10_000 } },
          },
        ],
      },
    ];
    const estimate = estimateRunsCost(runs);
    expect(estimate.inputTokens).toBe(1_100_000);
    expect(estimate.outputTokens).toBe(110_000);
    expect(estimate.estimatedUsd).toBeCloseTo(8.25, 2);
    expect(estimate.byModel.some((l) => l.source === 'prompt_writer')).toBe(true);
  });
});
