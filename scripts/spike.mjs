// Phase 0 连通性 spike：验证 Opus 4.8(文本) / GPT Image 2(生图) / Sonnet 4.6(视觉判图) 经 Gateway 调通。
// 运行：node --env-file .env.local scripts/spike.mjs   （cwd = 项目根）
import { generateText, generateImage } from 'ai';
import { gateway } from '@ai-sdk/gateway';
import { mkdirSync, writeFileSync } from 'node:fs';

const key = process.env.AI_GATEWAY_API_KEY;
console.log('AI_GATEWAY_API_KEY:', key ? `存在 (${key.slice(0, 6)}…${key.slice(-4)})` : '缺失 ❌');

let bytes = null;

// [1] 脑：Opus 4.8 文本
try {
  const r = await generateText({
    model: gateway.languageModel('anthropic/claude-opus-4.8'),
    prompt: '用一句中文确认你收到了，并说明你的模型名称。',
  });
  console.log('\n[1] Opus 4.8 文本 ✅\n   ', r.text.trim());
  console.log('    usage:', JSON.stringify(r.usage));
} catch (e) {
  console.error('\n[1] Opus 4.8 ❌', e?.message || e);
}

// [2] 生图：GPT Image 2（生成一张简单展台图）
try {
  const r = await generateImage({
    model: gateway.imageModel('openai/gpt-image-2'),
    prompt:
      'A simple exhibition booth, one open side facing the main aisle, a back wall with a large display screen, a reception counter near the entrance, clean modern tech style, photorealistic 3D render, three-quarter wide-angle view.',
    size: '1024x1024',
  });
  bytes = r.image.uint8Array;
  mkdirSync('.data/spike', { recursive: true });
  writeFileSync('.data/spike/gpt-image-2-test.png', Buffer.from(bytes));
  console.log('\n[2] GPT Image 2 生图 ✅  已存 .data/spike/gpt-image-2-test.png （', bytes.length, 'bytes ）');
} catch (e) {
  console.error('\n[2] GPT Image 2 ❌', e?.message || e);
}

// [3] 视觉判图：Sonnet 4.6 看上一步生成的图（验证 生图→视觉 全链路）
if (bytes) {
  try {
    const r = await generateText({
      model: gateway.languageModel('anthropic/claude-sonnet-4.6'),
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: '这是一张展台效果图。用中文一句话描述它，并指出任何结构/物理不合理处（悬浮、无支撑、比例失真等）；没有就说"未见明显硬伤"。' },
            { type: 'image', image: bytes },
          ],
        },
      ],
    });
    console.log('\n[3] Sonnet 4.6 视觉判图 ✅\n   ', r.text.trim());
  } catch (e) {
    console.error('\n[3] Sonnet 4.6 视觉 ❌', e?.message || e);
  }
} else {
  console.log('\n[3] 跳过视觉判图（上一步未产出图）');
}

console.log('\n=== spike 结束 ===');
