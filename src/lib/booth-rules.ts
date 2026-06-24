import type { BoothBrief, BoothLayout, BoothLayoutZone, DesignSpec, LayoutOpening } from './types';

/**
 * 最小展台规则引擎（纯函数，不依赖模型 / 不调 API）。
 *
 * 定位：在「坐标裁剪」(lib/layout.ts) 与「VLM 判图」(agent/inspect.ts) 之外，补一层
 * **可计算的展台专业校验**——只基于结构化数据（BoothLayout / brief / spec）做几何与常识检查。
 * 把原本只活在 markdown / prompt 里的展台规则前移成可执行、可单测的校验。
 *
 * 坐标系（与前端 FloorPlan / LayoutEditor 一致）：x 沿长边 ∈[0,length]，y 沿进深 ∈[0,width]；
 * 边：back=y0(顶) · front=y最大(底/主通道侧) · left=x0 · right=x最大。
 *
 * 严重度：blocker=必须打回（数据不可用）· fail=明显专业错误 · warning=信息不足或潜在问题。
 * 调用方（present-layout / present-choices / render）只把 issues 透传给前端/大脑或写入
 * deliverable，**除 blocker 外不阻断流程**。
 */
export type RuleSeverity = 'blocker' | 'fail' | 'warning';

export interface BoothRuleIssue {
  severity: RuleSeverity;
  code: string;
  message: string;
  evidence?: unknown;
  suggestedFix?: string;
}

export interface BoothRuleContext {
  brief?: (BoothBrief & Record<string, unknown>) | Record<string, unknown>;
  spec?: DesignSpec;
}

// 主视觉 / 展示类（构成"真正的展台"）
const DISPLAY_TYPES = new Set(['led', 'brand', 'product', 'stage']);
// 高体量 / 封闭类（不应阻断动线或占住开口）
const BULKY_TYPES = new Set(['meeting', 'storage', 'brand']);
// 关键区（彼此严重重叠即判错）
const KEY_TYPES = new Set(['led', 'brand', 'product', 'reception', 'meeting', 'storage', 'stage']);

const area = (z: BoothLayoutZone) => Math.max(0, z.w) * Math.max(0, z.h);
const footprint = (l: BoothLayout) => Math.max(0, l.length) * Math.max(0, l.width);

/** 边的容差：max(0.3m, 该方向尺寸的 8%)。 */
function edgeTol(l: BoothLayout, axis: 'x' | 'y') {
  return Math.max(0.3, (axis === 'x' ? l.length : l.width) * 0.08);
}

/** zone 是否贴某条边。 */
function hugsEdge(z: BoothLayoutZone, l: BoothLayout, edge: LayoutOpening): boolean {
  switch (edge) {
    case 'back':
      return z.y <= edgeTol(l, 'y');
    case 'front':
      return l.width - (z.y + z.h) <= edgeTol(l, 'y');
    case 'left':
      return z.x <= edgeTol(l, 'x');
    case 'right':
      return l.length - (z.x + z.w) <= edgeTol(l, 'x');
  }
}

/** zone 沿某条边的占边比例（0-1+）。 */
function edgeSpanFrac(z: BoothLayoutZone, l: BoothLayout, edge: LayoutOpening): number {
  if (edge === 'front' || edge === 'back') return l.length > 0 ? z.w / l.length : 0;
  return l.width > 0 ? z.h / l.width : 0;
}

/** zone 是否大致居中于某条边（中点靠近边中点 ±20%）。 */
function centeredOnEdge(z: BoothLayoutZone, l: BoothLayout, edge: LayoutOpening): boolean {
  if (edge === 'front' || edge === 'back') {
    return Math.abs(z.x + z.w / 2 - l.length / 2) <= l.length * 0.2;
  }
  return Math.abs(z.y + z.h / 2 - l.width / 2) <= l.width * 0.2;
}

/** zone 是否覆盖展台几何中心点。 */
function coversCenter(z: BoothLayoutZone, l: BoothLayout): boolean {
  const cx = l.length / 2;
  const cy = l.width / 2;
  return z.x <= cx && cx <= z.x + z.w && z.y <= cy && cy <= z.y + z.h;
}

/** 两 zone 重叠面积。 */
function overlapArea(a: BoothLayoutZone, b: BoothLayoutZone): number {
  const ox = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const oy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  return ox * oy;
}

const closedEdges = (openings: LayoutOpening[]): LayoutOpening[] =>
  (['front', 'back', 'left', 'right'] as LayoutOpening[]).filter((e) => !openings.includes(e));

