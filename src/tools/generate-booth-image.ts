import { tool } from 'ai';
import { z } from 'zod';
import { MODEL_IDS, openaiViaGateway } from '@/models/gateway';
import { DEFAULT_PROJECT, saveAsset } from '@/lib/storage';

export const generateBoothImage = tool({
  description:
    '用 gpt-image-2 生成展台效果图（经 Gateway 的 OpenAI 兼容端点）。prompt 用英文五层架构（见 prompt-craft）。返回资产 id 与可预览 url。注意延迟：quality=low~8s / medium~30s / high~200s —— 概念迭代用 medium，最终交付或精密结构才用 high。',
  inputSchema: z.object({
    prompt: z.string().describe('英文生图 prompt（五层架构、200-400 词、品牌占位符）'),
    quality: z
      .enum(['low', 'medium', 'high'])
      .default('high')
      .describe('low~8s / medium~30s / high~200s。按这次的分量选：概念→medium，最终交付/精密结构→high'),
    size: z
      .enum(['1024x1024', '1536x1024', '1024x1536'])
      .default('1024x1024')
      .describe('默认 1024x1024（最快）；横向展台终图可用 1536x1024（更慢）'),
  }),
  execute: async ({ prompt, quality, size }) => {
    const client = openaiViaGateway();
    const r = await client.images.generate({
      model: MODEL_IDS.image,
      prompt,
      size,
      quality,
      n: 1,
    });
    const b64 = r.data?.[0]?.b64_json ?? '';
    if (!b64) return { error: '生图未返回数据' };
    const bytes = new Uint8Array(Buffer.from(b64, 'base64'));
    const asset = await saveAsset(DEFAULT_PROJECT, bytes, { kind: 'booth-image', prompt });
    return { assetId: asset.id, url: asset.url, quality, size };
  },
});
