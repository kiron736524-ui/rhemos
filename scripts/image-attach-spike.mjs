// 区分上传图失败是"1x1 测试图太小"还是"图片链路系统 bug"：拿 .data 里真实展台 png 当上传附件。
// 运行：node scripts/image-attach-spike.mjs（需 dev server 在 3000）
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const pngPath = execSync("find .data -name '*.png' 2>/dev/null | head -1").toString().trim();
if (!pngPath) {
  console.log('没找到 .data 里的 png，跳过');
  process.exit(0);
}
const buf = readFileSync(pngPath);
console.log('用真实图：', pngPath, '(', buf.length, 'bytes )');
const dataUrl = `data:image/png;base64,${buf.toString('base64')}`;

const body = {
  projectId: 'default',
  messages: [
    {
      id: 'u1',
      role: 'user',
      parts: [
        { type: 'text', text: '请只用一句话描述这张图里是什么，不要生图、不要调用任何工具。' },
        { type: 'file', mediaType: 'image/png', filename: 'ref.png', url: dataUrl },
      ],
    },
  ],
};

const res = await fetch('http://localhost:3000/api/agent', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});
const text = await res.text();
let out = '';
let err = '';
for (const line of text.split('\n')) {
  if (!line.startsWith('data: ')) continue;
  const j = line.slice(6);
  if (j === '[DONE]') continue;
  try {
    const o = JSON.parse(j);
    if (o.type === 'text-delta') out += o.delta;
    if (o.type === 'error') err += o.errorText ?? JSON.stringify(o);
  } catch {
    /* ignore */
  }
}
console.log('\n大脑回复：', out || '(空)');
if (err) console.log('❌ 错误：', err);
else console.log(out ? '\n✅ 真实图可被大脑识别 → 图片上传链路正常，1x1 测试图只是太小被拒' : '');
