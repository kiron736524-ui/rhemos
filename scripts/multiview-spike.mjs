// 多视图实测：A 分视角(图像条件化 images.edit) vs B 单图 2x2 turnaround sheet，谁更一致。
// 运行：node --env-file .env.local scripts/multiview-spike.mjs
import OpenAI, { toFile } from 'openai';
import { generateObject } from 'ai';
import { gateway } from '@ai-sdk/gateway';
import { z } from 'zod';
import { mkdirSync, writeFileSync } from 'node:fs';

const client = new OpenAI({ apiKey: process.env.AI_GATEWAY_API_KEY, baseURL: 'https://ai-gateway.vercel.sh/v1' });
const DIR = '.data/spike/mv';
mkdirSync(DIR, { recursive: true });

const BOOTH =
  'a corner (two-side-open, L-shaped) technology exhibition booth: pure white structure with technology-blue light accents, a large LED video wall on the long back wall, a blue-and-white reception counter at the corner entrance, product display shelves along the right wall, ground-supported truss with a rectangular light frame on top, dark reflective floor';

const b64ToBuf = (r) => Buffer.from(r.data?.[0]?.b64_json ?? '', 'base64');
const t = () => Date.now();

// ---------- 0) hero 主图 ----------
console.log('[hero] 生成主图 (1024, medium)…');
let hero;
{
  const s = t();
  const r = await client.images.generate({
    model: 'openai/gpt-image-2',
    prompt: `3D rendering, three-quarter wide-angle view of ${BOOTH}. Photorealistic, dark exhibition hall background.`,
    size: '1024x1024',
    quality: 'medium',
  });
  hero = b64ToBuf(r);
  writeFileSync(`${DIR}/hero.png`, hero);
  console.log(`[hero] ok ${t() - s}ms ${hero.length}B`);
}

// ---------- A) 图像条件化分视角 + B) 单图 sheet（并行）----------
console.log('[A/B] 并行：A 左视/背视(images.edit 参考 hero) + B 四宫格 sheet…');
const editView = async (label, view) => {
  const s = t();
  const r = await client.images.edit({
    model: 'openai/gpt-image-2',
    image: await toFile(hero, 'hero.png', { type: 'image/png' }),
    prompt: `The SAME exhibition booth shown in the reference image, now rendered from ${view}. Keep identical structure, layout, materials, colors, brand positions and lighting — only the camera viewpoint changes. Photorealistic 3D render.`,
    size: '1024x1024',
    quality: 'medium',
  });
  const buf = b64ToBuf(r);
  writeFileSync(`${DIR}/A_${label}.png`, buf);
  console.log(`[A:${label}] ok ${t() - s}ms ${buf.length}B`);
  return buf;
};
const sheet = async () => {
  const s = t();
  const r = await client.images.generate({
    model: 'openai/gpt-image-2',
    prompt: `A single turnaround sheet image, 2x2 grid of four labeled panels, all showing the SAME ONE booth (${BOOTH}): top-left = front three-quarter view, top-right = left side view, bottom-left = right side view, bottom-right = top-down orthographic floor plan. Identical structure/materials/colors/brand/lighting across all four panels. Clean panel labels, neutral background.`,
    size: '1536x1024',
    quality: 'medium',
  });
  const buf = b64ToBuf(r);
  writeFileSync(`${DIR}/B_sheet.png`, buf);
  console.log(`[B:sheet] ok ${t() - s}ms ${buf.length}B`);
  return buf;
};
const [aLeft, aBack, bSheet] = await Promise.all([
  editView('left', 'the LEFT side').catch((e) => (console.error('[A:left] FAIL', String(e?.message || e).slice(0, 200)), null)),
  editView('back', 'directly BEHIND (rear view)').catch((e) => (console.error('[A:back] FAIL', String(e?.message || e).slice(0, 200)), null)),
  sheet().catch((e) => (console.error('[B:sheet] FAIL', String(e?.message || e).slice(0, 200)), null)),
]);

// ---------- 判一致性（Sonnet 4.6 结构化）----------
const judge = gateway.languageModel('anthropic/claude-sonnet-4.6');
const schemaA = z.object({ consistencyScore: z.number().min(0).max(100), sameBooth: z.boolean(), anglesActuallyDiffer: z.boolean(), issues: z.array(z.string()) });
const schemaB = z.object({ consistencyScore: z.number().min(0).max(100), panelsSameBooth: z.boolean(), anglesCorrectAndDiffer: z.boolean(), issues: z.array(z.string()) });

if (aLeft && aBack) {
  console.log('\n[判 A] hero vs 左/背视…');
  try {
    const { object } = await generateObject({
      model: judge,
      schema: schemaA,
      messages: [{ role: 'user', content: [
        { type: 'text', text: '第1张是主图(hero)，第2张应是它的左视，第3张应是它的背视。判断：consistencyScore=后两张与主图是同一个展台的程度0-100；sameBooth=是否同一展台；anglesActuallyDiffer=视角是否真的变了(非近似复制)；issues=不一致点(结构/材质/颜色/品牌/布局)。只看客观。' },
        { type: 'image', image: hero }, { type: 'image', image: aLeft }, { type: 'image', image: aBack },
      ]}],
    });
    console.log('[A 结果]', JSON.stringify(object, null, 2));
  } catch (e) { console.error('[判 A] FAIL', String(e?.message || e).slice(0, 200)); }
}
if (bSheet) {
  console.log('\n[判 B] 四宫格 sheet…');
  try {
    const { object } = await generateObject({
      model: judge,
      schema: schemaB,
      messages: [{ role: 'user', content: [
        { type: 'text', text: '这是一张四宫格 turnaround sheet。判断：consistencyScore=四格是否同一展台0-100；panelsSameBooth=是否同一展台；anglesCorrectAndDiffer=四个角度是否正确且互不相同(前/左/右/俯视)；issues=问题点。只看客观。' },
        { type: 'image', image: bSheet },
      ]}],
    });
    console.log('[B 结果]', JSON.stringify(object, null, 2));
  } catch (e) { console.error('[判 B] FAIL', String(e?.message || e).slice(0, 200)); }
}
console.log(`\n=== multiview spike 结束（图在 ${DIR}/）===`);
