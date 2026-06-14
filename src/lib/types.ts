export type AssetKind = 'booth-image' | 'multiview' | 'reference';

export interface InspectionResult {
  pass: boolean;
  verdict: string; // 结构化批评文本（客观硬伤）
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

export interface ProjectState {
  id: string;
  brief: Record<string, unknown>; // Phase 1 用自由记录；强类型 BoothBrief 后续替换
  assets: Asset[];
  updatedAt: string;
}
