// 实测 fal.ai gpt-image-2 连接：文生图 + 图编辑(参考条件化)两个端点。
// 跑：node --env-file .env.local scripts/fal-spike.mjs
const FAL = process.env.FAL_API_KEY;
if (!FAL) {
  console.error('缺 FAL_API_KEY');
  process.exit(1);
}
const H = { Authorization: `Key ${FAL}`, 'Content-Type': 'application/json' };
const t0 = Date.now();
const dt = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`;

// ① 文生图：fal openai/gpt-image-2
console.log('— ① 文生图 openai/gpt-image-2 (low 测通路) —');
let imgBuf;
try {
  const res = await fetch('https://fal.run/openai/gpt-image-2', {
    method: 'POST',
    headers: H,
    body: JSON.stringify({ prompt: 'a single glossy red cube centered on pure white background, studio lighting', image_size: 'square_hd', quality: 'low' }),
  });
  console.log(`status=${res.status} (${dt()})`);
  const data = await res.json();
  console.log('keys:', Object.keys(data).join(','));
  const url = data.images?.[0]?.url;
  console.log('image url:', (url || '').slice(0, 80), '...', `(${data.images?.[0]?.width}x${data.images?.[0]?.height})`);
  if (!url) { console.log('原始响应:', JSON.stringify(data).slice(0, 400)); process.exit(1); }
  // 下载字节
  const ab = await (await fetch(url)).arrayBuffer();
  imgBuf = Buffer.from(ab);
  console.log(`✅ 文生图通，下载 ${imgBuf.length} bytes (${dt()})`);
} catch (e) {
  console.log('❌ 文生图失败:', e.message);
  process.exit(1);
}

// ② 图编辑：fal openai/gpt-image-2/edit（用 data URI 喂参考图）
console.log('\n— ② 图编辑 openai/gpt-image-2/edit (low, data URI 参考图) —');
try {
  const dataUri = `data:image/png;base64,${imgBuf.toString('base64')}`;
  const res = await fetch('https://fal.run/openai/gpt-image-2/edit', {
    method: 'POST',
    headers: H,
    body: JSON.stringify({ prompt: 'Keep the exact same cube and white background, only change the cube color to BLUE.', image_urls: [dataUri], image_size: 'square_hd', quality: 'low' }),
  });
  console.log(`status=${res.status} (${dt()})`);
  const data = await res.json();
  console.log('keys:', Object.keys(data).join(','));
  const url = data.images?.[0]?.url;
  if (url) {
    const ab = await (await fetch(url)).arrayBuffer();
    console.log(`✅ 图编辑通（data URI 参考图被接受），返回图 ${Buffer.from(ab).length} bytes (${dt()})`);
  } else {
    console.log('❌ 无图，原始响应:', JSON.stringify(data).slice(0, 400));
  }
} catch (e) {
  console.log('❌ 图编辑失败:', e.message);
}
console.log('\n=== fal spike done ===');
