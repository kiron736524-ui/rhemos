export type AssetKind = 'booth-image' | 'multiview' | 'reference';

export type AttachmentKind = 'image' | 'pdf' | 'docx' | 'xlsx' | 'file';

export interface Attachment {
  id: string;
  kind: AttachmentKind;
  filename: string;
  mediaType: string;
  size: number;
  path: string;
  url: string;
  createdAt: string;
}

// ── 用户素材选材层（D33）：标记"哪些上传素材被选入当前方案 / 生图输入" ──
export type AttachmentRole =
  | 'brand_logo'
  | 'product_image'
  | 'style_reference'
  | 'floor_plan'
  | 'document_brief'
  | 'material_reference'
  | 'other';

export interface AttachmentUseRef {
  attachmentId: string;
  role: AttachmentRole;
  reason?: string;
}

// ── AssetAnalysis（D33）：对上传原始文件的结构化理解。基础分析不调 vision/OCR，只做文件名/类型启发式 + Office/文本提取。──
export type AssetAnalysisKind = 'brand_logo' | 'product_image' | 'style_reference' | 'floor_plan' | 'document_brief' | 'unknown';

export interface AssetAnalysis {
  id: string;
  projectId: string;
  attachmentId: string;

  kind: AssetAnalysisKind;
  confidence: number; // 0-100

  summary: string;
  extractedText?: string; // 限长（见 asset-analysis.ts MAX_EXTRACT_CHARS）

  facts?: {
    brandName?: string;
    productNames?: string[];
    colors?: string[];
    materials?: string[];
    styleKeywords?: string[];
    boothConstraints?: string[];
    dimensions?: string[];
  };

  recommendedRole?: AttachmentRole;
  usableForRender: boolean;
  warnings?: string[];

  model?: string; // 未来记录 vision/LLM；基础分析为空
  createdAt: string;
  updatedAt: string;
}

export interface Asset {
  id: string;
  kind: AssetKind;
  path: string; // 本地文件路径（相对项目根）
  url: string; // 前端可访问 URL
  prompt?: string;
  parentId?: string; // revise 来源资产
  createdAt: string;
  // 生成元数据（可选，事项4）：provider/model/quality/size/mode/耗时，供排查与对比不同图像供应商。
  provider?: string;
  model?: string;
  quality?: string;
  size?: string;
  mode?: string;
  durationMs?: number;
  // 输入快照关联（D32）：把生成图与"这次喂给模型的输入"绑定，便于追踪/复现。
  renderInputId?: string;
  sourceAttachmentIds?: string[];
  sourceAssetIds?: string[];
}

/** 成熟方案：一物多用——给用户看的方案 / 身份锁定 / 跨视图不变量 / 判图基准 */
export interface DesignSpec {
  narrative: string; // 给用户看的中文方案
  identity?: string; // 身份锁定串（基础信息 schema 的文字版）：尺寸/开口/各功能区位置/部件含数量/形状/材质/配色 hex/品牌占位——跨视图 + 跨次生成的一致性锚，每次生图强制前置
  footprint?: {
    shape: 'rectangle' | 'l-shape' | 'custom';
    dimensions?: { length?: number; width?: number };
    source: 'user' | 'default';
    boundaryRule: string;
    allowChamfer: boolean;
    allowCurvedPerimeter: boolean;
  };
  invariants: string[]; // 跨视图不可变量（多视图一致性用）
  selfCheckCriteria: string; // 供 inspect 的客观判图要点（"输出 vs spec"）
  updatedAt: string;
}

export type LayoutZoneType =
  | 'led'
  | 'screen'
  | 'stage'
  | 'brand'
  | 'wall'
  | 'reception'
  | 'counter'
  | 'meeting'
  | 'storage'
  | 'product'
  | 'showcase'
  | 'table'
  | 'chair'
  | 'totem'
  | 'truss'
  | 'door'
  | 'plant'
  | 'aisle';
export type LayoutOpening = 'front' | 'back' | 'left' | 'right';
export type LayoutShape = 'rect' | 'l' | 'circle' | 'capsule' | 'line';
export type LayoutLayer = 'space' | 'object' | 'detail';
export type LayoutFacing = LayoutOpening | 'center';

