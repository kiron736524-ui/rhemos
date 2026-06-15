// 端到端验证 generate_views 算法：主图 best-of-N 择优 → identity + 进化式参考链 + 判图门控 出多视角。
// 运行：node --env-file .env.local scripts/pipeline-spike.mjs
import OpenAI from 'openai';
import { generateText, generateObject } from 'ai';
import { gateway } from '@ai-sdk/gateway';
import { z } from 'zod';
import { mkdirSync, writeFileSync } from 'node:fs';

const oa = new OpenAI({ apiKey: process.env.AI_GATEWAY_API_KEY, baseURL: 'https://ai-gateway.vercel.sh/v1' });
const judge = gateway.languageModel('anthropic/claude-sonnet-4.6');
const DIR = '.data/spike/pipeline';
mkdirSync(DIR, { recursive: true });
const t = () => Date.now();
const b64buf = (r) => Buffer.from(r.data?.[0]?.b64_json ?? '', 'base64');
const fileImg = (r) => (r.files || []).find((f) => f.mediaType?.startsWith('image/'));
const GATE = 70;

const STYLE =
  'photorealistic professional architectural visualization, V-Ray/Corona-grade PBR materials, realistic global illumination, soft shadows and reflections — NOT a cartoon, illustration, flat diagram or sketch.';
const IDENTITY = `SAME BOOTH IDENTITY (identical in every view): 10x8m corner booth, two-sides-open L layout (aisle front+left, closed back+right). Pure white powder-coated shells, technology-blue accents, dark gray reflective floor, dark hall. Fixed parts: back LED wall with deep-blue particle globe + hexagonal logo + slogan band; one tall white pillar at left-front with hexagonal logo + blue light strip; ONE L-shaped white-blue reception counter front-center-right with hexagonal logo; EXACTLY ONE round table with FOUR white armchairs on the left + one potted plant at left entry; right side wall-embedded curved 3-shelf blue-edge rack + white cabinets below; top black perimeter truss + central rectangular white light frame. Cool white 5000K. Hexagonal logo placeholder only.`;

// ① 主图 best-of-N (gpt-image-2, medium)
console.log('① 主图 best-of-N (n=2, medium)…');
let s = t();
const frontPrompt = `${IDENTITY}\n\n3D rendering, front three-quarter wide-angle view of the booth from the main aisle.\n\n${STYLE}`;
const heroCands = (await Promise.all([1, 2].map(async () => {
  const r = await oa.images.generate({ model: 'openai/gpt-image-2', prompt: frontPrompt, size: '1024x1024', quality: 'medium', n: 1 });
  return b64buf(r);
}))).filter((b) => b.length);
const heroSchema = z.object({ score: z.number(), fails: z.array(z.string()) });
const heroJudged = await Promise.all(heroCands.map(async (buf) => {
  const { object } = await generateObject({ model: judge, schema: heroSchema, messages: [{ role: 'user', content: [{ type: 'text', text: '客观判这张展台效果图：score 0-100 + fails 硬伤数组。' }, { type: 'image', image: buf }] }] });
  return { buf, ...object };
}));
heroJudged.sort((a, b) => a.fails.length - b.fails.length || b.score - a.score);
const hero = heroJudged[0];
writeFileSync(`${DIR}/0_hero.png`, hero.buf);
console.log(`① 主图 ok ${t() - s}ms score=${hero.score} (候选 ${heroCands.length})`);

// ② 进化式参考链 + 判图门控
const consSchema = z.object({ consistencyScore: z.number(), sameBooth: z.boolean(), drift: z.array(z.string()) });
const pool = [new Uint8Array(hero.buf)];
const views = [['left', 'a pure straight-on LEFT side view'], ['right', 'a pure straight-on RIGHT side view'], ['top', 'a true top-down orthographic floor plan view']];
const summary = [{ view: 'front(hero)', score: hero.score, pass: true }];
for (const [label, view] of views) {
  s = t();
  const instruction = `${IDENTITY}\n\nUsing the attached reference image(s) of THIS exact booth, render the SAME booth from ${view}. Keep every part, material, color, brand placement, furniture COUNT and lighting identical to the reference(s); only the camera viewpoint changes — do not add/remove/redesign anything.\n\n${STYLE}`;
  const cands = (await Promise.all([1, 2].map(async () => {
    try {
      const r = await generateText({ model: gateway.languageModel('google/gemini-3-pro-image'), messages: [{ role: 'user', content: [{ type: 'text', text: instruction }, ...pool.map((image) => ({ type: 'image', image }))] }] });
      const f = fileImg(r);
      return f ? Buffer.from(f.uint8Array) : null;
    } catch (e) { console.error(`  [${label}] gen FAIL`, String(e?.message || e).slice(0, 120)); return null; }
  }))).filter(Boolean);
  if (!cands.length) { console.log(`[${label}] 无图返回`); summary.push({ view, score: 0, pass: false }); continue; }
  const judged = await Promise.all(cands.map(async (buf) => {
    const { object } = await generateObject({ model: judge, schema: consSchema, messages: [{ role: 'user', content: [{ type: 'text', text: `第1张原展台主图，第2张应是同一展台的${view}。consistencyScore 0-100(同一展台程度) + sameBooth + drift(漂移部件)。` }, { type: 'image', image: hero.buf }, { type: 'image', image: buf }] }] });
    return { buf, ...object };
  }));
  judged.sort((a, b) => b.consistencyScore - a.consistencyScore);
  const best = judged[0];
  writeFileSync(`${DIR}/${label}.png`, best.buf);
  const passed = best.sameBooth && best.consistencyScore >= GATE;
  if (passed) pool.push(new Uint8Array(best.buf));
  console.log(`[${label}] ok ${t() - s}ms score=${best.consistencyScore} ${passed ? '✓进参考池' : '✗未过门控'} drift=${best.drift.length} poolSize=${pool.length}`);
  summary.push({ view, score: best.consistencyScore, pass: passed });
}
console.log('\n=== 全套视角一致性 ===');
for (const r of summary) console.log(`  ${r.pass ? '✓' : '✗'} ${r.view}: ${r.score}`);
console.log(`图在 ${DIR}/`);
