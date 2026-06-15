export type AssetKind = 'booth-image' | 'multiview' | 'reference';

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

/** 成熟方案：一物三用——给用户看的方案 / 跨视图不变量 / 判图基准 */
export interface DesignSpec {
  narrative: string; // 给用户看的中文方案
  invariants: string[]; // 跨视图不可变量（多视图一致性用）
  selfCheckCriteria: string; // 供 inspect 的客观判图要点（"输出 vs spec"）
  updatedAt: string;
}

export interface ProjectState {
  id: string;
  brief: Record<string, unknown>; // Phase 1 用自由记录；强类型 BoothBrief 后续替换
  spec?: DesignSpec;
  assets: Asset[];
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
