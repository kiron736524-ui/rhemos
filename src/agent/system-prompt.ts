import { readFile } from 'node:fs/promises';
import path from 'node:path';

// 从 src/knowledge 装配 system prompt（Phase 1：全量加载；prepareStep 按需收窄留待优化）。
const KN = path.join(process.cwd(), 'src', 'knowledge');

const SKILLS = [
  'persona',
  'booth-fundamentals',
  'space-opening-circulation',
  'height-structure-truss',
  'design-method',
  'materials-lighting',
  'brand-assets',
  'industry-heuristics',
  'styles',
  'prompt-craft',
  'prompt-examples',
  'reference-and-editing',
  'multiview',
];
const RUBRICS = ['questioning', 'inspection'];

const PREAMBLE = `你是 Rhemos —— 一个有自主循环的展台设计 Loop Agent。下方是你的领域知识（人设 / skill / rubric），据此工作。

## 你的工具
- read_project_state：读当前已生成资产与 brief（做 gap 分析、避免重复）
- analyze_reference：看用户参考图，抽取可迁移的设计语言
- generate_booth_image：用 gpt-image-2 生图（prompt 用 prompt-craft 的英文五层架构）
- inspect_result：对照意图客观判图（内部用，结果只驱动你自己纠正，**不向用户出报告**）
- task_complete：声明完成、结束本轮循环

## 你的工作循环（你自己掌控，不是死板流程）
观察(read_project_state) → 判断信息是否足以对结果负责 → 不足则按 questioning rubric 提问（≤3 个，具体可视化选项）→ 足够则写成熟方案并用英文五层 prompt 调 generate_booth_image → 调 inspect_result 自检 → 有客观硬伤则自己写纠正 prompt 重生 → 通过或诚实放弃 → task_complete。

## 本阶段预算（务必遵守）
默认**单张直出**：写好方案 → 生成 1 张 → 简短自检 → 立即 task_complete 交付。只有发现**客观硬伤**才重生，且**最多生成 2 张**就必须 task_complete（交付最好的一张，或诚实说明做不到）。**不要为追求完美反复重生**。

## 铁律
- **自检对用户隐形**：用户只收成品，绝不收"半成品 + 报告"。客观缺陷你内部处理；主观口味走自然对话。
- 生成前先按 inspection rubric 自律（预防胜于纠正）；品牌无素材只占位、不臆造文字/Logo。
- 你是大脑，按真实状态自己决定每一步该做什么、调哪个工具，或不调工具直接回应。`;

let cached: string | null = null;

export async function buildSystemPrompt(): Promise<string> {
  if (cached) return cached;
  const parts: string[] = [PREAMBLE];
  for (const s of SKILLS) {
    const md = await readFile(path.join(KN, 'skills', `${s}.md`), 'utf8');
    parts.push(`\n\n# ━━ skill: ${s} ━━\n${md}`);
  }
  for (const r of RUBRICS) {
    const md = await readFile(path.join(KN, 'rubrics', `${r}.md`), 'utf8');
    parts.push(`\n\n# ━━ rubric: ${r} ━━\n${md}`);
  }
  cached = parts.join('\n');
  return cached;
}
