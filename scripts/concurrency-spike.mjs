// 并发 spike：同时打 N 张 gpt-image-2，量"并行墙钟 vs 单张耗时"，判断 Gateway 是否真并发。
// 运行：node --env-file .env.local scripts/concurrency-spike.mjs
import { generateImage } from 'ai';
import { gateway } from '@ai-sdk/gateway';

const N = 4;
const prompt = (i) =>
  `A modern exhibition booth concept, design variation ${i}, blue and white tech style, one open side facing the aisle, a back wall with a large display screen, a reception counter, photorealistic 3D render.`;

console.log(`并发测试：同时发起 ${N} 张 gpt-image-2 (1024x1024)…\n`);
const t0 = Date.now();
const results = await Promise.allSettled(
  Array.from({ length: N }, (_, i) => {
    const s = Date.now();
    return generateImage({
      model: gateway.imageModel('openai/gpt-image-2'),
      prompt: prompt(i),
      size: '1024x1024',
    })
      .then((r) => ({ i, ok: true, ms: Date.now() - s, bytes: r.image.uint8Array.length }))
      .catch((e) => ({ i, ok: false, ms: Date.now() - s, err: String(e?.message || e).slice(0, 180) }));
  }),
);
const wall = Date.now() - t0;
const rows = results.map((r) => (r.status === 'fulfilled' ? r.value : { ok: false, ms: 0, err: String(r.reason) }));
for (const r of rows) {
  console.log(r.ok ? `  #${r.i}  OK   ${r.ms}ms  ${r.bytes}B` : `  #${r.i}  FAIL ${r.ms}ms  ${r.err}`);
}
const oks = rows.filter((r) => r.ok);
const times = oks.map((r) => r.ms);
const maxSingle = times.length ? Math.max(...times) : 0;
const sumSingle = times.reduce((a, b) => a + b, 0);
console.log(`\n并发 ${N} 张：墙钟 ${wall}ms；成功 ${oks.length}/${N}`);
if (times.length) {
  console.log(
    `单张 min/avg/max = ${Math.min(...times)} / ${Math.round(sumSingle / times.length)} / ${maxSingle} ms`,
  );
  const ratio = wall / maxSingle;
  console.log(
    `\n判定：墙钟/最慢单张 = ${ratio.toFixed(2)}  →  ${
      ratio < 1.4 ? '✅ 真并发（墙钟≈最慢单张，N 张几乎不增时间）' : ratio > 2.5 ? '⚠️ 偏串行/被限流' : '部分并发/轻微排队'
    }`,
  );
  console.log(`（若串行，墙钟应≈各张之和 ${sumSingle}ms）`);
}