export interface BoothLayoutZone {
  id?: string;
  name: string;
  type?: LayoutZoneType;
  shape?: LayoutShape;
  x: number;
  y: number;
  w: number;
  h: number;
  height?: number;
  facing?: LayoutFacing;
  material?: string;
  description?: string;
  layer?: LayoutLayer;
  parentId?: string;
  note?: string;
}

export interface BoothLayout {
  length: number;
  width: number;
  openings?: LayoutOpening[];
  facing?: string;
  zones: BoothLayoutZone[];
}

export type LayoutDecisionStatus = 'pending' | 'confirmed' | 'skipped';

export interface LayoutDecision {
  status: LayoutDecisionStatus;
  proposal?: BoothLayout;
  planAssetId?: string;
  updatedAt: string;
}

export type RunStatus = 'running' | 'completed' | 'failed' | 'aborted';

export interface RunBudget {
  imageLimit: number;
  requestedImages?: number;
  actualImages?: number;
}

export interface RunEvent {
  at: string;
  type: 'step' | 'tool' | 'deliverable' | 'status';
  stepNumber?: number;
  toolName?: string;
  input?: unknown;
  outputSummary?: unknown;
  message?: string;
}

export interface RunRecord {
  id: string;
  projectId: string;
  status: RunStatus;
  startedAt: string;
  updatedAt: string;
  completedAt?: string;
  budget: RunBudget;
  totalUsage?: unknown;
  delivered?: string[];
  deliverable?: Deliverable;
  error?: string;
  events: RunEvent[];
}

export interface RunSummary {
  id: string;
  status: RunStatus;
  startedAt: string;
  completedAt?: string;
  budget: RunBudget;
  delivered?: string[];
  error?: string;
}

/**
 * 强类型 brief（最小骨架，渐进迁移用，不强制全量替换）。
 * 所有字段可选；与自由记录交叉（`BoothBrief & Record<string, unknown>`），
 * 旧的中文自由键（如 brief["面积"]）仍可写入，不破坏 update_brief。
 * 字段词典来源见 rubrics/questioning + docs/engineering-plan.md §4.1。
 */
export interface BoothBrief {
  space?: {
    length?: number; // 长边（米）
    width?: number; // 短边（米）
    openSides?: LayoutOpening[]; // 开口边
    openingRelation?: 'corner' | 'parallel' | 'unknown'; // 相邻(角位)/相对(穿越)/未知
    backWall?: LayoutOpening; // 背墙/主视觉墙所在边
    mainAisle?: LayoutOpening; // 主通道方向
    heightLimitM?: number; // 场馆限高（米）
  };
  height?: {
    mainWallM?: number; // 主体板墙高（不含 Truss，国内~4.4 / 海外~4.0）
    overallM?: number; // 总高（含 Truss/吊挂）
    includesTruss?: boolean; // overall 是否含 Truss
  };
  top?: {
    strategy?: 'none' | 'header' | 'ground_truss' | 'suspended_truss' | 'ceiling' | 'unknown';
    centerForm?: string; // 中部造型（环形/方框/网格/软膜/几何…）
    suspensionApproved?: boolean; // 吊点是否确认（未确认不得画悬浮）
  };
  brand?: {
    name?: string;
    slogan?: string;
    logo?: 'provided' | 'placeholder' | 'unknown'; // 有素材/占位/未知
    placements?: string[]; // 落位（主墙/门头/接待/LED/导视…）
  };
  products?: {
    kind?: string;
    count?: number;
    scale?: 'small' | 'medium' | 'large' | 'unknown'; // 大件不得上高柜（见 booth-rules）
    notes?: string;
  }[];
  functions?: {
    requiredZones?: string[]; // 必含功能区
    priority?: string[]; // 取舍优先级（面积紧张时）
  };
  style?: {
    tone?: string;
    primaryColor?: string;
    secondaryColor?: string;
  };
  material?: {
    budgetTier?: 'low' | 'mid' | 'high' | 'unknown';
    palette?: string[];
    lighting?: string;
  };
}

export interface ProjectState {
  id: string;
  // 强类型骨架 + 自由记录：BoothBrief 字段渐进结构化，旧自由键（中文短语）仍可写入。
  brief: BoothBrief & Record<string, unknown>;
  spec?: DesignSpec;
  layout?: LayoutDecision;
  assets: Asset[];
  attachments?: Attachment[];
  selectedAttachments?: AttachmentUseRef[]; // D33：被选入方案/生图输入的素材（轻量追踪层）
  baseAssetId?: string; // 用户从首稿候选中选定的当前方案基准图；后续深化默认只基于它
  runs?: RunSummary[];
  updatedAt: string;
}

