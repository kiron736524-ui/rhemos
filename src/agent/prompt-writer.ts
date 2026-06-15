import { generateText } from 'ai';
import { gateway } from '@ai-sdk/gateway';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { MODEL_IDS } from '@/models/gateway';

// prompt-writer 子 agent（工具内，不占大脑上下文）：把大脑给的**中文意图** + 展台 identity
// 翻成**英文**生图/改图 prompt。带「写图执行知识」（prompt-craft/examples/materials/styles/...）。
// 大脑只做决策、给意图；写 prompt 这种执行活下沉到这里，中间推理不回流大脑（抗上下文污染）。
const KN = path.join(process.cwd(), 'src', 'knowledge', 'skills');
const WRITER_SKILLS = ['prompt-craft', 'prompt-examples', 'materials-lighting', 'styles', 'reference-and-editing', 'multiview'];

let cached: string | null = null;
async function writerSystem(): Promise<string> {
  if (cached) return cached;
  const parts = [
    '你是 Rhemos 的生图 prompt 专家子模块。依据给定的中文意图 + 展台 identity，产出**英文**生图 prompt（五层架构、工业级真实渲染）。' +
      '严格遵守 identity 里的部件数量 / 材质 / 配色 / 品牌占位；品牌无素材只占位、不臆造文字 Logo。只输出 prompt 正文，不要任何解释或前后缀。',
  ];
  for (const s of WRITER_SKILLS) {
    const md = await readFile(path.join(KN, `${s}.md`), 'utf8');
    parts.push(`\n\n# ━━ skill: ${s} ━━\n${md}`);
  }
  cached = parts.join('\n');
  return cached;
}

export type PromptKind = 'front' | 'plan' | 'concept' | 'revise';

/** 中文意图 → 英文生图/改图 prompt（worker，含执行知识；中间推理不回大脑）。 */
export async function writeImagePrompt(args: { intent: string; identity?: string; kind?: PromptKind }): Promise<string> {
  const { intent, identity = '', kind = 'front' } = args;
  const usage =
    kind === 'plan'
      ? '用途：以俯视平面图为硬参考出 3D 正面主图（严格贴合平面布局，含 L 形台等）。'
      : kind === 'revise'
        ? '用途：在已有图上只改一处、其余 100% 不变。输出形如 "keep EVERYTHING identical — structure / layout / all other parts / materials / colors / brand / lighting / camera angle — and change ONLY: <把意图翻成精确英文>"。'
        : kind === 'concept'
          ? '用途：概念 / 方向探索图。'
          : '用途：正面主视角效果图。';
  const ask = [
    `意图（中文）：${intent}`,
    identity ? `展台 identity（严格遵守）：\n${identity}` : '',
    usage,
    '输出：一段英文 prompt（只正文，不要解释）。',
  ]
    .filter(Boolean)
    .join('\n\n');
  // 复用 MODEL_IDS.inspect 档（现为 Opus 4.8，用户指定质量优先）；与判图同模型。
  const r = await generateText({ model: gateway.languageModel(MODEL_IDS.inspect), system: await writerSystem(), prompt: ask });
  return r.text.trim();
}
