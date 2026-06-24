import { falTextToImage, generateImageFromRefs } from './gateway';

/**
 * 生图 provider 抽象层 + 可配置选择。render / revise 经此调用，把「用哪个图像供应商」收口到一处。
 *
 * 选择：环境变量 `IMAGE_PROVIDER`（默认 'fal'）。当前**仅 fal 有真实实现**；
 * openai / seedream / gemini 是**预留接口**——调用即抛清晰错误，绝不伪造实现。
 * 未知 `IMAGE_PROVIDER` 值 → `getImageProviderName()` 抛错（避免误以为走了别的 provider，见 DECISIONS D31）。
 *
 * fal 内部：文生图 = fal gpt-image-2；参考条件化 = fal gpt-image-2/edit，失败回退 Gemini（逻辑在 gateway）。
 * 留这层是为了以后能在**一个地方**接 OpenAI 官方直连 / Vercel Gateway / Seedream，而不改 render 业务逻辑。
 */
export type ImageQuality = 'low' | 'medium' | 'high';
export type ImageSize = '1024x1024' | '1536x1024' | '1024x1536';
export type ImageProviderName = 'fal' | 'openai' | 'seedream' | 'gemini';

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

/** 富结果（供调用方记录 provider/model/耗时）；当前各 provider 主要返回 bytes，耗时由调用方 Date.now() 计。 */
export interface ImageProviderResult {
  bytes: Uint8Array | null;
  provider: ImageProviderName;
  model: string;
  durationMs: number;
  error?: string;
}

const KNOWN_PROVIDERS: ImageProviderName[] = ['fal', 'openai', 'seedream', 'gemini'];
const IMPLEMENTED: ReadonlySet<ImageProviderName> = new Set<ImageProviderName>(['fal']);

/** provider → 记录用主模型串（fal/openai 都是 gpt-image-2）。 */
export const PROVIDER_MODEL: Record<ImageProviderName, string> = {
  fal: 'openai/gpt-image-2',
  openai: 'openai/gpt-image-2',
  seedream: 'bytedance/seedream',
  gemini: 'google/gemini-3-pro-image',
};

/** 读 `IMAGE_PROVIDER`（默认 fal）；未知值抛清晰错误（不静默回退，避免误以为走了别的 provider）。 */
export function getImageProviderName(): ImageProviderName {
  const raw = process.env.IMAGE_PROVIDER?.trim().toLowerCase();
  if (!raw) return 'fal';
  if (!KNOWN_PROVIDERS.includes(raw as ImageProviderName)) {
    throw new Error(`未知 IMAGE_PROVIDER="${raw}"，仅支持 ${KNOWN_PROVIDERS.join(' / ')}（当前仅 fal 有真实实现）`);
  }
  return raw as ImageProviderName;
}

/** provider 主模型串（记录用）。 */
export const getImageModel = (name: ImageProviderName = getImageProviderName()): string => PROVIDER_MODEL[name];

// —— provider 实现 ——
/** fal gpt-image-2 provider（含 fal-edit→Gemini fallback，逻辑在 gateway.generateImageFromRefs）。 */
export const falImageProvider: ImageProvider = {
  name: 'fal',
  textToImage: (prompt, opts) => falTextToImage(prompt, opts),
  editFromRefs: (refs, prompt, opts) => generateImageFromRefs(refs, prompt, opts),
};

/** 预留 provider：调用即抛清晰错误（不伪造实现）。 */
const notImplementedProvider = (name: ImageProviderName): ImageProvider => {
  const fail = async (): Promise<never> => {
    throw new Error(`IMAGE_PROVIDER=${name} 尚未实现（本轮仅 fal；openai/seedream/gemini 为预留接口）。请用 IMAGE_PROVIDER=fal 或先实现该 provider。`);
  };
  return { name, textToImage: fail, editFromRefs: fail };
};

function selectProvider(name: ImageProviderName): ImageProvider {
  return name === 'fal' ? falImageProvider : notImplementedProvider(name);
}

/**
 * 解析当前激活 provider：未知值 → 抛错；已知但未实现 → 抛错（不伪造）。返回 {name, model}。
 * render / revise 在生图前调一次，既校验配置又取 provider/model 供记录（在 .catch 包裹前先暴露清晰错误）。
 */
export function resolveActiveImageProvider(): { name: ImageProviderName; model: string } {
  const name = getImageProviderName();
  if (!IMPLEMENTED.has(name)) {
    throw new Error(`IMAGE_PROVIDER=${name} 尚未实现（本轮仅 fal；openai/seedream/gemini 为预留接口）。请用 IMAGE_PROVIDER=fal 或先实现该 provider。`);
  }
  return { name, model: PROVIDER_MODEL[name] };
}

/**
 * 对外稳定句柄：按 `IMAGE_PROVIDER` 动态分发（默认 fal）。render/revise 无需改调用签名。
 * 未知 IMAGE_PROVIDER → 调用时 getImageProviderName 抛错；已知未实现 → selectProvider 抛错。
 */
export const imageProvider: ImageProvider = {
  name: 'configurable',
  textToImage: (prompt, opts) => selectProvider(getImageProviderName()).textToImage(prompt, opts),
  editFromRefs: (refs, prompt, opts) => selectProvider(getImageProviderName()).editFromRefs(refs, prompt, opts),
};
