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

export interface InspectionResult {
  pass: boolean;
  score?: number;
  fails?: string[];
  summary?: string;
  model: string;
  at: string;
}

export interface Asset {
  id: string;
  kind: AssetKind;
  path: string; // 本地文件路径（相对项目根）
  url: string; // 前端可访问 URL
  prompt?: string;
  parentId?: string; // revise 来源资产
  createdAt: string;
  inspections?: InspectionResult[];
}

/** 成熟方案：一物多用——给用户看的方案 / 身份锁定 / 跨视图不变量 / 判图基准 */
export interface DesignSpec {
  narrative: string; // 给用户看的中文方案
  identity?: string; // 身份锁定串（基础信息 schema 的文字版）：尺寸/开口/各功能区位置/部件含数量/形状/材质/配色 hex/品牌占位——跨视图 + 跨次生成的一致性锚，每次生图强制前置
  invariants: string[]; // 跨视图不可变量（多视图一致性用）
  selfCheckCriteria: string; // 供 inspect 的客观判图要点（"输出 vs spec"）
  updatedAt: string;
}

export type LayoutZoneType = 'led' | 'stage' | 'brand' | 'reception' | 'meeting' | 'storage' | 'product' | 'plant' | 'aisle';
export type LayoutOpening = 'front' | 'back' | 'left' | 'right';

export interface BoothLayoutZone {
  name: string;
  type?: LayoutZoneType;
  x: number;
  y: number;
  w: number;
  h: number;
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

export interface ProjectState {
  id: string;
  brief: Record<string, unknown>; // Phase 1 用自由记录；强类型 BoothBrief 后续替换
  spec?: DesignSpec;
  layout?: LayoutDecision;
  assets: Asset[];
  attachments?: Attachment[];
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
export type AssetStatus = 'recommended' | 'ok' | 'weak' | 'failed';

export interface DeliverableAsset {
  assetId: string;
  url: string;
  role: AssetRole; // 主图 / 视角 / 候选 / 修订 / 平面图
  view?: string; // 视角名（role='view' 时），如 'left side' / 'top-down'
  status: AssetStatus; // recommended=首选 · ok=通过 · weak=一致性偏弱 · failed=未出图
  score?: number; // 判图分（质量或一致性）
}

export type DeliverableType = 'single' | 'view-set' | 'plan-conditioned' | 'revision';

export interface Deliverable {
  type: DeliverableType;
  assets: DeliverableAsset[]; // 本次产出的所有图
  recommendedId: string; // 默认展示/交付哪张的 assetId
  issues?: string[]; // 客观问题（弱视角 / 失败 / 预算截断…）
}
