import { generateImage, tool } from 'ai';
import { z } from 'zod';
import { imageModel } from '@/models/gateway';
import { DEFAULT_PROJECT, saveAsset } from '@/lib/storage';

export const generateBoothImage = tool({
  description:
    '用 gpt-image-2 生成展台效果图。prompt 必须是英文五层架构（见 prompt-craft skill）：全局声明→顶部结构→主体展区(中/左/右)→地面与灯光→渲染指令。返回资产 id 与可预览 url。',
  inputSchema: z.object({
    prompt: z.string().describe('英文生图 prompt（五层架构、200-400 词、品牌用占位符）'),
    size: z
      .enum(['1024x1024', '1536x1024', '1024x1536'])
      .default('1536x1024')
      .describe('画幅；展台横向效果图常用 1536x1024'),
  }),
  execute: async ({ prompt, size }) => {
    const r = await generateImage({ model: imageModel(), prompt, size });
    const asset = await saveAsset(DEFAULT_PROJECT, r.image.uint8Array, {
      kind: 'booth-image',
      prompt,
    });
    return { assetId: asset.id, url: asset.url };
  },
});
