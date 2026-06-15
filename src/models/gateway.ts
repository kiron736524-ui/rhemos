import { gateway } from '@ai-sdk/gateway';
import { generateText } from 'ai';
import OpenAI from 'openai';

/**
 * 所有模型调用经 Vercel AI Gateway（唯一来源，ASR 除外）。
 * 鉴权用 AI_GATEWAY_API_KEY（见 .env.local，已 gitignore）。
 */
export const MODEL_IDS = {
  /** 对话 + 工程脑：负责澄清、写 DesignSpec、写 prompt、写纠正 prompt、判断 */
  brain: 'anthropic/claude-opus-4.8',
  /** 生图 + 改图 */
  image: 'openai/gpt-image-2',
  /** 高频视觉自检默认档（Phase 0 判图基准测试后最终确定，见 INSPECT_CANDIDATES） */
  inspect: 'anthropic/claude-sonnet-4.6',
  /** 参考图条件化生图 / 局部编辑（多模态图像模型，一致性标杆）——换角度、"保持其余不变只改X" */
  imageEdit: 'google/gemini-3-pro-image',
  /** 语音转写后的清理整理（去语气词/去重复/轻度理顺）—— efficiency 档，便宜快 */
  cleanup: 'deepseek/deepseek-v4-flash',
} as const;

/**
 * inspector 选型候选 —— Phase 0 用真实展台图（含已知缺陷）做判图基准测试，
 * 以 Opus 4.8 / 人工为 ground truth 比命中率后选定默认；支持"便宜档先判、不确定/最终交付升级 Opus"分档。
 * 注：gemini / gpt 的确切 Gateway 模型串在 Phase 0 核对后修正。
 */
export const INSPECT_CANDIDATES = [
  'anthropic/claude-sonnet-4.6', // 默认起点：成本/质量平衡
  'anthropic/claude-opus-4.8',   // 升级档 + ground truth 裁判
  'google/gemini-3-pro',         // Gemini 视觉强（确切串待核对）
  'openai/gpt-5',                // 与 gpt-image-2 同家（确切串待核对）
] as const;

/** 语言/推理脑（Opus 4.8） */
export const brain = () => gateway.languageModel(MODEL_IDS.brain);

/** 生图模型（gpt-image-2） */
export const imageModel = () => gateway.imageModel(MODEL_IDS.image);

/** 视觉判图器（默认 Sonnet 4.6，可传入候选 id 切换/升级） */
export const inspector = (id: string = MODEL_IDS.inspect) =>
  gateway.languageModel(id);

/**
 * 生图走 Gateway 的 OpenAI 兼容端点（OpenAI SDK 直连），以精确控制 quality/size/n。
 * 实测：AI SDK generateImage 与 Gateway 图像端点均不支持 partial_images 流式、不采纳 output_format=jpeg（强制 PNG）。
 */
export const GATEWAY_OPENAI_BASE = 'https://ai-gateway.vercel.sh/v1';
export const openaiViaGateway = () =>
  new OpenAI({ apiKey: process.env.AI_GATEWAY_API_KEY, baseURL: GATEWAY_OPENAI_BASE });

/** best-of-N 并发上限（成本控制；Phase 2 best-of-N 用） */
export const MAX_PARALLEL_IMAGES = 2;

/**
 * 工业级渲染画风锚 —— 代码层强制注入所有生图 prompt（不依赖大脑每次记得写）。
 * gpt-image-2 缺强画风约束时会漂向 CG/插画/产品手册示意图；尤其 turnaround sheet 的
 * "2x2 grid / panel / turnaround" 等措辞天然带向 model-sheet 示意图风（用户实测"诡异、不像正经渲染"的来源）。
 * 这段把它钉死在"专业建筑可视化级真实渲染"，并显式否定卡通/插画/平面图/草模。
 */
export const RENDER_STYLE_ANCHOR =
  'RENDER STYLE (mandatory, highest priority): photorealistic professional architectural visualization of a REAL exhibition booth — high-end 3D render with V-Ray / Corona / Octane-grade physically-based global illumination, realistic soft shadows and contact occlusion, accurate reflections on glossy floors and on brushed-metal / glass / powder-coated surfaces, true-to-life LED-screen and spotlight glow, crisp clean build-ready geometry, neutral photographic color grading, as if photographed in a real exhibition hall. It MUST look like a photograph of a real fabricated booth or a top-tier exhibition-design studio render — absolutely NOT a cartoon, NOT an illustration, NOT a flat vector or line diagram, NOT a sketch, NOT a clay/toy model, NOT a generic glossy AI-art look.';

/** 把画风锚追加到任意生图 prompt 末尾（代码层强制兜底）。 */
export const withRenderStyle = (prompt: string): string => `${prompt}\n\n${RENDER_STYLE_ANCHOR}`;

/**
 * 参考图条件化生图（Gemini 3 Pro Image）：把一张或多张参考图 + 文字指令一起喂给多模态图像模型，
 * 让它"看着这个展台"换角度 / 局部编辑，保持与参考一致。多图参考 = 更强的身份锁定（进化链）。
 * 失败（无图返回 / 报错由调用方 catch）时返回 null。
 */
export async function generateImageFromRefs(refs: Uint8Array[], instruction: string): Promise<Uint8Array | null> {
  const r = await generateText({
    model: gateway.languageModel(MODEL_IDS.imageEdit),
    messages: [{ role: 'user', content: [{ type: 'text', text: instruction }, ...refs.map((image) => ({ type: 'image' as const, image }))] }],
  });
  const f = (r.files ?? []).find((x) => x.mediaType?.startsWith('image/'));
  return f ? new Uint8Array(f.uint8Array) : null;
}