/** 两面开关系：相对(parallel) vs 相邻(corner) vs 未知。 */
export function openingRelation(openings: LayoutOpening[]): 'parallel' | 'corner' | 'unknown' {
  if (openings.length !== 2) return 'unknown';
  const s = new Set(openings);
  if ((s.has('front') && s.has('back')) || (s.has('left') && s.has('right'))) return 'parallel';
  return 'corner';
}

/** 从文本里抽洽谈/会议人数（"4人" / "6 people" / "8 pax"）。 */
function headcountFrom(...texts: (string | undefined)[]): number | undefined {
  for (const t of texts) {
    if (!t) continue;
    const m = t.match(/(\d{1,2})\s*(?:人|persons?|people|pax|seats?|座)/i);
    if (m) return Number(m[1]);
  }
  return undefined;
}

const CABINET_CONFLICT = /(高柜|高台|吊柜|柜顶|柜上|架上|on (?:a )?(?:tall|high) cabinet|elevated|raised cabinet)/i;

/**
 * 跑全部规则。layout 必填；ctx(brief/spec) 可选——缺失时退化为基于 layout 的检查。
 * 返回 issues 数组（空=无明显问题）。纯函数，可后续直接单测。
 */
export function checkBoothLayout(layout: BoothLayout, ctx: BoothRuleContext = {}): BoothRuleIssue[] {
  const issues: BoothRuleIssue[] = [];
  const push = (i: BoothRuleIssue) => issues.push(i);
  const zones = Array.isArray(layout?.zones) ? layout.zones : [];
  const openings = Array.isArray(layout?.openings) ? layout.openings : [];
  const fp = footprint(layout);

  // ── 规则 1：长宽合理 + zones 非空 ──
  if (!(layout.length > 0) || !(layout.width > 0)) {
    push({ severity: 'blocker', code: 'LAYOUT_DIMENSIONS_INVALID', message: `布局长宽非法（length=${layout.length}, width=${layout.width}）`, suggestedFix: '给出正的长边/短边米数' });
  }
  if (!zones.length) {
    push({ severity: 'blocker', code: 'ZONES_EMPTY', message: '布局没有任何功能区', suggestedFix: '至少给出主视觉/展示/接待等核心功能区' });
    return issues; // 没有 zone，后续几何规则无意义
  }
  const ratio = layout.length > 0 && layout.width > 0 ? Math.max(layout.length, layout.width) / Math.min(layout.length, layout.width) : 0;
  if (ratio > 8) {
    push({ severity: 'warning', code: 'LAYOUT_ASPECT_EXTREME', message: `展台长宽比异常（${ratio.toFixed(1)}:1），疑似尺寸录入错误`, evidence: { length: layout.length, width: layout.width } });
  }

  // ── 规则 2：越界 / 异常尺寸（normalize 已裁剪，这里抓贴边异常与整版铺满）──
  for (const z of zones) {
    const oob = z.x < -1e-6 || z.y < -1e-6 || z.x + z.w > layout.length + 1e-6 || z.y + z.h > layout.width + 1e-6;
    if (oob) {
      push({ severity: 'fail', code: 'ZONE_OUT_OF_BOUNDS', message: `功能区「${z.name}」越出展台边界`, evidence: { x: z.x, y: z.y, w: z.w, h: z.h }, suggestedFix: '把该区收回展台轮廓内' });
    }
    if (z.w >= layout.length * 0.98 && z.h >= layout.width * 0.98) {
      push({ severity: 'warning', code: 'ZONE_FILLS_BOOTH', message: `功能区「${z.name}」几乎铺满整个展台，疑似缺少分区`, evidence: { w: z.w, h: z.h } });
    }
  }

  // ── 规则 15：所有实体区面积总和 > footprint 110% ──（先算，便于后面引用）
  const solidArea = zones.filter((z) => z.type !== 'aisle').reduce((s, z) => s + area(z), 0);
  if (fp > 0 && solidArea > fp * 1.1) {
    push({
      severity: 'fail',
      code: 'AREA_OVERSUBSCRIBED',
      message: `功能区面积合计 ${solidArea.toFixed(1)}㎡ 超过展台 ${fp.toFixed(1)}㎡ 的 110%，塞不下`,
      evidence: { solidArea: +solidArea.toFixed(1), footprint: +fp.toFixed(1) },
      suggestedFix: '精简功能区或缩小占地（洽谈/储物最易压缩）',
    });
  }

  // ── 规则 9：关键区严重重叠 ──
  const keyZones = zones.filter((z) => z.type && KEY_TYPES.has(z.type));
  for (let i = 0; i < keyZones.length; i++) {
    for (let j = i + 1; j < keyZones.length; j++) {
      const a = keyZones[i];
      const b = keyZones[j];
      const ov = overlapArea(a, b);
      const minA = Math.min(area(a), area(b));
      if (minA > 0 && ov / minA > 0.5) {
        push({
          severity: 'fail',
          code: 'KEY_ZONES_OVERLAP',
          message: `「${a.name}」与「${b.name}」严重重叠（${Math.round((ov / minA) * 100)}%）`,
          evidence: { a: a.name, b: b.name, overlap: +ov.toFixed(1) },
          suggestedFix: '分开两区或合并为一体化展示',
        });
      }
    }
  }

  // ── 规则 14：只有家具类、无展示/品牌 → fail ──
  const hasDisplay = zones.some((z) => z.type && DISPLAY_TYPES.has(z.type));
  if (!hasDisplay) {
    push({
      severity: 'fail',
      code: 'ONLY_FURNITURE',
      message: '展台缺少 brand/led/product/stage 等展示类功能区，像空场景或临时布置',
      suggestedFix: '补主视觉墙 / LED / 产品展示等核心展示区',
    });
  } else {
    // ── 规则 13：有展示物但无 brand/led 主视觉墙 → warning ──
    const hasMainVisual = zones.some((z) => z.type === 'brand' || z.type === 'led');
    if (!hasMainVisual) {
      push({ severity: 'warning', code: 'MAIN_VISUAL_MISSING', message: '缺少 brand/led 主视觉墙，品牌识别偏弱', suggestedFix: '增加面向主通道的品牌墙或 LED 主屏' });
    }
  }

  // ── 规则 6（开口关系）/ 规则 5（背墙倾向）所需 ──
  if (!openings.length) {
    push({ severity: 'warning', code: 'OPENINGS_MISSING', message: '未标注开口边，无法推断展台类型（相邻/相对两面开、背墙朝向等）', suggestedFix: '标注开放边（front/back/left/right）' });
  } else {
    // 规则 6：两面开必须能区分相邻(角位)/相对(穿越)。两个开口标到同一条边 → 无法判断 → warning。
    // 正常 normalize 会去重开口，故生产路径（present-layout/choices/render 先 normalize）不会误报；
    // 仅原始/异常数据（如 openings:["front","front"]）触发。relation 推断见 openingRelation()。
    if (openings.length === 2 && new Set(openings).size < 2) {
      push({ severity: 'warning', code: 'OPENING_RELATION_UNCLEAR', message: '两面开但两个开口标在同一条边，无法判断相邻(角位)还是相对(穿越)', evidence: { openings } });
    }
    // 规则 5：一面开 / 三面开必须能看出背墙 / 主视觉墙倾向（贴某条封闭边的 brand/led）
    if (openings.length === 1 || openings.length === 3) {
      const closed = closedEdges(openings);
      const hasBackWall = zones.some((z) => (z.type === 'brand' || z.type === 'led') && closed.some((e) => hugsEdge(z, layout, e)));
      if (!hasBackWall) {
        push({
          severity: 'warning',
          code: 'BACK_WALL_TENDENCY_MISSING',
          message: `${openings.length === 1 ? '一面开' : '三面开'}缺少贴封闭边的背墙/主视觉墙倾向`,
          evidence: { openings, closedEdges: closed },
          suggestedFix: '把品牌墙/LED 主屏靠到封闭边形成背墙',
        });
      }
    }
  }

  // ── 规则 3 / 4 / 8 / 12：开口与中心相关 ──
  for (const z of zones) {
    // 规则 3：接待台不应大面积压在开放边入口正中
    if (z.type === 'reception') {
      for (const e of openings) {
        if (hugsEdge(z, layout, e) && centeredOnEdge(z, layout, e)) {
          const frac = edgeSpanFrac(z, layout, e);
          push({
            severity: frac > 0.5 ? 'fail' : 'warning',
            code: 'RECEPTION_BLOCKS_ENTRANCE',
            message: `接待台「${z.name}」压在开放边(${e})入口正中${frac > 0.5 ? '且占边过宽，堵住入口' : ''}`,
            evidence: { edge: e, spanFrac: +frac.toFixed(2) },
            suggestedFix: '接待台移到入口一侧/转角，让出主通道',
          });
          break;
        }
      }
    }
    // 规则 8：储物间不应在主入口或主视觉中心
    if (z.type === 'storage') {
      const onOpen = openings.some((e) => hugsEdge(z, layout, e));
      if (onOpen || coversCenter(z, layout)) {
        push({
          severity: 'warning',
          code: 'STORAGE_AT_FOCAL_POINT',
          message: `储物间「${z.name}」位于${onOpen ? '开放边入口处' : '展台视觉中心'}，应藏到主视觉墙后/边角`,
          evidence: { onOpen, center: coversCenter(z, layout) },
          suggestedFix: '把储物间挪到背墙后或边角封闭处',
        });
      }
    }
    // 规则 12：开放边被大面积封闭/高体量区占用
    if (z.type && BULKY_TYPES.has(z.type)) {
      for (const e of openings) {
        if (hugsEdge(z, layout, e) && edgeSpanFrac(z, layout, e) > 0.6) {
          push({
            severity: 'fail',
            code: 'OPEN_SIDE_BLOCKED',
            message: `开放边(${e})被高体量/封闭区「${z.name}」大面积占据（占边 ${Math.round(edgeSpanFrac(z, layout, e) * 100)}%），堵死通透性`,
            evidence: { edge: e, type: z.type },
            suggestedFix: '把封闭/高体量区靠后/靠邻展边，开放边保持通透',
          });
          break;
        }
      }
    }
  }

  // ── 规则 4：四面开时高体量会议/储物/品牌墙居中阻断动线 ──
  if (openings.length === 4) {
    for (const z of zones) {
      if (z.type && BULKY_TYPES.has(z.type) && coversCenter(z, layout) && fp > 0 && area(z) > fp * 0.12) {
        push({
          severity: 'fail',
          code: 'CENTER_BLOCKS_CIRCULATION',
          message: `四面开却把高体量区「${z.name}」放在正中阻断环形动线`,
          evidence: { type: z.type, areaFrac: +(area(z) / fp).toFixed(2) },
          suggestedFix: '四面开中心保持通透，高体量区改用边缘墙/边角',
        });
      }
    }
  }

  // ── 规则 7：洽谈/会议区面积过小 ──
  for (const z of zones.filter((z) => z.type === 'meeting')) {
    const a = area(z);
    const heads = headcountFrom(z.name, z.note);
    if (heads != null) {
      const min = heads <= 4 ? 4 : heads <= 6 ? 6 : Math.max(9, heads * 1.2);
      if (a < min) {
        push({
          severity: a < min * 0.7 ? 'fail' : 'warning',
          code: 'MEETING_AREA_TOO_SMALL',
          message: `${heads} 人洽谈区「${z.name}」仅 ${a.toFixed(1)}㎡，建议 ≥${min}㎡`,
          evidence: { heads, area: +a.toFixed(1), min },
          suggestedFix: `扩到约 ${min}-${Math.round(min * 1.5)}㎡，或减少人数`,
        });
      }
    } else if (a < 4) {
      push({ severity: 'warning', code: 'MEETING_AREA_TOO_SMALL', message: `洽谈区「${z.name}」仅 ${a.toFixed(1)}㎡，4 人需 4-6㎡（未标人数）`, evidence: { area: +a.toFixed(1) }, suggestedFix: '确认人数并保证 4 人 4-6㎡ / 6 人 6-9㎡' });
    }
  }

  // ── 规则 10：大件 product 标注放在高柜上 ──
  const briefSaysLarge = ((): boolean => {
    const products = (ctx.brief as { products?: { scale?: string }[] } | undefined)?.products;
    return Array.isArray(products) && products.some((p) => p?.scale === 'large');
  })();
  for (const z of zones.filter((z) => z.type === 'product')) {
    if (CABINET_CONFLICT.test(`${z.name} ${z.note ?? ''}`)) {
      push({
        severity: 'warning',
        code: 'PRODUCT_ON_HIGH_CABINET',
        message: `产品区「${z.name}」标注疑似把展品放上高柜${briefSaysLarge ? '（brief 含大件产品）' : ''}；大件产品应落地或 10-30cm 小地台`,
        evidence: { note: z.note },
        suggestedFix: '大件落地展示，高柜只放小件/资料',
      });
    }
  }

  // ── 规则 11：顶部/桁架信息暂无法在 BoothLayout 表达 → 保留 TODO，不伪造 ──
  // TODO(Phase 5): BoothLayout 目前只描述俯视平面，没有顶部/Truss/限高字段。
  // 顶部结构（落地/吊装 Truss、中部造型、跨度安全、限高）校验需先把这些信息进 brief.top / 一个 3D schema，
  // 再在此补规则。现在不臆造顶部规则，避免对没有顶部数据的布局误报。

  return issues;
}

/** 是否含 blocker（调用方据此决定是否打回）。 */
export const hasBlocker = (issues: BoothRuleIssue[]): boolean => issues.some((i) => i.severity === 'blocker');

/** 取非 warning（blocker+fail）的简短消息列表，便于写入 deliverable.issues。 */
export const failMessages = (issues: BoothRuleIssue[]): string[] =>
  issues.filter((i) => i.severity !== 'warning').map((i) => i.message);

/** 全部 issue 的简短消息（含 warning），用于 prompt-writer criteria / run 记录。 */
export const allMessages = (issues: BoothRuleIssue[]): string[] => issues.map((i) => `[${i.severity}] ${i.message}`);
