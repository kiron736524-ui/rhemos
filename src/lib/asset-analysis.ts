import mammoth from 'mammoth';
import ExcelJS from 'exceljs';
import { listAssetAnalyses, loadAttachment, saveAssetAnalysis } from './storage';
import type { Attachment, AssetAnalysis, AssetAnalysisKind, AttachmentRole, AttachmentUseRef, RenderInputRef, RenderInputRefRole } from './types';

// 基础素材分析（D33）：**不调 vision / 不 OCR / 不调外部模型**。
// 只做：① 按文件名 + mediaType 启发式分类；② docx/xlsx/文本 轻量提取（限长）。
// 图片 / PDF 只做 metadata summary，留作未来 vision 分析（analyze_reference）的入口。
const MAX_EXTRACT_CHARS = 20_000; // extractedText 上限，防 state/snapshot 爆炸

const RE = {
  floor: /plan|layout|floor|平面|布局|cad/i,
  logo: /logo|标志|商标|品牌|brand/i,
  product: /product|产品|设备|样机|展品|sku/i,
  style: /style|reference|moodboard|mood|参考|风格|样板|调性/i,
};

const isImageType = (mediaType: string) => mediaType.startsWith('image/');
const isDocType = (mediaType: string, filename: string) =>
  mediaType.startsWith('text/') || /pdf|wordprocessingml|spreadsheetml/.test(mediaType) || /\.(pdf|docx?|xlsx?|txt|csv|md)$/i.test(filename);

export interface BasicClassification {
  kind: AssetAnalysisKind;
  recommendedRole?: AttachmentRole;
  usableForRender: boolean;
  confidence: number;
}

/**
 * 纯函数启发式分类（可单测）。优先级：floor_plan 关键词 → 图片角色关键词 → 文档 → 未知。
 * 未知 → usableForRender=false、role='other'（避免把语义不明的素材自动塞进生图输入）。
 */
export function classifyAttachment(input: { filename: string; mediaType: string }): BasicClassification {
  const name = input.filename || '';
  const mt = input.mediaType || '';
  if (RE.floor.test(name)) return { kind: 'floor_plan', recommendedRole: 'floor_plan', usableForRender: true, confidence: 70 };
  if (isImageType(mt)) {
    if (RE.logo.test(name)) return { kind: 'brand_logo', recommendedRole: 'brand_logo', usableForRender: true, confidence: 75 };
    if (RE.product.test(name)) return { kind: 'product_image', recommendedRole: 'product_image', usableForRender: true, confidence: 70 };
    if (RE.style.test(name)) return { kind: 'style_reference', recommendedRole: 'style_reference', usableForRender: true, confidence: 70 };
    return { kind: 'unknown', recommendedRole: 'other', usableForRender: false, confidence: 30 };
  }
  if (isDocType(mt, name)) return { kind: 'document_brief', recommendedRole: 'document_brief', usableForRender: true, confidence: 60 };
  return { kind: 'unknown', recommendedRole: 'other', usableForRender: false, confidence: 25 };
}

/** ExcelJS 单元格 → 字符串（对象类跳过，避免 [object Object]）。 */
const cell = (v: unknown): string => {
  if (v == null) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    const o = v as { text?: unknown; result?: unknown };
    return typeof o.text === 'string' ? o.text : o.result != null ? String(o.result) : '';
  }
  return String(v);
};

/** docx / xlsx / 纯文本 轻量提取（限长）；pdf / 图片不提取（不 OCR）。失败返回 warning，不抛。 */
async function extractText(attachment: Attachment, bytes: Uint8Array): Promise<{ text?: string; warning?: string }> {
  const name = attachment.filename.toLowerCase();
  const mt = attachment.mediaType;
  try {
    if (mt.startsWith('text/') || /\.(txt|csv|md)$/i.test(name)) {
      return { text: Buffer.from(bytes).toString('utf8').slice(0, MAX_EXTRACT_CHARS) };
    }
    if (mt.includes('wordprocessingml') || /\.docx?$/i.test(name)) {
      const { value } = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
      return { text: value.trim().slice(0, MAX_EXTRACT_CHARS) };
    }
    if (mt.includes('spreadsheetml') || /\.xlsx?$/i.test(name)) {
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(Buffer.from(bytes) as unknown as ArrayBuffer);
      const lines: string[] = [];
      for (const ws of wb.worksheets.slice(0, 10)) {
        ws.eachRow({ includeEmpty: false }, (row) => {
          lines.push((row.values as unknown[]).slice(1).map(cell).join(','));
        });
      }
      return { text: lines.join('\n').slice(0, MAX_EXTRACT_CHARS) };
    }
  } catch (e) {
    return { warning: `文本提取失败：${e instanceof Error ? e.message : '未知错误'}` };
  }
  return {}; // pdf / 图片：仅 metadata summary
}

