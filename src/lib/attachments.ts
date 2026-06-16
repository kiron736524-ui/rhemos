import mammoth from 'mammoth';
import ExcelJS from 'exceljs';
import type { UIMessage } from 'ai';
import { loadAttachment } from './storage';

// 附件预处理：图片/PDF 是 Opus 4.8 原生支持（原样传）；docx/xlsx 模型不能直接读，
// 在服务端提取成文字（docx 还提取内嵌图）后注入消息，让大脑能识别。
// xlsx 解析用 ExcelJS（活跃维护、无已知 high CVE）——曾用的 `xlsx`(SheetJS npm 版) 有原型污染 + ReDoS 高危且官方不再修。
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const XLSX_MT = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

// 上传门限（防内存爆 / 模型上下文爆 / ReDoS 路径不可达）。正常文档远低于这些值。
const MAX_ATTACH_BYTES = 20 * 1024 * 1024; // 单个待解析附件 20MB 上限
const MAX_TEXT_CHARS = 200_000; // 单附件提取文本上限（约束注入上下文的体量）
const MAX_SHEETS = 30; // 最多解析的工作表数
const MAX_ROWS_PER_SHEET = 5000; // 每个工作表最多解析行数
const MAX_EMBEDDED_IMAGES = 24; // docx 最多提取的内嵌图数

type AnyPart = { type?: string; mediaType?: string; url?: string; filename?: string; text?: string };

function dataUrlToBuffer(url: string): Buffer | null {
  const i = url.indexOf('base64,');
  if (!url.startsWith('data:') || i < 0) return null;
  return Buffer.from(url.slice(i + 7), 'base64');
}

function attachmentIdFromUrl(url: string, projectId: string): string | null {
  const m = url.match(/^\/api\/projects\/([\w-]+)\/attachments\/([\w-]+)/);
  if (!m || m[1] !== projectId) return null;
  return m[2];
}

const toDataUrl = (mediaType: string, buf: Buffer) => `data:${mediaType};base64,${buf.toString('base64')}`;
const mb = (n: number) => (n / (1024 * 1024)).toFixed(1);

async function extractDocx(buf: Buffer, name: string): Promise<AnyPart[]> {
  const out: AnyPart[] = [];
  const images: AnyPart[] = [];
  const { value: raw } = await mammoth.extractRawText({ buffer: buf });
  let text = raw.trim();
  const textTrunc = text.length > MAX_TEXT_CHARS;
  if (textTrunc) text = text.slice(0, MAX_TEXT_CHARS);
  try {
    await mammoth.convertToHtml(
      { buffer: buf },
      {
        convertImage: mammoth.images.imgElement(async (image) => {
          if (images.length < MAX_EMBEDDED_IMAGES) {
            const b64 = await image.read('base64');
            images.push({ type: 'file', mediaType: image.contentType, url: `data:${image.contentType};base64,${b64}` });
          }
          return { src: '' }; // 只收集图片，不需要 HTML 输出
        }),
      },
    );
  } catch {
    /* 图片提取失败不致命 */
  }
  out.push({ type: 'text', text: `【Word 文档「${name}」提取的文字${textTrunc ? '，已按上限截断' : ''}】\n${text || '(无可提取文字)'}` });
  if (images.length) out.push({ type: 'text', text: `【该文档含 ${images.length} 张内嵌图（上限 ${MAX_EMBEDDED_IMAGES}），已附在下方供识别】`, }, ...images);
  return out;
}

/** ExcelJS 单元格值 → 字符串（处理日期 / 超链接 / 富文本 / 公式结果 / 错误）。 */
function cellToStr(v: unknown): string {
  if (v == null) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if (typeof o.text === 'string') return o.text; // hyperlink
    if (Array.isArray(o.richText)) return (o.richText as Array<{ text?: string }>).map((t) => t.text ?? '').join('');
    if (o.result != null) return String(o.result); // 公式结果
    if (o.error != null) return String(o.error);
    return '';
  }
  return String(v);
}

