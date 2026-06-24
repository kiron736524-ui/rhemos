import { falTextToImage, generateImageFromRefs } from './gateway';

/**
 * 生图 provider 抽象层 —— render / revise 经此调用，把「用哪个图像供应商」收口到一处。
 *
 * 当前唯一实现 = fal.ai gpt-image-2（文生图）+ fal edit / Gemini fallback（参考条件化）。
 * 留这层是为了以后能在**一个地方**切换 / 增加 provider（OpenAI 官方直连、Vercel Gateway、
 * Seedream、fal fallback 链 等），而不必改 render.ts 的业务逻辑。
 */
export type ImageQuality = 'low' | 'medium' | 'high';
export type ImageSize = '1024x1024' | '1536x1024' | '1024x1536';

export interface ImageGenOptions {
  quality?: ImageQuality;
  size?: ImageSize;
}

export interface ImageProvider {
  name: string;
  /** 文生图：纯 prompt → 图。 */
  textToImage(prompt: string, opts?: ImageGenOptions): Promise<Uint8Array | null>;
  /** 参考条件化 / 图编辑：参考图 + 指令 → 图（换角度 / 局部改 / 按平面图出图）。 */
  editFromRefs(refs: Uint8Array[], prompt: string, opts?: ImageGenOptions): Promise<Uint8Array | null>;
}

/** fal gpt-image-2 provider（含 fal-edit→Gemini fallback，逻辑在 gateway.generateImageFromRefs）。 */
export const falImageProvider: ImageProvider = {
  name: 'fal-gpt-image-2',
  textToImage: (prompt, opts) => falTextToImage(prompt, opts),
  editFromRefs: (refs, prompt, opts) => generateImageFromRefs(refs, prompt, opts),
};

// TODO(Phase 5): 可插拔 provider 选择——按 env / 项目配置返回对应实现
//   （OpenAI 官方直连 images.* / Vercel AI Gateway / Seedream / fal）。
//   现仅 fal；生产化时再评估主链路与 fallback 顺序（见 docs/DECISIONS.md D29）。
export const imageProvider: ImageProvider = falImageProvider;
