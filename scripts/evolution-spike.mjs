// 进化式多参考链验证：量化 identity 注入 + 累积参考 对换角度一致性的增量。
// 对比三档（都生成"右视"，判与主图的一致性）：
//   ① baseline   : 参考=[主图]，prompt 不带 identity
//   ② +identity  : 参考=[主图]，prompt 带 identity schema
//   ③ +chain     : 参考=[主图 + 已生成左视]，prompt 带 identity（累积多参考）
// 运行：node --env-file .env.local scripts/evolution-spike.mjs
import { generateText, generateObject } from 'ai';
import { gateway } from '@ai-sdk/gateway';
import { z } from 'zod';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';

const DIR = '.data/spike/evolution';
mkdirSync(DIR, { recursive: true });

const ref = new Uint8Array(readFileSync('.data/projects/p-mqfbrm3qmc0/assets/booth-image-1781537717851-mo2qt3.png'));
const leftPath = '.data/spike/consistency/gemini_left.png';
const left = existsSync(leftPath) ? new Uint8Array(readFileSync(leftPath)) : null;
const t = () => Date.now();
const img = (r) => (r.files || []).find((f) => f.mediaType?.startsWith('image/'));

// Identity Schema（“基础信息”的文字锁定版：尺寸/开口/部件/位置/形状/材质/配色/品牌）
const IDENTITY = `SAME BOOTH IDENTITY (must stay identical in every view): 10m x 8m corner booth, two-sides-open L layout (main aisle on front + left, closed back + right walls). Pure white powder-coated shells, technology-blue light accents, dark gray high-reflective floor, dark hall. Fixed parts: (1) back wall = one large LED video wall with deep-blue particle-globe, hexagonal logo placeholder upper-left + slogan band; (2) one tall white pillar at left-front open edge, hexagonal logo at top + thin blue light strip; (3) ONE L-shaped white-and-blue reception counter in front of main wall slightly right of center, blue angled front panel + centered hexagonal logo; (4) exactly ONE negotiation set = one round table with FOUR white armchairs against the left side; one potted plant at left entry corner; (5) right side = wall-embedded curved stepped rack, three blue-edge-lit shelves + white cabinets below; (6) top = black perimeter truss + central suspended rectangular white light frame. Cool white 5000K. Hexagonal logo placeholder only.`;

const VIEW = 'a pure straight-on RIGHT side view';
const base = (withId) =>
  `${withId ? IDENTITY + '\n\n' : ''}The attached image(s) show a photorealistic 3D render of an exhibition booth. Render the EXACT SAME booth from ${VIEW}. Keep structure, layout, parts, materials, colors, brand placement and lighting 100% identical to the reference; only the camera viewpoint changes. Photorealistic professional architectural render, same dark hall and lighting mood.`;

async function gen(label, refs, prompt) {
  const s = t();
  try {
    const content = [{ type: 'text', text: prompt }, ...refs.map((image) => ({ type: 'image', image }))];
    const r = await generateText({ model: gateway.languageModel('google/gemini-3-pro-image'), messages: [{ role: 'user', content }] });
    const f = img(r);
    if (!f) return (console.log(`[${label}] 无图; text=`, (r.text || '').slice(0, 120)), null);
    const buf = Buffer.from(f.uint8Array);
    writeFileSync(`${DIR}/${label}.png`, buf);
    console.log(`[${label}] ok ${t() - s}ms ${buf.length}B`);
    return new Uint8Array(buf);
  } catch (e) {
    return (console.error(`[${label}] FAIL`, String(e?.message || e).slice(0, 200)), null);
  }
}

console.log('生成三档右视…');
const [b, i, c] = await Promise.all([
  gen('1_baseline', [ref], base(false)),
  gen('2_identity', [ref], base(true)),
  left ? gen('3_chain', [ref, left], base(true)) : Promise.resolve(null),
]);
if (!left) console.log('（缺 consistency spike 的左视图，跳过 chain 档）');

const judge = gateway.languageModel('anthropic/claude-sonnet-4.6');
const schema = z.object({ consistencyScore: z.number().min(0).max(100), sameBooth: z.boolean(), angleChanged: z.boolean(), keptParts: z.array(z.string()), driftedParts: z.array(z.string()) });
async function judge1(label, edited) {
  if (!edited) return;
  try {
    const { object } = await generateObject({
      model: judge, schema,
      messages: [{ role: 'user', content: [
        { type: 'text', text: '第1张是原展台主图，第2张应是同一展台的右侧视角。consistencyScore=0-100（同一展台程度）；sameBooth；angleChanged；keptParts=明显保持一致的部件；driftedParts=漂移/不一致的部件。只看客观。' },
        { type: 'image', image: ref }, { type: 'image', image: edited },
      ]}],
    });
    console.log(`\n[判 ${label}] score=${object.consistencyScore} same=${object.sameBooth} drift=${object.driftedParts.length}\n`, JSON.stringify(object, null, 2));
  } catch (e) { console.error(`[判 ${label}] FAIL`, String(e?.message || e).slice(0, 160)); }
}
await judge1('1_baseline', b);
await judge1('2_identity', i);
await judge1('3_chain', c);
console.log(`\n=== evolution spike 结束（图在 ${DIR}/）===`);
