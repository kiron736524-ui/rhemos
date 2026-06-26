import { describe, expect, it } from 'vitest';
import type { BoothLayout } from '@/lib/types';
import { layoutLabelIssues } from './present-choices';

const backWallLayout: BoothLayout = {
  length: 15,
  width: 12,
  openings: ['front', 'left', 'right'],
  facing: '连续背墙在后(back)侧',
  zones: [
    { name: '品牌墙', type: 'brand', x: 0, y: 0, w: 15, h: 0.6 },
    { name: '展车', type: 'stage', x: 4.5, y: 4.5, w: 6, h: 3 },
  ],
};

describe('layoutLabelIssues', () => {
  it('不把 detail 里的开放短边说明误判成封闭短边', () => {
    const issues = layoutLabelIssues(
      '后侧整条边做连续宽幅背墙（推荐）',
      '前、左、右开放；左右两条较短边开放，环形动线宽松。',
      backWallLayout,
    );
    expect(issues).toHaveLength(0);
  });

  it('明确封闭方位与 layout 不一致时才报错', () => {
    const issues = layoutLabelIssues('右侧整条边做背墙', undefined, backWallLayout);
    expect(issues.some((i) => i.includes('右边'))).toBe(true);
  });

  it('明确说封闭短边但 layout 关闭长边时才报错', () => {
    const issues = layoutLabelIssues('封闭 12m 短边做背墙', undefined, backWallLayout);
    expect(issues.some((i) => i.includes('封闭短边'))).toBe(true);
  });
});
