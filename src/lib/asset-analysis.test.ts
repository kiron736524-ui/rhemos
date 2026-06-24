import { describe, it, expect, afterAll } from 'vitest';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import { classifyAttachment, createBasicAssetAnalysis, selectUsableAttachmentsFromAnalyses, toRenderInputRefs } from './asset-analysis';
import { saveAttachment, saveAssetAnalysis, readAssetAnalysis, listAssetAnalyses, listAssetAnalysesForAttachment } from './storage';
import type { Attachment } from './types';

// 纯 lib 级测试：分类纯函数 + 写真实 .data（专用 projectId，测后清理）；不调模型 / 不需 key / 不联网。
const PID = `test-asset-analysis-${Date.now()}`;
const dirOf = (pid: string) => path.join(process.cwd(), '.data', 'projects', pid);
const DOCX_MT = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const XLSX_MT = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

describe('classifyAttachment（启发式分类，纯函数）', () => {
  it('logo 图片 → brand_logo', () => {
    expect(classifyAttachment({ filename: 'company-logo.png', mediaType: 'image/png' }).kind).toBe('brand_logo');
  });
  it('产品图 → product_image', () => {
    expect(classifyAttachment({ filename: '产品图-sku123.jpg', mediaType: 'image/jpeg' }).kind).toBe('product_image');
  });
  it('参考图 → style_reference', () => {
    expect(classifyAttachment({ filename: 'style-moodboard.png', mediaType: 'image/png' }).kind).toBe('style_reference');
  });
  it('平面图 → floor_plan', () => {
    expect(classifyAttachment({ filename: 'booth-floor-plan.png', mediaType: 'image/png' }).kind).toBe('floor_plan');
    expect(classifyAttachment({ filename: '平面布局.pdf', mediaType: 'application/pdf' }).kind).toBe('floor_plan');
  });
  it('pdf/docx/xlsx → document_brief', () => {
    expect(classifyAttachment({ filename: 'brief.pdf', mediaType: 'application/pdf' }).kind).toBe('document_brief');
    expect(classifyAttachment({ filename: 'requirements.docx', mediaType: DOCX_MT }).kind).toBe('document_brief');
    expect(classifyAttachment({ filename: 'data.xlsx', mediaType: XLSX_MT }).kind).toBe('document_brief');
  });
  it('未知文件 → unknown，usableForRender=false / role=other', () => {
    const img = classifyAttachment({ filename: 'IMG_2931.png', mediaType: 'image/png' });
    expect(img.kind).toBe('unknown');
    expect(img.usableForRender).toBe(false);
    expect(img.recommendedRole).toBe('other');
    const bin = classifyAttachment({ filename: 'data.bin', mediaType: 'application/octet-stream' });
    expect(bin.kind).toBe('unknown');
    expect(bin.usableForRender).toBe(false);
  });
});

describe('AssetAnalysis 存储 + 基础分析（D33）', () => {
  afterAll(async () => {
    await rm(dirOf(PID), { recursive: true, force: true });
    await rm(dirOf(`${PID}-sel`), { recursive: true, force: true });
  });

  it('save / read / list / listForAttachment 正常工作', async () => {
    const saved = await saveAssetAnalysis(PID, { attachmentId: 'att-x', kind: 'brand_logo', confidence: 75, summary: '品牌 Logo', recommendedRole: 'brand_logo', usableForRender: true });
    expect(saved.id).toMatch(/^analysis-/);
    expect(saved.createdAt).toBeTruthy();
    const read = await readAssetAnalysis(PID, saved.id);
    expect(read?.kind).toBe('brand_logo');
    expect(read?.attachmentId).toBe('att-x');
    const list = await listAssetAnalyses(PID, 50);
    expect(list.some((a) => a.id === saved.id)).toBe(true);
    const forAtt = await listAssetAnalysesForAttachment(PID, 'att-x');
    expect(forAtt.length).toBeGreaterThanOrEqual(1);
    expect(forAtt.every((a) => a.attachmentId === 'att-x')).toBe(true);
  });

  it('createBasicAssetAnalysis：文本文档 → document_brief 且 extractedText 截断到上限', async () => {
    const long = 'x'.repeat(25_000);
    const att = await saveAttachment(PID, new TextEncoder().encode(long), { filename: 'big-brief.txt', mediaType: 'text/plain' });
    const analysis = await createBasicAssetAnalysis(PID, att.id);
    expect(analysis.kind).toBe('document_brief');
    expect(analysis.usableForRender).toBe(true);
    expect(analysis.extractedText?.length).toBe(20_000); // MAX_EXTRACT_CHARS
  });

  it('createBasicAssetAnalysis 对不存在附件抛错（上传 route 须 catch，不阻断上传）', async () => {
    await expect(createBasicAssetAnalysis(PID, 'nonexistent-att')).rejects.toThrow();
    // saveAttachment 独立可用（分析失败不影响附件保存）
    const ok = await saveAttachment(PID, new Uint8Array([1, 2, 3]), { filename: 'ok.png', mediaType: 'image/png' });
    expect(ok.id).toBeTruthy();
  });

  it('selectUsableAttachmentsFromAnalyses：只选 usable + 有 role，按 attachmentId+role 去重', async () => {
    const spid = `${PID}-sel`;
    await saveAssetAnalysis(spid, { attachmentId: 'a1', kind: 'brand_logo', confidence: 70, summary: 's', recommendedRole: 'brand_logo', usableForRender: true });
    await saveAssetAnalysis(spid, { attachmentId: 'a1', kind: 'brand_logo', confidence: 70, summary: 's2', recommendedRole: 'brand_logo', usableForRender: true }); // 重复
    await saveAssetAnalysis(spid, { attachmentId: 'a2', kind: 'unknown', confidence: 30, summary: 's', recommendedRole: 'other', usableForRender: false }); // 不可用
    const refs = await selectUsableAttachmentsFromAnalyses(spid);
    expect(refs.map((r) => r.attachmentId)).toContain('a1');
    expect(refs.map((r) => r.attachmentId)).not.toContain('a2');
    expect(refs.filter((r) => r.attachmentId === 'a1')).toHaveLength(1); // 去重
  });

  it('toRenderInputRefs：转 attachment refs、丢弃不存在附件、document_brief→other', () => {
    const atts: Attachment[] = [{ id: 'a1', kind: 'image', filename: 'logo.png', mediaType: 'image/png', size: 1, path: 'p', url: '/u', createdAt: 't' }];
    const refs = toRenderInputRefs([{ attachmentId: 'a1', role: 'brand_logo' }, { attachmentId: 'missing', role: 'other' }], atts);
    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({ id: 'a1', kind: 'attachment', role: 'brand_logo' });
    const docRefs = toRenderInputRefs([{ attachmentId: 'a1', role: 'document_brief' }], atts);
    expect(docRefs[0].role).toBe('other');
  });
});
