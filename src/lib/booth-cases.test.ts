import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { checkBoothLayout, hasBlocker } from './booth-rules';
import { normalizeBoothLayout } from './layout';
import type { BoothLayout } from './types';

// 真实案例回归：读 fixtures/booth-cases/basic-cases.json，对每个 case 跑纯函数规则引擎。
// 不调用任何模型 / 不需 API key / 不联网——纯本地结构校验。
interface BoothCase {
  id: string;
  title: string;
  brief?: Record<string, unknown>;
  layout: BoothLayout;
  expected: { mustHaveZones: string[]; warningsAllowed: boolean; shouldFailRules: boolean };
}

const cases = JSON.parse(readFileSync(path.join(process.cwd(), 'fixtures', 'booth-cases', 'basic-cases.json'), 'utf8')) as BoothCase[];

describe('booth-cases 回归样例', () => {
  it('样例集存在且 ≥10 个、结构完整', () => {
    expect(cases.length).toBeGreaterThanOrEqual(10);
    for (const c of cases) {
      expect(c.id).toBeTruthy();
      expect(c.layout).toBeTruthy();
      expect(c.expected).toBeTruthy();
    }
  });

  for (const c of cases) {
    describe(c.id, () => {
      const norm = normalizeBoothLayout(c.layout); // 走与 present-layout/render 一致的规范化
      const issues = checkBoothLayout(norm, { brief: c.brief });

      it('layout 通过 normalize：dims 正、zones 非空', () => {
        expect(norm.length).toBeGreaterThan(0);
        expect(norm.width).toBeGreaterThan(0);
        expect(norm.zones.length).toBeGreaterThan(0);
      });

      it('mustHaveZones 都在 layout 中', () => {
        const types = new Set(norm.zones.map((z) => z.type as string));
        for (const t of c.expected.mustHaveZones) expect(types.has(t)).toBe(true);
      });

      it(c.expected.shouldFailRules ? '应至少出现 fail/blocker' : '不应出现 blocker', () => {
        if (c.expected.shouldFailRules) {
          expect(issues.some((i) => i.severity === 'fail' || i.severity === 'blocker')).toBe(true);
        } else {
          expect(hasBlocker(issues)).toBe(false);
        }
      });
    });
  }
});
