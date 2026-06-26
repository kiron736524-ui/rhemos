import { gateway } from '@ai-sdk/gateway';

const envModel = (name: string, fallback: string) => process.env[name]?.trim() || fallback;

/**
 * 多来源模型路由：脑 / prompt-writer / 成本估算 / 语音清理经 **Vercel AI Gateway**；
 * **gpt-image-2 经 fal.ai**（文生图 + 图编辑，见下方 fal 封装）；**ASR 经阿里云 DashScope**（直连）。
 * 鉴权：AI_GATEWAY_API_KEY / FAL_API_KEY / DASHSCOPE_API_KEY（均在 .env.local，已 gitignore）。
 */
export const MODEL_IDS = {
  /** 对话 + 工程脑：负责澄清、写 DesignSpec、编排工具。默认 Sonnet 4.6 控成本；可用 RHEMOS_BRAIN_MODEL 覆盖回 Opus。 */
  brain: envModel('RHEMOS_BRAIN_MODEL', 'anthropic/claude-sonnet-4.6'),
  /** 生图 + 改图：唯一指定模型 gpt-image-2（唯一渠道 fal，见 image-providers.ts）。 */
  image: 'openai/gpt-image-2',
  /** 工具内 prompt-writer：保留 Opus 4.8 写图与物理/世界知识优势；可用 RHEMOS_PROMPT_MODEL 覆盖。 */
  promptWriter: envModel('RHEMOS_PROMPT_MODEL', 'anthropic/claude-opus-4.8'),
  /** 成本解释/估算：走便宜档 DeepSeek。 */
  costEstimator: envModel('RHEMOS_COST_MODEL', 'deepseek/deepseek-v4-flash'),
  /** 语音转写后的清理整理（去语气词/去重复/轻度理顺）—— efficiency 档，便宜快 */
  cleanup: 'deepseek/deepseek-v4-flash',
} as const;

/** 语言/推理脑（默认 Sonnet 4.6；见 MODEL_IDS.brain / RHEMOS_BRAIN_MODEL） */
export const brain = () => gateway.languageModel(MODEL_IDS.brain);

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
// fal 返回的图片 URL 下载前做 SSRF 白名单校验：必须 https 且 host ∈ fal 域，杜绝被构造 URL 牵去内网/任意地址。
const falHostOk = (h: string) =>
  h === 'fal.media' || h.endsWith('.fal.media') || h === 'fal.run' || h.endsWith('.fal.run') || h === 'fal.ai' || h.endsWith('.fal.ai');
function isAllowedFalUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    return u.protocol === 'https:' && falHostOk(u.hostname.toLowerCase());
  } catch {
    return false;
  }
}

const FAL_TIMEOUT_MS = Number(process.env.RHEMOS_FAL_TIMEOUT_MS) || 300_000; // gpt-image-2 high ~200s，留足余量
const FAL_RETRIES = 2; // 5xx / 网络抖动的额外重试次数（指数退避）；超时与客户端断流不重试
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * 调 fal 同步端点 → 取首图 URL（SSRF 校验）→ 下载字节。失败返回 null。
 * 加固（D39）：单次超时（AbortController）；5xx/网络错指数退避重试，4xx/超时/客户端断流不重试；
 * 外部 signal（客户端断流，route 经 streamText abortSignal 透传到工具）可真正取消在飞的 fal 调用。
 */
