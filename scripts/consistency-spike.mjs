// 一致性实测：参考图条件化（generateText + input image）能否让"换角度"保持同一展台。
// 对比基线：现有 turnaround sheet 一致性约 82 分。
// 测两条路：A) Gemini 3 Pro Image(Nano Banana Pro，一致性标杆) B) gpt-image-2 经 image_generation tool(若可用)
// 运行：node --env-file .env.local scripts/consistency-spike.mjs
import { generateText, generateObject } from 'ai';
import { gateway } from '@ai-sdk/gateway';
import { z } from 'zod';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const DIR = '.data/spike/consistency';
mkdirSync(DIR, { recursive: true });

// 真实 TECHNOVA 单视角主图作参考（画风锚后那张）
const REF_PATH = '.data/projects/p-mqfbrm3qmc0/assets/booth-image-1781537717851-mo2qt3.png';
const ref = new Uint8Array(readFileSync(REF_PATH));
const t = () => Date.now();
const img = (r) => (r.files || []).find((f) => f.mediaType?.startsWith('image/'));

const editPrompt = (view) =>
  `The attached image is a photorealistic 3D render of an exhibition booth. Render the EXACT SAME booth — keep its structure, layout, wall positions, materials, colors, brand placement, furniture and lighting 100% identical to the reference image — but seen from ${view}. Only the camera viewpoint changes; do not redesign anything. Photorealistic professional architectural render, same dark exhibition hall, same lighting mood.`;

async function geminiEdit(label, view) {
  const s = t();
  try {
    const r = await generateText({
      model: gateway.languageModel('google/gemini-3-pro-image'),
      messages: [{ role: 'user', content: [{ type: 'text', text: editPrompt(view) }, { type: 'image', image: ref }] }],
    });
    const f = img(r);
    if (!f) {
      console.log(`[gemini:${label}] 无图返回; text=`, (r.text || '').slice(0, 160));
      return null;
    }
    const buf = Buffer.from(f.uint8Array);
    writeFileSync(`${DIR}/gemini_${label}.png`, buf);
    console.log(`[gemini:${label}] ok ${t() - s}ms ${buf.length}B (${f.mediaType})`);
    return new Uint8Array(buf);
  } catch (e) {
    console.error(`[gemini:${label}] FAIL`, String(e?.message || e).slice(0, 280));
    return null;
  }
}

console.log('参考图:', REF_PATH, `(${ref.length}B)`);
console.log('[A] Gemini 3 Pro Image 参考图换角度（左视 / 俯视）…');
const [gLeft, gTop] = await Promise.all([
  geminiEdit('left', 'a pure straight-on LEFT side view'),
  geminiEdit('top', "a true top-down orthographic floor-plan view (bird's-eye)"),
]);

// 判一致性（Sonnet 4.6）
const judge = gateway.languageModel('anthropic/claude-sonnet-4.6');
const schema = z.object({
  consistencyScore: z.number().min(0).max(100),
  sameBooth: z.boolean(),
  angleActuallyChanged: z.boolean(),
  issues: z.array(z.string()),
});
async function judgeOne(label, edited, viewDesc) {
  if (!edited) return;
  try {
    const { object } = await generateObject({
      model: judge,
      schema,
      messages: [{ role: 'user', content: [
        { type: 'text', text: `第1张是原展台主图，第2张应是同一展台的${viewDesc}。consistencyScore=0-100（与原图是同一个展台的程度，结构/材质/颜色/品牌/布局）；sameBooth=是否同一展台；angleActuallyChanged=视角是否真的变了（不是复制原图）；issues=不一致点。只看客观。` },
        { type: 'image', image: ref },
        { type: 'image', image: edited },
      ]}],
    });
    console.log(`\n[判 ${label}]`, JSON.stringify(object, null, 2));
  } catch (e) {
    console.error(`[判 ${label}] FAIL`, String(e?.message || e).slice(0, 200));
  }
}
await judgeOne('left', gLeft, '纯左侧视角');
await judgeOne('top', gTop, '俯视平面视角');

console.log(`\n=== consistency spike 结束（图在 ${DIR}/）===`);
