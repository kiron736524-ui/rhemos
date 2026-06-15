import { gateway } from '@ai-sdk/gateway';
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