async function falImage(endpoint: string, body: Record<string, unknown>, signal?: AbortSignal): Promise<Uint8Array | null> {
  for (let attempt = 0; attempt <= FAL_RETRIES; attempt++) {
    if (signal?.aborted) return null;
    const ctrl = new AbortController();
    let timedOut = false;
    const onAbort = () => ctrl.abort();
    signal?.addEventListener('abort', onAbort, { once: true });
    const timer = setTimeout(() => {
      timedOut = true;
      ctrl.abort();
    }, FAL_TIMEOUT_MS);
    try {
      const res = await fetch(`${FAL_BASE}/${endpoint}`, { method: 'POST', headers: falHeaders(), body: JSON.stringify(body), signal: ctrl.signal });
      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        console.warn(`[fal] ${endpoint} failed ${res.status}: ${detail.slice(0, 500)}`);
        if (res.status < 500) return null; // 4xx（鉴权/参数）重试无意义
        if (attempt < FAL_RETRIES) {
          await sleep(800 * 2 ** attempt);
          continue;
        }
        return null;
      }
      const data = (await res.json()) as { images?: { url?: string }[] };
      const url = data.images?.[0]?.url;
      if (!url) return null;
      if (!isAllowedFalUrl(url)) {
        console.warn(`[fal] 拒绝下载非 fal 域图片 URL（SSRF 防护）：${url.slice(0, 120)}`);
        return null;
      }
      const imgRes = await fetch(url, { signal: ctrl.signal });
      if (!imgRes.ok) return null;
      return new Uint8Array(await imgRes.arrayBuffer());
    } catch (e) {
      if (signal?.aborted) {
        console.warn(`[fal] ${endpoint} 已取消（客户端断流）`);
        return null;
      }
      if (timedOut) {
        console.warn(`[fal] ${endpoint} 超时（${FAL_TIMEOUT_MS}ms）`);
        return null;
      }
      console.warn(`[fal] ${endpoint} 网络异常（尝试 ${attempt + 1}/${FAL_RETRIES + 1}）：${e instanceof Error ? e.message : e}`);
      if (attempt < FAL_RETRIES) {
        await sleep(800 * 2 ** attempt);
        continue;
      }
      return null;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }
  }
  return null;
}

/** fal gpt-image-2 文生图（默认 1024 square_hd + quality medium）。 */
export async function falTextToImage(prompt: string, opts?: { quality?: string; size?: string; signal?: AbortSignal }): Promise<Uint8Array | null> {
  return falImage(FAL_TEXT_ENDPOINT, { prompt, image_size: falSize(opts?.size), quality: opts?.quality ?? DEFAULT_IMAGE_QUALITY }, opts?.signal);
}

/** fal gpt-image-2/edit 参考条件化（多图参考走 base64 data URI + 默认 1024 + medium）。 */
export async function falEditFromRefs(refs: Uint8Array[], prompt: string, opts?: { quality?: string; size?: string; signal?: AbortSignal }): Promise<Uint8Array | null> {
  const image_urls = refs.map((b) => `data:image/png;base64,${Buffer.from(b).toString('base64')}`);
  return falImage(FAL_EDIT_ENDPOINT, { prompt, image_urls, image_size: falSize(opts?.size), quality: opts?.quality ?? DEFAULT_IMAGE_QUALITY }, opts?.signal);
}

/** best-of-N 并发上限（成本控制；Phase 2 best-of-N 用） */
export const MAX_PARALLEL_IMAGES = 2;

/**
 * 工业级渲染画风锚 —— 代码层强制注入所有生图 prompt（不依赖大脑每次记得写）。
 * gpt-image-2 缺强画风约束时会漂向 CG/插画/产品手册示意图；尤其 turnaround sheet 的
 * "2x2 grid / panel / turnaround" 等措辞天然带向 model-sheet 示意图风（用户实测"诡异、不像正经渲染"的来源）。
 * 这段只钉**画风**（专业建筑可视化级真实渲染，否定卡通/插画/平面图/草模）；
 * **外轮廓/几何硬规则不在这里**——统一在 cad.buildFootprintLock（footprint 单一来源，D39），避免同一约束在一条 prompt 里说多遍。
 */
export const RENDER_STYLE_ANCHOR =
  'RENDER STYLE (mandatory, highest priority): photorealistic professional architectural visualization of a REAL fabricated exhibition booth — high-end 3D render with V-Ray / Corona / Octane-grade physically-based global illumination, realistic soft shadows and contact occlusion, accurate reflections on glossy floors and on brushed-metal / glass / powder-coated surfaces, true-to-life LED-screen and spotlight glow, crisp clean build-ready geometry, neutral photographic color grading, as if photographed in a clean professional exhibition hall. Keep the scene well exposed and readable, never muddy, underlit, gray, noisy, crowded, or dominated by distracting neighboring booths. The booth must read as a buildable trade-show booth made from rectilinear walls, counters, display cases, truss, signage, and lighting, not a retail store, stage set, showroom, or abstract sculpture. It MUST look like a photograph of a real fabricated booth or a top-tier exhibition-design studio render — absolutely NOT a cartoon, NOT an illustration, NOT a flat vector or line diagram, NOT a sketch, NOT a clay/toy model, NOT a generic glossy AI-art look.';

/** 把画风锚追加到任意生图 prompt 末尾（代码层强制兜底）。 */
export const withRenderStyle = (prompt: string): string => `${prompt}\n\n${RENDER_STYLE_ANCHOR}`;
