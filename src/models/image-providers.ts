import { falTextToImage, falEditFromRefs, MODEL_IDS } from './gateway';

/**
 * 生图 provider 层（**fal 锁定**）。render / revise 经此调用，把「生图」收口到一处。
 *
 * 产品已明确：生图唯一模型 = **gpt-image-2**，唯一渠道 = **fal**（文生图 + 图编辑）。
 * 不再保留 openai/seedream/gemini 的可插拔脚手架与 `IMAGE_PROVIDER` 选择逻辑（见 DECISIONS D39）。
 * 这层仍是「以后要换/加渠道时唯一改动点」，但当前只有 fal 一条实现，调用签名对 render/revise 稳定。
 *
 * fal 内部：文生图 = fal gpt-image-2；参考条件化 = fal gpt-image-2/edit。
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

/** 当前生图渠道 / 模型（供元数据记录：snapshot / asset.provider / asset.model）。 */
export const IMAGE_PROVIDER = 'fal' as const;
export const IMAGE_MODEL = MODEL_IDS.image; // 'openai/gpt-image-2'

/** 对外稳定句柄：直连 fal gpt-image-2（文生图 + 参考条件化 / 图编辑）。 */
export const imageProvider: ImageProvider = {
  name: IMAGE_PROVIDER,
  textToImage: (prompt, opts) => falTextToImage(prompt, opts),
  editFromRefs: (refs, prompt, opts) => falEditFromRefs(refs, prompt, opts),
};
