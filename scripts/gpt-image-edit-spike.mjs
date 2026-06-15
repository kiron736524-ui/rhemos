// 死命令实测：gpt-image-2 经 Gateway 能否接收参考图（多模态输入）。试 4 种手段，找接通的那条。
// 跑：node --env-file .env.local scripts/gpt-image-edit-spike.mjs
import OpenAI, { toFile } from 'openai';
import { generateText } from 'ai';
import { gateway } from '@ai-sdk/gateway';

const KEY = process.env.AI_GATEWAY_API_KEY;
const BASE = 'https://ai-gateway.vercel.sh/v1';
const client = new OpenAI({ apiKey: KEY, baseURL: BASE });
const MODEL = 'openai/gpt-image-2';
const ok = (l, n) => console.log(`✅ ${l}：接通，返回图 ${n} bytes`);
const no = (l, e) => console.log(`❌ ${l}：${(e?.status ?? '')} ${(e?.message ?? e ?? '').toString()}`.slice(0, 220));

// 0) 先文生图一张参考（已知可行）
console.log('— 0) 文生图一张参考 —');
let refBuf;
try {
  const gen = await client.images.generate({ model: MODEL, prompt: 'a single glossy red cube centered on pure white background, studio lighting', size: '1024x1024', quality: 'low', n: 1 });
  refBuf = Buffer.from(gen.data[0].b64_json, 'base64');
  console.log(`参考图 ${refBuf.length} bytes`);
} catch (e) { no('文生图(基础能力)', e); process.exit(1); }

const instruction = 'Keep the exact same cube and white background, only change the cube color from red to BLUE.';

// A) AI SDK generateText + image part（把 gpt-image-2 当多模态 languageModel，与 Gemini 同路）
console.log('\n— A) generateText + image part —');
try {
  const r = await generateText({
    model: gateway.languageModel(MODEL),
    messages: [{ role: 'user', content: [{ type: 'text', text: instruction }, { type: 'image', image: refBuf }] }],
  });
  const f = (r.files ?? []).find((x) => x.mediaType?.startsWith('image/'));
  if (f) ok('A generateText+image', f.uint8Array.length);
  else no('A generateText+image', `无图；text=${(r.text || '').slice(0, 80)}`);
} catch (e) { no('A generateText+image', e); }

// B) OpenAI SDK images.edit（multipart，传 File）
console.log('\n— B) client.images.edit（multipart）—');
try {
  const file = await toFile(refBuf, 'ref.png', { type: 'image/png' });
  const edit = await client.images.edit({ model: MODEL, image: file, prompt: instruction });
  const b64 = edit.data?.[0]?.b64_json;
  if (b64) ok('B images.edit', Buffer.from(b64, 'base64').length);
  else no('B images.edit', '无 b64');
} catch (e) { no('B images.edit', e); }

// C) Responses API + input_image（OpenAI 新统一端点，gpt-image 系可经 image_generation tool 吃 input image）
console.log('\n— C) responses.create + input_image —');
try {
  const resp = await client.responses.create({
    model: MODEL,
    input: [{ role: 'user', content: [{ type: 'input_text', text: instruction }, { type: 'input_image', image_url: `data:image/png;base64,${refBuf.toString('base64')}` }] }],
  });
  const s = JSON.stringify(resp);
  const hasImg = /b64_json|image_generation|"result"/.test(s);
  console.log(`C responses 返回 keys=${Object.keys(resp || {}).join(',')} hasImageSignal=${hasImg}`);
  console.log('C sample:', s.slice(0, 200));
} catch (e) { no('C responses', e); }

// D) 原始 fetch /images/edits（绕开 SDK，自己拼 multipart）
console.log('\n— D) fetch /images/edits（原始 multipart）—');
try {
  const fd = new FormData();
  fd.append('model', MODEL);
  fd.append('prompt', instruction);
  fd.append('image', new Blob([refBuf], { type: 'image/png' }), 'ref.png');
  const res = await fetch(`${BASE}/images/edits`, { method: 'POST', headers: { Authorization: `Bearer ${KEY}` }, body: fd });
  const txt = await res.text();
  console.log(`D status=${res.status}:`, txt.slice(0, 180));
} catch (e) { no('D fetch edits', e); }

console.log('\n=== spike done ===');
