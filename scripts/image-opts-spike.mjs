// 实测 gpt-image-2 经 Gateway OpenAI 兼容端点：① 1024+high+jpeg+压缩 的耗时/体积；② partial_images 流式是否支持。
// 运行：node --env-file .env.local scripts/image-opts-spike.mjs
import OpenAI from 'openai';
import { mkdirSync, writeFileSync } from 'node:fs';

const client = new OpenAI({
  apiKey: process.env.AI_GATEWAY_API_KEY,
  baseURL: 'https://ai-gateway.vercel.sh/v1',
});
mkdirSync('.data/spike', { recursive: true });
const BOOTH =
  'A modern tech exhibition booth, corner two-side-open layout, blue and white style, back wall with a large LED screen, reception counter, photorealistic 3D render, three-quarter wide-angle view.';

// ---------- [A] 1024 / quality=high / jpeg / output_compression ----------
console.log('[A] gpt-image-2  1024x1024 / quality=high / jpeg / compression=80 …');
try {
  const t = Date.now();
  const r = await client.images.generate({
    model: 'openai/gpt-image-2',
    prompt: BOOTH,
    size: '1024x1024',
    quality: 'high',
    output_format: 'jpeg',
    output_compression: 80,
    n: 1,
  });
  const b64 = r.data?.[0]?.b64_json ?? '';
  const buf = Buffer.from(b64, 'base64');
  const fmt =
    buf[0] === 0xff && buf[1] === 0xd8 ? 'JPEG' : buf[0] === 0x89 && buf[1] === 0x50 ? 'PNG' : 'other';
  writeFileSync('.data/spike/optA.jpg', buf);
  console.log(`[A] OK  ${Date.now() - t}ms  ${buf.length}B  实际格式=${fmt}`);
} catch (e) {
  console.error('[A] FAIL', String(e?.message || e).slice(0, 300));
}

// ---------- [B] 流式 partial_images=2 （raw fetch，看 Gateway 是否透传）----------
console.log('\n[B] 流式 stream:true, partial_images:2 …');
try {
  const t = Date.now();
  const resp = await fetch('https://ai-gateway.vercel.sh/v1/images/generations', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.AI_GATEWAY_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'openai/gpt-image-2',
      prompt: 'A simple modern tech booth, blue and white, 3D render.',
      size: '1024x1024',
      quality: 'low',
      stream: true,
      partial_images: 2,
    }),
  });
  console.log(`[B] HTTP ${resp.status}  content-type=${resp.headers.get('content-type')}`);
  if (!resp.ok) {
    console.error('[B] 错误体:', (await resp.text()).slice(0, 400));
  } else {
    let chunks = 0;
    let sawPartial = false;
    let sawFinal = false;
    let total = '';
    const reader = resp.body.getReader();
    const dec = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks++;
      const s = dec.decode(value, { stream: true });
      total += s;
      if (/partial/i.test(s)) sawPartial = true;
      if (/completed|"b64_json"|image\.generation\.completed/i.test(s)) sawFinal = true;
    }
    console.log(
      `[B] 流读完 ${Date.now() - t}ms  chunks=${chunks}  出现 partial 事件=${sawPartial ? '是 ✅' : '否'}  出现最终图=${sawFinal ? '是' : '否'}`,
    );
    console.log('[B] 流首 250 字符:', total.slice(0, 250).replace(/\s+/g, ' '));
  }
} catch (e) {
  console.error('[B] FAIL', String(e?.message || e).slice(0, 300));
}
console.log('\n=== image-opts spike 结束 ===');