/** 项目列表卡片摘要（左侧项目面板用）。 */
export interface ProjectSummary {
  id: string;
  title: string; // spec.narrative 首句，缺省时为占位名
  assetCount: number;
  updatedAt: string;
  thumbnailUrl?: string; // 最新资产缩略
}

// ── 统一交付协议 Deliverable（D24 契约①）──
// 所有 render 工具（best_of_n / generate_views / render_from_plan / revise_asset）的**统一出口形状**。
// 前端 / 对话气泡 / 画廊 / task_complete 都吃这一种 → 以后加新生图工具，前端零改动。
export type AssetRole = 'hero' | 'view' | 'candidate' | 'revision' | 'plan';
export type AssetStatus = 'recommended' | 'ok' | 'failed';

export interface DeliverableAsset {
  assetId: string;
  url: string;
  role: AssetRole; // 主图 / 视角 / 候选 / 修订 / 平面图
  view?: string; // 视角名（role='view' 时），如 'left side' / 'top-down'
  status: AssetStatus; // recommended=首选 · ok=已出图 · failed=未出图（判图/打分已删除，见 D39）
  score?: number; // 兼容字段：判图删除后不再写入，保留可选以免破坏旧数据
}

export type DeliverableType = 'single' | 'candidate-set' | 'view-set' | 'plan-conditioned' | 'revision';

export interface Deliverable {
  type: DeliverableType;
  assets: DeliverableAsset[]; // 本次产出的所有图
  recommendedId: string; // 默认展示/交付哪张的 assetId
  issues?: string[]; // 客观问题（弱视角 / 失败 / 预算截断…）
}

// ── RenderInputSnapshot（D32）：每次真正调用图像模型前固化的"输入证据链" ──
// 回答"这张图用了哪个 prompt / provider / 质量档 / 引用了哪些素材 / 基于哪个 spec·layout / 生成前有哪些规则问题"。
// 只存轻量引用（url/path/assetId/attachmentId/prompt 文本），**绝不存图片 base64**；
// 落 .data/projects/<id>/render-inputs/<id>.json，供开发者审计，不喂回大脑。
export type RenderInputMode = 'concept' | 'final' | 'revise';
export type RenderInputRefKind = 'attachment' | 'asset' | 'reference' | 'plan';
export type RenderInputRefRole =
  | 'brand_logo'
  | 'style_reference'
  | 'product_image'
  | 'floor_plan'
  | 'previous_render'
  | 'layout_plan'
  | 'other';

export interface RenderInputRef {
  id: string;
  kind: RenderInputRefKind;
  role: RenderInputRefRole;
  url?: string;
  path?: string;
  filename?: string;
  mediaType?: string;
  note?: string;
}

/** booth-rules 的 BoothRuleIssue 的轻量镜像（避免 types ← booth-rules 循环依赖）。 */
export interface BoothRuleIssueLike {
  severity: 'blocker' | 'fail' | 'warning';
  code: string;
  message: string;
  suggestedFix?: string;
}

export type RenderInputOperation = 'text-to-image' | 'image-edit' | 'plan-conditioned' | 'view-generation' | 'revision';

export interface RenderInputSnapshot {
  id: string;
  projectId: string;
  runId?: string | null;

  mode: RenderInputMode;
  provider: string;
  model: string;
  quality?: string;
  size?: string;

  prompt: string; // 最终送给 provider 的完整 prompt（已含 identity + render style anchor）
  intent?: string; // 大脑传入的中文意图
  view?: string; // 多视角时的视角
  operation: RenderInputOperation;

  specSummary?: {
    hasSpec: boolean;
    identity?: string;
    invariants?: string[];
    selfCheckCriteria?: string;
    updatedAt?: string;
  };

  layoutSummary?: {
    status?: LayoutDecisionStatus;
    planAssetId?: string;
    proposal?: BoothLayout;
  };

  refs: RenderInputRef[];

  ruleIssues?: BoothRuleIssueLike[];

  createdAt: string;
}
