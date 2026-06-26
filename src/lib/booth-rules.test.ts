import { describe, it, expect } from 'vitest';
import { checkBoothLayout, hasBlocker, openingRelation, type BoothRuleIssue } from './booth-rules';
import type { BoothLayout } from './types';

const has = (issues: BoothRuleIssue[], code: string) => issues.some((i) => i.code === code);
const sevOf = (issues: BoothRuleIssue[], code: string) => issues.find((i) => i.code === code)?.severity;
const fails = (issues: BoothRuleIssue[]) => issues.filter((i) => i.severity === 'fail');

describe('checkBoothLayout', () => {
  // 1. 合法基础 layout（6×6，front/right 双开口，brand/product/reception/meeting/storage）→ 无 blocker、无 fail
  it('合法布局：无 blocker、无 fail', () => {
    const layout: BoothLayout = {
      length: 6,
      width: 6,
      openings: ['front', 'right'],
      zones: [
        { name: '品牌主墙', type: 'brand', x: 0, y: 0, w: 6, h: 0.6 },
        { name: '储物间', type: 'storage', x: 0, y: 0.6, w: 1.2, h: 1.2 },
        { name: '产品展示', type: 'product', x: 0, y: 2.0, w: 3.0, h: 2.0 },
        { name: '洽谈区', type: 'meeting', x: 3.5, y: 1.0, w: 2.5, h: 2.5 },
        { name: '接待台', type: 'reception', x: 0, y: 4.8, w: 1.5, h: 1.0 },
      ],
    };
    const issues = checkBoothLayout(layout);
    expect(hasBlocker(issues)).toBe(false);
    expect(fails(issues)).toHaveLength(0);
  });

  // 2. 空 zones → blocker
  it('空 zones → blocker(ZONES_EMPTY)', () => {
    const issues = checkBoothLayout({ length: 6, width: 6, zones: [] });
    expect(hasBlocker(issues)).toBe(true);
    expect(has(issues, 'ZONES_EMPTY')).toBe(true);
  });

  // 长宽非法 → blocker
  it('长宽非法 → blocker(LAYOUT_DIMENSIONS_INVALID)', () => {
    const issues = checkBoothLayout({ length: 0, width: 6, zones: [{ name: '主展', type: 'brand', x: 0, y: 0, w: 1, h: 1 }] });
    expect(has(issues, 'LAYOUT_DIMENSIONS_INVALID')).toBe(true);
  });

  // 3. zone 越界 → fail；铺满 → warning
  it('zone 越界 → fail(ZONE_OUT_OF_BOUNDS)', () => {
    const issues = checkBoothLayout({ length: 6, width: 6, zones: [{ name: '超界', type: 'product', x: 5, y: 5, w: 3, h: 3 }] });
    expect(sevOf(issues, 'ZONE_OUT_OF_BOUNDS')).toBe('fail');
  });
  it('单区铺满整个展台 → warning(ZONE_FILLS_BOOTH)', () => {
    const issues = checkBoothLayout({ length: 6, width: 6, zones: [{ name: '满铺', type: 'brand', x: 0, y: 0, w: 6, h: 6 }] });
    expect(sevOf(issues, 'ZONE_FILLS_BOOTH')).toBe('warning');
  });

  // 4. 接待台大面积压在 front 开放边入口正中 → fail
  it('接待台堵在 front 入口正中 → fail(RECEPTION_BLOCKS_ENTRANCE)', () => {
    const layout: BoothLayout = {
      length: 6,
      width: 6,
      openings: ['front'],
      zones: [
        { name: '品牌主墙', type: 'brand', x: 0, y: 0, w: 6, h: 0.6 },
        { name: '接待台', type: 'reception', x: 1.5, y: 5.4, w: 3.5, h: 0.6 },
      ],
    };
    const issues = checkBoothLayout(layout);
    expect(sevOf(issues, 'RECEPTION_BLOCKS_ENTRANCE')).toBe('fail');
  });

  // 5. 四面开中央高体量阻断 → fail
  it('四面开中央 meeting 阻断动线 → fail(CENTER_BLOCKS_CIRCULATION)', () => {
    const layout: BoothLayout = {
      length: 10,
      width: 10,
      openings: ['front', 'back', 'left', 'right'],
      zones: [
        { name: '产品', type: 'product', x: 0, y: 0, w: 2, h: 2 },
        { name: '中央会议室', type: 'meeting', x: 3, y: 3, w: 4, h: 4 },
      ],
    };
    const issues = checkBoothLayout(layout);
    expect(sevOf(issues, 'CENTER_BLOCKS_CIRCULATION')).toBe('fail');
  });

  // 6. 只有 furniture/plant/aisle，无展示类 → fail
  it('只有家具/植物/过道，无展示类 → fail(ONLY_FURNITURE)', () => {
    const layout: BoothLayout = {
      length: 6,
      width: 6,
      zones: [
        { name: '绿植', type: 'plant', x: 0, y: 0, w: 2, h: 2 },
        { name: '过道', type: 'aisle', x: 2, y: 2, w: 2, h: 2 },
        { name: '接待', type: 'reception', x: 4, y: 4, w: 1, h: 1 },
      ],
    };
    const issues = checkBoothLayout(layout);
    expect(sevOf(issues, 'ONLY_FURNITURE')).toBe('fail');
  });

  // 7. 有展示物但缺 brand/led 主视觉 → warning
  it('缺 brand/led 主视觉 → warning(MAIN_VISUAL_MISSING)', () => {
    const layout: BoothLayout = {
      length: 6,
      width: 6,
      openings: ['front'],
      zones: [
        { name: '产品展示', type: 'product', x: 1, y: 0, w: 3, h: 3 },
        { name: '接待', type: 'reception', x: 0, y: 5, w: 1.5, h: 0.8 },
      ],
    };
    const issues = checkBoothLayout(layout);
    expect(sevOf(issues, 'MAIN_VISUAL_MISSING')).toBe('warning');
    expect(has(issues, 'ONLY_FURNITURE')).toBe(false);
  });

  // 8. 面积总和明显超过 110% → fail
  it('面积总和超 110% → fail(AREA_OVERSUBSCRIBED)', () => {
    const layout: BoothLayout = {
      length: 6,
      width: 6,
      zones: [
        { name: '主墙', type: 'brand', x: 0, y: 0, w: 6, h: 4 },
        { name: '产品', type: 'product', x: 0, y: 2, w: 6, h: 4 },
      ],
    };
    const issues = checkBoothLayout(layout);
    expect(sevOf(issues, 'AREA_OVERSUBSCRIBED')).toBe('fail');
  });

  it('顶部 Truss/detail 不计入地面面积与满铺告警', () => {
    const layout: BoothLayout = {
      length: 15,
      width: 12,
      openings: ['front', 'left', 'right'],
      zones: [
        { name: '后侧品牌墙', type: 'brand', x: 0, y: 0, w: 15, h: 0.6, layer: 'object' },
        { name: '展车台', type: 'stage', x: 4.5, y: 4.5, w: 6, h: 3.2, layer: 'object' },
        { name: '顶部 Truss 灯架', type: 'truss', x: 0, y: 0, w: 15, h: 12, height: 5, layer: 'detail' },
      ],
    };
    const issues = checkBoothLayout(layout);
    expect(has(issues, 'AREA_OVERSUBSCRIBED')).toBe(false);
    expect(has(issues, 'ZONE_FILLS_BOOTH')).toBe(false);
  });

  // 9. 关键 zone 严重重叠 → fail
  it('关键区严重重叠 → fail(KEY_ZONES_OVERLAP)', () => {
    const layout: BoothLayout = {
      length: 8,
      width: 8,
      zones: [
        { name: '品牌墙', type: 'brand', x: 0, y: 0, w: 3, h: 3 },
        { name: '产品区', type: 'product', x: 0.5, y: 0.5, w: 3, h: 3 },
      ],
    };
    const issues = checkBoothLayout(layout);
    expect(sevOf(issues, 'KEY_ZONES_OVERLAP')).toBe('fail');
  });

  // 10. 两面开但两个开口标在同一条边 → warning
  it('两面开标到同一条边 → warning(OPENING_RELATION_UNCLEAR)', () => {
    const layout: BoothLayout = {
      length: 6,
      width: 6,
      openings: ['front', 'front'],
      zones: [{ name: '品牌墙', type: 'brand', x: 0, y: 0, w: 6, h: 0.6 }],
    };
    const issues = checkBoothLayout(layout);
    expect(sevOf(issues, 'OPENING_RELATION_UNCLEAR')).toBe('warning');
  });

  // 11. 储物间在主入口（开放边）→ warning
  it('储物间贴开放边入口 → warning(STORAGE_AT_FOCAL_POINT)', () => {
    const layout: BoothLayout = {
      length: 6,
      width: 6,
      openings: ['front'],
      zones: [
        { name: '品牌主墙', type: 'brand', x: 0, y: 0, w: 6, h: 0.6 },
        { name: '储物间', type: 'storage', x: 2, y: 5, w: 2, h: 0.8 },
      ],
    };
    const issues = checkBoothLayout(layout);
    expect(sevOf(issues, 'STORAGE_AT_FOCAL_POINT')).toBe('warning');
  });

  // 12. 大件产品 note 标注放在高柜上 → warning
  it('产品标注高柜冲突 → warning(PRODUCT_ON_HIGH_CABINET)', () => {
    const layout: BoothLayout = {
      length: 6,
      width: 6,
      zones: [{ name: '大件设备', type: 'product', x: 1, y: 1, w: 3, h: 3, note: '设备放在高柜上' }],
    };
    const issues = checkBoothLayout(layout, { brief: { products: [{ scale: 'large' }] } });
    expect(sevOf(issues, 'PRODUCT_ON_HIGH_CABINET')).toBe('warning');
  });
});

describe('openingRelation', () => {
  it('相邻两边 → corner', () => {
    expect(openingRelation(['front', 'right'])).toBe('corner');
    expect(openingRelation(['back', 'left'])).toBe('corner');
  });
  it('相对两边 → parallel', () => {
    expect(openingRelation(['front', 'back'])).toBe('parallel');
    expect(openingRelation(['left', 'right'])).toBe('parallel');
  });
  it('非两面开 → unknown', () => {
    expect(openingRelation(['front'])).toBe('unknown');
    expect(openingRelation(['front', 'back', 'left'])).toBe('unknown');
  });
});
