// 验证 ExcelJS 往返 + attachments.ts 的单元格转换逻辑（替换高危 xlsx 后的回归）。
// 跑：node scripts/attach-xlsx-spike.mjs
import ExcelJS from 'exceljs';

// —— 复刻 attachments.ts 的转换逻辑（保持同步）——
function cellToStr(v) {
  if (v == null) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    if (typeof v.text === 'string') return v.text;
    if (Array.isArray(v.richText)) return v.richText.map((t) => t.text ?? '').join('');
    if (v.result != null) return String(v.result);
    if (v.error != null) return String(v.error);
    return '';
  }
  return String(v);
}
const csvCell = (s) => (/[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

// —— 造一个含各种单元格类型的工作簿 ——
const wb = new ExcelJS.Workbook();
const ws = wb.addWorksheet('展位需求');
ws.addRow(['字段', '值', '备注']);
ws.addRow(['面积', '12×15m', '含逗号,测转义']);
ws.addRow(['墙高(m)', 4, '数字']);
ws.addRow(['交付日期', new Date('2026-06-15'), '日期']);
ws.addRow(['总价', { formula: 'B3*1000', result: 4000 }, '公式']);
ws.getCell('B7').value = { text: '官网', hyperlink: 'https://example.com' };
ws.getCell('A7').value = '链接';
ws.getCell('B8').value = { richText: [{ text: '中国' }, { text: '石化' }] };
ws.getCell('A8').value = '富文本';
const ws2 = wb.addWorksheet('第二表');
ws2.addRow(['x', 'y']);

// 往返：writeBuffer → Node Buffer（模拟 dataUrlToBuffer 产物）→ load
const ab = await wb.xlsx.writeBuffer();
const buf = Buffer.from(ab);
console.log(`writeBuffer → Node Buffer: ${buf.length} bytes`);

const wb2 = new ExcelJS.Workbook();
await wb2.xlsx.load(buf);
console.log(`worksheets: ${wb2.worksheets.map((w) => w.name).join(' / ')}`);

for (const sheet of wb2.worksheets) {
  console.log(`\n## 工作表：${sheet.name}`);
  sheet.eachRow({ includeEmpty: false }, (row) => {
    const vals = row.values.slice(1).map((c) => csvCell(cellToStr(c)));
    console.log(vals.join(','));
  });
}
console.log('\n✓ ExcelJS 往返 + 各类单元格转换 OK');
