# Rhemos · 架构（as-built）

> 当前已建状态（Phase 0-2）。路线图见 [`engineering-plan.md`](engineering-plan.md)；为何这么定见 [`DECISIONS.md`](DECISIONS.md)。

## 分层
```
前端 UI  src/app/page.tsx —— useChat + AI Elements 式工具可视化（极简自建）
   │ SSE (UI message stream)
API     src/app/api/agent/route.ts —— streamText(orchestrator).toUIMessageStreamResponse()
   │
Agent 核心  src/agent/orchestrator.ts —— 单脑 Opus 4.8 + stopWhen + 工具集
   │   system = src/agent/system-prompt.ts（PREAMBLE + 全部 skills + 2 rubrics）
   ├── 工具  src/tools/*（Zod）
   ├── 判图  src/agent/inspect.ts（generateObject + Sonnet 4.6）
   └── 知识  src/knowledge/*（大脑的领域参考）
模型层  src/models/gateway.ts —— 全部经 Vercel AI Gateway（ASR 例外）
存储层  src/lib/storage.ts —— 本地 .data/（state.json + assets/*.png）
```

## 一次请求的流
用户消息 → `/api/agent` → 大脑循环：`read_project_state` →（信息不足）按 questioning rubric 提问 /（足够）`update_spec` 写方案 → `generate_best_of_n`（并行生图 + 内置判图择优）→ 看 recommended + fails →（客观硬伤且预算允许）`revise_asset` 定向修 → `task_complete` → 全程流式回前端（文字 + 工具部件 + 图）。

## Loop Agent 机制（`src/agent/orchestrator.ts`）
- `model` = Opus 4.8（经 Gateway）。
- `stopWhen = [hasToolCall('task_complete'), imageBudget(5), stepCountIs(16)]`：正常由大脑 `task_complete` 退出；`imageBudget`（统计 best_of_n 的 n + revise 次数）与步数上限是**防失控兜底**。
- `system` 由 `system-prompt.ts` 装配：PREAMBLE（工具说明 + 工作循环 + 速度/预算 + 铁律）+ 13 skill + 2 rubric 全量。
- **模型分档天然成立**：主脑恒 Opus；判图在工具内部用 Sonnet 4.6（省钱），无需 `prepareStep` 切模型。

## 工具注册表（`src/tools/*`，Zod schema）
| 工具 | 作用 | 模型 | 关键 I/O |
|---|---|---|---|
| `read_project_state` | 读 brief / spec / 资产清单 | — | → {brief, spec, assets} |
| `analyze_reference` | 看参考图抽设计语言 | Opus(vision) | imageUrl → analysis |
| `update_spec` | 写 DesignSpec 存盘 | — | narrative / invariants / selfCheckCriteria |
| `generate_best_of_n` | **主力**：并行 N≤2 生图 + 并行判图 + 排序择优 | gpt-image-2 + Sonnet | prompt/n/quality/size/criteria → {candidates[], recommended} |
| `inspect_result` | 临时核对 / revise 后复检 | Sonnet | assetId/criteria → {score, fails, summary} |
| `revise_asset` | 窄回退：定向纠正重生 + 复检 | gpt-image-2 + Sonnet | parentAssetId/correctedPrompt/criteria → {asset, 复检} |
| `task_complete` | 声明完成、退出循环 | — | summary / delivered / gaps |

## 模型矩阵（`src/models/gateway.ts`）
| 角色 | 模型 | 经由 |
|---|---|---|
| 脑（对话+工程） | `anthropic/claude-opus-4.8` | Gateway（`gateway.languageModel`）|
| 生图 / 改图 | `openai/gpt-image-2` | **OpenAI SDK 经 Gateway** `https://ai-gateway.vercel.sh/v1`（精确控 quality/size/n）|
| 判图 | `anthropic/claude-sonnet-4.6` | Gateway；候选 `INSPECT_CANDIDATES`（基准测试待做）|
| ASR | 阿里云百炼 / DashScope | 直连（唯一非 Gateway，**尚未接线**）|
| 视频 | —— | 砍 |

## 知识层（`src/knowledge/`）
13 个 skill + 2 个 rubric（`questioning` / `inspection`），由 `system-prompt.ts` 全量装进 system prompt（缓存）。是大脑的领域参考与判断工具，由旧 rhemax skill 去 FSM 重组而来。详见 `src/knowledge/README.md`。

## 存储（`src/lib/storage.ts`，本地 FS）
`.data/projects/<id>/state.json`（`ProjectState`: brief / spec / assets）+ `assets/<assetId>.png`。单一默认 project（`DEFAULT_PROJECT='default'`）。类型见 `src/lib/types.ts`（`Asset` / `DesignSpec` / `ProjectState`）。**并行生图时先并行拿字节、再顺序 `saveAsset`**（避免竞写 state.json）。

## 前端（`src/app/page.tsx`）
`useChat` + `DefaultChatTransport({ api: '/api/agent' })`；渲染 `text` 部件 + 工具部件（`isToolUIPart` / `getToolName`）；`imagesFromOutput` 从工具输出抽 url 渲染候选 / 推荐图。极简自建 UI（AI Elements 美化是 Phase 4）。

## 文件树（标注）
```
src/
  app/
    page.tsx                  对话 UI（useChat）
    api/agent/route.ts        Orchestrator 入口（streamText）
    api/assets/[id]/route.ts  本地图片读出
  agent/
    orchestrator.ts           工具集 + stopWhen + 预算
    system-prompt.ts          装配 system prompt（PREAMBLE + 知识层）
    inspect.ts                结构化判图 helper（generateObject + Sonnet）
  tools/                      7 个 Zod 工具（见上表）
  models/gateway.ts           模型句柄（Gateway / OpenAI 兼容端点）
  knowledge/                  13 skill + 2 rubric（领域知识层）
  lib/{storage,types}.ts      本地存储 + 数据类型
scripts/*.mjs                 spike：连通性 / 并发 / 画质实测
docs/                         本套文档
.data/                        本地资产与状态（gitignored）
.env.local                    密钥（gitignored）
```
