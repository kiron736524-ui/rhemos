import mammoth from 'mammoth';
import * as XLSX from 'xlsx';
import type { UIMessage } from 'ai';

// 附件预处理：图片/PDF 是 Opus 4.8 原生支持（原样传）；docx/xlsx 模型不能直接读，
// 在服务端提取成文字（docx 还提取内嵌图）后注入消息，让大脑能识别。
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const XLSX_MT = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

type AnyPart = { type?: string; mediaType?: string; url?: string; filename?: string; text?: string };

function dataUrlToBuffer(url: string): Buffer | null {
  const i = url.indexOf('base64,');
  if (!url.startsWith('data:') || i < 0) return null;
  return Buffer.from(url.slice(i + 7), 'base64');
}

async function extractDocx(buf: Buffer, name: string): Promise<AnyPart[]> {
  const out: AnyPart[] = [];
  const images: AnyPart[] = [];
  const { value: text } = await mammoth.extractRawText({ buffer: buf });
  try {
    await mammoth.convertToHtml(
      { buffer: buf },
      {
        convertImage: mammoth.images.imgElement(async (image) => {
          const b64 = await image.read('base64');
          images.push({ type: 'file', mediaType: image.contentType, url: `data:${image.contentType};base64,${b64}` });
          return { src: '' }; // 只收集图片，不需要 HTML 输出
        }),
      },
    );
  } catch {
    /* 图片提取失败不致命 */
  }
  out.push({ type: 'text', text: `【Word 文档「${name}」提取的文字】\n${text.trim() || '(无可提取文字)'}` });
  if (images.length) out.push({ type: 'text', text: `【该文档含 ${images.length} 张内嵌图，已附在下方供识别】` }, ...images);
  return out;
}

function extractXlsx(buf: Buffer, name: string): AnyPart[] {
  const wb = XLSX.read(buf, { type: 'buffer' });
  const body = wb.SheetNames.map((n) => `## 工作表：${n}\n${XLSX.utils.sheet_to_csv(wb.Sheets[n]).trim()}`).join('\n\n');
  return [{ type: 'text', text: `【Excel「${name}」提取内容（CSV）】\n${body}` }];
}

export async function preprocessAttachments(messages: UIMessage[]): Promise<UIMessage[]> {
  return Promise.all(
    messages.map(async (msg) => {
      const parts = (msg as { parts?: AnyPart[] }).parts;
      if (!Array.isArray(parts)) return msg;
      const newParts: AnyPart[] = [];
      for (const part of parts) {
        const lower = part.filename?.toLowerCase() ?? '';
        const isDocx = part.type === 'file' && (part.mediaType === DOCX || lower.endsWith('.docx'));
        const isXlsx = part.type === 'file' && (part.mediaType === XLSX_MT || lower.endsWith('.xlsx') || lower.endsWith('.xls'));
        if ((isDocx || isXlsx) && part.url) {
          const buf = dataUrlToBuffer(part.url);
          if (!buf) {
            newParts.push(part);
            continue;
          }
          try {
            newParts.push(
              ...(isDocx ? await extractDocx(buf, part.filename ?? 'document.docx') : extractXlsx(buf, part.filename ?? 'sheet.xlsx')),
            );
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