const KIND_LABEL: Record<AssetAnalysisKind, string> = {
  brand_logo: '品牌 Logo',
  product_image: '产品图',
  style_reference: '风格参考图',
  floor_plan: '平面 / 布局图',
  document_brief: '需求文档',
  unknown: '未识别素材',
};

function buildSummary(attachment: Attachment, cls: BasicClassification, text?: string): string {
  const head = `${isImageType(attachment.mediaType) ? '图片' : '文件'}「${attachment.filename}」识别为${KIND_LABEL[cls.kind]}（置信 ${cls.confidence}）`;
  return text ? `${head}；已提取文本约 ${text.length} 字` : head;
}

/**
 * 对一个已保存的 attachment 生成基础分析并落盘。
 * 调用方（上传 route）应 try/catch——分析失败绝不阻断上传。
 */
export async function createBasicAssetAnalysis(projectId: string, attachmentId: string): Promise<AssetAnalysis> {
  const { attachment, bytes } = await loadAttachment(projectId, attachmentId);
  const cls = classifyAttachment({ filename: attachment.filename, mediaType: attachment.mediaType });
  const warnings: string[] = [];
  const { text, warning } = await extractText(attachment, bytes);
  if (warning) warnings.push(warning);
  if (cls.kind === 'unknown') warnings.push('无法从文件名/类型判断用途，建议人工指定角色');
  return saveAssetAnalysis(projectId, {
    attachmentId,
    kind: cls.kind,
    confidence: cls.confidence,
    summary: buildSummary(attachment, cls, text),
    extractedText: text,
    recommendedRole: cls.recommendedRole,
    usableForRender: cls.usableForRender,
    warnings: warnings.length ? warnings : undefined,
  });
}

/**
 * 从分析推导"可用于生图输入"的素材引用：每个 attachment 取最新一条分析，
 * 选 usableForRender 且有 recommendedRole 的，转成 AttachmentUseRef（按 attachmentId+role 去重）。
 * render 在 ProjectState.selectedAttachments 为空时 fallback 用它填充快照 refs / sourceAttachmentIds。
 */
export async function selectUsableAttachmentsFromAnalyses(projectId: string): Promise<AttachmentUseRef[]> {
  const analyses = await listAssetAnalyses(projectId, 1000); // 已按 updatedAt 倒序
  const seenAtt = new Set<string>();
  const seenKey = new Set<string>();
  const refs: AttachmentUseRef[] = [];
  for (const a of analyses) {
    if (seenAtt.has(a.attachmentId)) continue; // 同一 attachment 只用最新分析
    seenAtt.add(a.attachmentId);
    if (!a.usableForRender || !a.recommendedRole) continue;
    const key = `${a.attachmentId}::${a.recommendedRole}`;
    if (seenKey.has(key)) continue;
    seenKey.add(key);
    refs.push({ attachmentId: a.attachmentId, role: a.recommendedRole, reason: a.summary });
  }
  return refs;
}

/** AttachmentRole → RenderInputRef.role（snapshot 只认这几种 role；document_brief/material_reference/other → 'other'）。 */
const toRefRole = (r: AttachmentRole): RenderInputRefRole =>
  r === 'brand_logo' || r === 'product_image' || r === 'style_reference' || r === 'floor_plan' ? r : 'other';

/**
 * 把 selectedAttachments 转成 RenderInputSnapshot 的 attachment refs（render / revise 共用）。
 * 只产出轻量引用（url/path/filename/mediaType/role），**不含 base64**；引用不存在的附件被丢弃。
 * 注意：document_brief 只作追踪 ref，render 不会把它当图像 bytes 传给 provider。
 */
export function toRenderInputRefs(selected: AttachmentUseRef[], attachments: Attachment[]): RenderInputRef[] {
  const byId = new Map(attachments.map((a) => [a.id, a]));
  const out: RenderInputRef[] = [];
  for (const x of selected) {
    const a = byId.get(x.attachmentId);
    if (a) out.push({ id: a.id, kind: 'attachment', role: toRefRole(x.role), filename: a.filename, mediaType: a.mediaType, url: a.url, path: a.path, note: x.reason });
  }
  return out;
}
