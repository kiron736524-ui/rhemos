import { gateway } from '@ai-sdk/gateway';

/**
 * 多来源模型路由：脑 / 判图 / prompt-writer / 语音清理经 **Vercel AI Gateway**；
 * **gpt-image-2 经 fal.ai**（文生图 + 图编辑，见下方 fal 封装）；**ASR 经阿里云 DashScope**（直连）。
 * 鉴权：AI_GATEWAY_API_KEY / FAL_API_KEY / DASHSCOPE_API_KEY（均在 .env.local，已 gitignore）。
 */
export const MODEL_IDS = {
  /** 对话 + 工程脑：负责澄清、写 DesignSpec、写 prompt、写纠正 prompt、判断 */
  brain: 'anthropic/claude-opus-4.8',
  /** 生图 + 改图 */
  image: 'openai/gpt-image-2',
  /** 判图自检 + 工具内 prompt-writer 共用档。用户指定升 Opus 4.8（质量优先，与大脑同款；成本更高）。 */
  inspect: 'anthropic/claude-opus-4.8',
  /** 参考图条件化候选（当前本地测试版不作为生图 fallback，生图/改图统一走 gpt-image-2）。 */
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

/** 视觉判图器（默认档见 MODEL_IDS.inspect，可传入候选 id 切换/升级） */
export const inspector = (id: string = MODEL_IDS.inspect) =>
  gateway.languageModel(id);

// ── fal.ai：gpt-image-2 的来源（文生图 + 图编辑）。实测 gpt-image-2 经 Gateway 接不通图输入（D27），
// fal 提供 generate + edit 两端点、接受 base64 data URI（免上传 storage）、输出托管 URL。默认 1024 + quality medium（本地测试提速）。
const FAL_BASE = 'https://fal.run';
const FAL_TEXT_ENDPOINT = 'openai/gpt-image-2';
const FAL_EDIT_ENDPOINT = 'openai/gpt-image-2/edit';
const FAL_SIZE: Record<string, string> = { '1024x1024': 'square_hd', '1536x1024': 'landscape_4_3', '1024x1536': 'portrait_4_3' };
export const DEFAULT_IMAGE_QUALITY = 'medium' as const;
const falSize = (s?: string) => FAL_SIZE[s ?? ''] ?? 'square_hd';
const falKey = () => process.env.FAL_API_KEY ?? process.env.FAL_KEY;
const falHeaders = () => ({ Authorization: `Key ${falKey()}`, 'Content-Type': 'application/json' });

/** 调 fal 同步端点 → 取首图 URL → 下载字节。失败返回 null。 */
async function falImage(endpoint: string, body: Record<string, unknown>): Promise<Uint8Array | null> {
  const res = await fetch(`${FAL_BASE}/${endpoint}`, { method: 'POST', headers: falHeaders(), body: JSON.stringify(body) });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    console.warn(`[fal] ${endpoint} failed ${res.status}: ${detail.slice(0, 500)}`);
    return null;
  }
  const data = (await res.json()) as { images?: { url?: string }[] };
  const url = data.images?.[0]?.url;
  if (!url) return null;
  const ab = await (await fetch(url)).arrayBuffer();
  return new Uint8Array(ab);
}

/** fal gpt-image-2 文生图（默认 1024 square_hd + quality medium）。 */
export async function falTextToImage(prompt: string, opts?: { quality?: string; size?: string }): Promise<Uint8Array | null> {
  return falImage(FAL_TEXT_ENDPOINT, { prompt, image_size: falSize(opts?.size), quality: opts?.quality ?? DEFAULT_IMAGE_QUALITY });
}

/** fal gpt-image-2/edit 参考条件化（多图参考走 base64 data URI + 默认 1024 + medium）。 */
export async function falEditFromRefs(refs: Uint8Array[], prompt: string, opts?: { quality?: string; size?: string }): Promise<Uint8Array | null> {
  const image_urls = refs.map((b) => `data:image/png;base64,${Buffer.from(b).toString('base64')}`);
  return falImage(FAL_EDIT_ENDPOINT, { prompt, image_urls, image_size: falSize(opts?.size), quality: opts?.quality ?? DEFAULT_IMAGE_QUALITY });
}

/** best-of-N 并发上限（成本控制；Phase 2 best-of-N 用） */
export const MAX_PARALLEL_IMAGES = 2;

/**
 * 工业级渲染画风锚 —— 代码层强制注入所有生图 prompt（不依赖大脑每次记得写）。
 * gpt-image-2 缺强画风约束时会漂向 CG/插画/产品手册示意图；尤其 turnaround sheet 的
 * "2x2 grid / panel / turnaround" 等措辞天然带向 model-sheet 示意图风（用户实测"诡异、不像正经渲染"的来源）。
 * 这段把它钉死在"专业建筑可视化级真实渲染"，并显式否定卡通/插画/平面图/草模。
 */
export const RENDER_STYLE_ANCHOR =
  'RENDER STYLE (mandatory, highest priority): photorealistic professional architectural visualization of a REAL fabricated exhibition booth — high-end 3D render with V-Ray / Corona / Octane-grade physically-based global illumination, realistic soft shadows and contact occlusion, accurate reflections on glossy floors and on brushed-metal / glass / powder-coated surfaces, true-to-life LED-screen and spotlight glow, crisp clean build-ready geometry, neutral photographic color grading, as if photographed in a clean professional exhibition hall. Keep the scene well exposed and readable, never muddy, underlit, gray, noisy, crowded, or dominated by distracting neighboring booths. The booth must read as a buildable trade-show booth made from rectilinear walls, counters, display cases, truss, signage, and lighting, not a retail store, stage set, showroom, or abstract sculpture. Unless the user explicitly requested an irregular custom footprint, the platform/carpet edge and truss perimeter must be one clean straight rectangle with four 90-degree corners: no notches, protrusions, chamfers, diagonal bites, warped edges, random add-on floor islands, or polygonal booth outline. Freestanding sign totems / standees are slim rectangular vertical boards placed inside the footprint; they must never become walls or change the outer boundary. It MUST look like a photograph of a real fabricated booth or a top-tier exhibition-design studio render — absolutely NOT a cartoon, NOT an illustration, NOT a flat vector or line diagram, NOT a sketch, NOT a clay/toy model, NOT a generic glossy AI-art look.';

/** 把画风锚追加到任意生图 prompt 末尾（代码层强制兜底）。 */
export const withRenderStyle = (prompt: string): string => `${prompt}\n\n${RENDER_STYLE_ANCHOR}`;

/**
 * 参考图条件化生图：参考图 + 指令 → "看着这个展台"换角度 / 局部编辑，保持一致。
 * **fal gpt-image-2/edit**（默认 1024 + quality medium；接受 base64 data URI 免上传）。
 * 本地测试期强制所有生图/改图只走 gpt-image-2，不再回退 Gemini。失败返回 null。
 */
export async function generateImageFromRefs(refs: Uint8Array[], instruction: string, opts?: { quality?: string; size?: string }): Promise<Uint8Array | null> {
  if (process.env.FAL_API_KEY) {
    const out = await falEditFromRefs(refs, instruction, opts).catch(() => null);
    if (out) return out;
  }
  return null;
}