const csvCell = (s: string): string => (/[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

async function extractXlsx(buf: Buffer, name: string): Promise<AnyPart[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  const sheets = wb.worksheets;
  const chunks: string[] = [];
  let truncated = false;
  for (const ws of sheets.slice(0, MAX_SHEETS)) {
    const lines: string[] = [];
    let n = 0;
    ws.eachRow({ includeEmpty: false }, (row) => {
      if (n >= MAX_ROWS_PER_SHEET) {
        truncated = true;
        return;
      }
      const vals = (row.values as unknown[]).slice(1).map((c) => csvCell(cellToStr(c))); // values[0] 是占位
      lines.push(vals.join(','));
      n++;
    });
    chunks.push(`## 工作表：${ws.name}\n${lines.join('\n')}`);
  }
  if (sheets.length > MAX_SHEETS) {
    chunks.push(`（共 ${sheets.length} 个工作表，仅提取前 ${MAX_SHEETS} 个）`);
    truncated = true;
  }
  let body = chunks.join('\n\n');
  if (body.length > MAX_TEXT_CHARS) {
    body = body.slice(0, MAX_TEXT_CHARS);
    truncated = true;
  }
  return [{ type: 'text', text: `【Excel「${name}」提取内容（CSV）${truncated ? '，已按上限截断' : ''}】\n${body}` }];
}

async function filePartBuffer(part: AnyPart, projectId: string): Promise<{ buf: Buffer; mediaType: string; filename: string } | null> {
  if (!part.url) return null;
  const fromData = dataUrlToBuffer(part.url);
  if (fromData) return { buf: fromData, mediaType: part.mediaType ?? 'application/octet-stream', filename: part.filename ?? 'attachment' };
  const attachmentId = attachmentIdFromUrl(part.url, projectId);
  if (!attachmentId) return null;
  const { attachment, bytes } = await loadAttachment(projectId, attachmentId);
  return {
    buf: Buffer.from(bytes),
    mediaType: attachment.mediaType,
    filename: attachment.filename,
  };
}

export async function preprocessAttachments(messages: UIMessage[], projectId = 'default'): Promise<UIMessage[]> {
  return Promise.all(
    messages.map(async (msg) => {
      const parts = (msg as { parts?: AnyPart[] }).parts;
      if (!Array.isArray(parts)) return msg;
      const newParts: AnyPart[] = [];
      for (const part of parts) {
        const lower = part.filename?.toLowerCase() ?? '';
        const isDocx = part.type === 'file' && (part.mediaType === DOCX || lower.endsWith('.docx'));
        const isXlsx = part.type === 'file' && (part.mediaType === XLSX_MT || lower.endsWith('.xlsx') || lower.endsWith('.xls'));
        if (part.type === 'file' && part.url) {
          const loaded = await filePartBuffer(part, projectId);
          const buf = loaded?.buf ?? null;
          if (!buf) {
            newParts.push(part);
            continue;
          }
          if (buf.length > MAX_ATTACH_BYTES) {
            newParts.push({ type: 'text', text: `【附件「${part.filename}」约 ${mb(buf.length)}MB，超过 ${mb(MAX_ATTACH_BYTES)}MB 上限，未解析】` });
            continue;
          }
          try {
            if (isDocx || loaded?.filename.toLowerCase().endsWith('.docx')) {
              newParts.push(...(await extractDocx(buf, loaded?.filename ?? part.filename ?? 'document.docx')));
            } else if (isXlsx || loaded?.filename.toLowerCase().endsWith('.xlsx') || loaded?.filename.toLowerCase().endsWith('.xls')) {
              newParts.push(...(await extractXlsx(buf, loaded?.filename ?? part.filename ?? 'sheet.xlsx')));
            } else if (loaded && !part.url.startsWith('data:')) {
              // 对话里只存轻量附件 URL；发给模型前临时还原为 data URL。图片/PDF 仍走多模态原生识别。
              newParts.push({ ...part, mediaType: loaded.mediaType, filename: loaded.filename, url: toDataUrl(loaded.mediaType, buf) });
            } else {
              newParts.push(part);
            }
          } catch (e) {
            newParts.push({ type: 'text', text: `【附件「${part.filename}」解析失败：${e instanceof Error ? e.message : '未知错误'}】` });
          }
        } else {
          newParts.push(part); // 图片 / PDF / 文本：模型原生支持，原样
        }
      }
      return { ...msg, parts: newParts } as UIMessage;
    }),
  );
}
