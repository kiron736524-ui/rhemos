// 端到端验证附件上传：生成真实 xlsx → 构造 file part → POST /api/agent → 看大脑能否读出表格内容。
// 验证 preprocessAttachments 的 xlsx 提取链路。运行：node scripts/attach-spike.mjs（需 dev server 在 3000）
import * as XLSX from 'xlsx';

const wb = XLSX.utils.book_new();
const ws = XLSX.utils.aoa_to_sheet([
  ['项目', '数值'],
  ['展台面积', '36平米'],
  ['预算', '18万元'],
  ['限高', '4.5米'],
]);
XLSX.utils.book_append_sheet(wb, ws, '需求表');
const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
const dataUrl = `data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,${buf.toString('base64')}`;

const body = {
  projectId: 'default',
  messages: [
    {
      id: 'u1',
      role: 'user',
      parts: [
        { type: 'text', text: '这是我的需求表。请只用一句话复述其中的预算和限高两个数字，确认你能读到附件内容即可，不要生图、不要调用任何工具。' },
        { type: 'file', mediaType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', filename: '需求表.xlsx', url: dataUrl },
      ],
    },
  ],
};

console.log('POST /api/agent（xlsx 附件，', buf.length, 'bytes）…');
const res = await fetch('http://localhost:3000/api/agent', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});
const text = await res.text();
let out = '';
for (const line of text.split('\n')) {
  if (!line.startsWith('data: ')) continue;
  const json = line.slice(6);
  if (json === '[DONE]') continue;
  try {
    const o = JSON.parse(json);
    if (o.type === 'text-delta') out += o.delta;
    if (o.type === 'error') console.error('流内错误：', o.errorText ?? json);
  } catch {
    /* 非 JSON 行忽略 */
  }
}
console.log('\n大脑回复：', out || '(空 — 见上方错误或下方原始片段)');
if (!out) console.log('原始前 600 字：', text.slice(0, 600));
console.log(/18\s*万/.test(out) && /4\.5\s*米/.test(out) ? '\n✅ 大脑正确读出了 xlsx 内容（18万 + 4.5米）' : '\n⚠️ 未在回复中检出预期数字，请人工核对');
