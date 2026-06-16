# Rhemos · 架构（as-built）

> 当前已建状态（Phase 0-4 + UI 颠覆 / 卡片提问 / 工业级一致性 pipeline / 布局编辑器）。路线图见 [`engineering-plan.md`](engineering-plan.md)；为何这么定见 [`DECISIONS.md`](DECISIONS.md)。

## 分层
```
前端 UI  src/app/projects/[projectId]/page.tsx —— 三栏工作台（项目面板/对话/画廊）
   │        useChat + 上传(图/PDF/Word/Excel) + 语音 + lightbox（page.tsx 仅 redirect→default）
   │ SSE (UI message stream)
API     src/app/api/agent/route.ts —— streamText(orchestrator)；附件预处理 + tool 入参兜底
   │   其余：assets/[id]（图片读出）· projects/(+[id]、[id]/state)（列表/删除/状态）· asr（语音）
Agent 核心  src/agent/orchestrator.ts —— 单脑 Opus 4.8 + stopWhen + 工具集 + Run 记录
   │   system = src/agent/system-prompt.ts（PREAMBLE + 决策型 skills + 2 rubrics）
   ├── 工具  src/tools/*（Zod）
   ├── 判图  src/agent/inspect.ts（generateObject + Opus 4.8）
   └── 知识  src/knowledge/*（大脑的领域参考）
上传    src/lib/attachments.ts —— 上传先资产化；发给模型前 docx(mammoth)/xlsx(ExcelJS) 服务端提取，图/PDF 临时还原为 file part
语音    src/lib/asr/{funasr,cleanup}.ts + components/VoiceInputButton.tsx
模型层  src/models/gateway.ts —— 全部经 Vercel AI Gateway（ASR 例外）
存储层  src/lib/storage.ts —— 本地 .data/projects/<id>/（state.json + assets/*.png）+ 写锁
```

## 一次请求的流
用户消息 → `/api/agent` 创建 `Run` → 附件引用按需还原/提取 → 大脑循环：`read_project_state` →（需拍板）`present_choices` 出卡片 + 俯视布局草图 → `update_brief` 落已确认事实 → `update_spec` 写方案（含 **identity 身份锁定**，并清空旧 layout 决策）→ `present_layout` 写入 `layout.status=pending` 并自动弹编辑器 → 用户确认截图（`layout.status=confirmed + planAssetId`）或跳过（`layout.status=skipped`）→ 出图：`render`（**唯一入口**，final 模式代码层要求 spec.identity + layout confirmed/skipped；内部按 intent/views/planAssetId 自动选 单张 best-of-N / 多视角进化链 / 平面图条件化）→ 看返回 Deliverable 的 recommendedId + issues →（硬伤）`revise_asset` 局部精修 → `task_complete` → Run 记录 step/tool/deliverable/status，全程流式回前端。

## Loop Agent 机制（`src/agent/orchestrator.ts`）
- `model` = Opus 4.8（经 Gateway）。
- `stopWhen = [hasToolCall('task_complete'), imageBudget(16), stepCountIs(16)]`：正常由大脑 `task_complete` 退出；`imageBudget`（统计 `render` 的 n×(1+视角) + revise 次数）与步数上限是**防失控兜底**。
- `system` 由 `system-prompt.ts` 装配：PREAMBLE + **决策型** 7 skill + 2 rubric。**执行型知识**（prompt-craft/examples/materials/styles/reference-editing/multiview）下沉到 `prompt-writer` 子 agent（D26 知识分流，抗大脑上下文污染）。
- **Run 记录**：每轮 `/api/agent` 创建 `run-...`，写到 `.data/projects/<id>/runs/<runId>.json`，项目状态保留最近 30 条摘要；`onStepFinish` 记录 step/tool 摘要，`render`/`revise_asset` 记录 Deliverable，`onFinish/onError/onAbort` 收口状态。
- **模型分档现状**：主脑恒 Opus；判图（inspect）与写图 prompt（prompt-writer）在工具内部共用 Opus 4.8（D27 质量优先，成本更高），无需 `prepareStep` 切模型。

## 工具注册表（`src/tools/*`，Zod schema）
| 工具 | 作用 | 模型 | 关键 I/O |
|---|---|---|---|
| `read_project_state` | 读 brief / spec / layout / 资产**摘要** / 最近 Run（瘦身：不回长 prompt + 判图史） | — | → {brief, spec, layout, recentRuns, assets[]摘要} |
| `present_choices` | **卡片提问**：结构化选项 + 俯视布局 layout 数据，前端渲染可点卡片（零打字）+ FloorPlan 草图 | — | intro/locked/questions[] → 透传渲染 |
| `analyze_reference` | 看参考图抽设计语言 | Opus(vision) | imageUrl → analysis |
| `update_brief` | **写业务记忆**：增量并入已确认事实（面积/墙高/行业/品牌/必含区/硬约束）| — | facts(record) → 合并进 brief |
| `update_spec` | 写 DesignSpec 存盘（含 **identity 身份锁定**） | — | narrative / **identity** / invariants / selfCheckCriteria |
| `present_layout` | **方案定稿后推布局**：规范化 layout，写 `layout.status=pending`，前端据此**自动弹布局编辑器**让用户精调 / 跳过 | — | intro / layout → 透传，前端弹 LayoutEditor |
| `render` | **唯一生图入口**：给**中文意图**，内部 prompt-writer 写英文 prompt；final 模式硬要求 spec.identity + layout confirmed/skipped；按 intent/views/planAssetId 自动选 单张 best-of-N / 进化链多视角 / 平面图条件化 | gpt-image-2 + Gemini + **Opus** | intent / views / planAssetId / mode / n / quality → **Deliverable** |
| `revise_asset` | **参考图局部精修**：只改一处其余不变；给**中文** fix，内部 prompt-writer 翻英文 | Gemini + **Opus** | parentAssetId / fix(中文) → **Deliverable** |
| `task_complete` | 声明完成、退出循环 | — | summary / delivered / gaps |

## 模型矩阵（`src/models/gateway.ts`）
| 角色 | 模型 | 经由 |
|---|---|---|
| 脑（对话+工程） | `anthropic/claude-opus-4.8` | Gateway（`gateway.languageModel`）|
| 文生图 | `openai/gpt-image-2` | **OpenAI SDK 经 Gateway** `https://ai-gateway.vercel.sh/v1`（精确控 quality/size/n）|
| 参考条件化 / 编辑 | `google/gemini-3-pro-image`（默认）/ `gpt-image-2`（有 `OPENAI_API_KEY` 时直连）| Gemini 经 Gateway（`generateText`+image）；**gpt-image-2 经 Gateway 图输入实测全不通（D27），要用须直连 OpenAI `images.edit`** |
| 判图 + 写 prompt(worker) | `anthropic/claude-opus-4.8`（用户指定升 Opus，质量优先）| Gateway；`MODEL_IDS.inspect` 共用，prompt-writer 也走它 |
| 语音清理 | `deepseek/deepseek-v4-flash` | Gateway（ASR 后处理：去语气词 / 顺逻辑 / 修同音错字）|
| ASR | DashScope `fun-asr-realtime` | 直连（唯一非 Gateway 例外，**已接线**，China region）|
| 视频 | —— | 砍 |

## 知识层（`src/knowledge/`）
15 块知识，**D26 分流**：大脑 system 只装 7 个决策型 skill + 2 rubric（`questioning`/`inspection`）；6 个执行型 skill（prompt-craft/examples/materials-lighting/styles/reference-and-editing/multiview）下沉到 `prompt-writer` 子 agent。由旧 rhemax skill 去 FSM 重组而来，详见 `src/knowledge/README.md`。

## 存储（`src/lib/storage.ts`，本地 FS）
`.data/projects/<id>/state.json`（`ProjectState`: brief / spec / layout / assets / attachments / runs 摘要）+ `assets/<assetId>.png` + `attachments/<attachmentId>.*` + `runs/<runId>.json` + **`conversation.json`（对话历史，流式存盘；附件为轻量 URL 引用）**。**projectId-keyed 隔离**（默认 `DEFAULT_PROJECT='default'`）；`listProjects`/`deleteProject` 支撑项目面板；`mergeBrief` 写业务记忆 brief；`saveConversation`/`loadConversation` 支撑对话持久化；**per-project `withLock` 写锁**串行化；**`deleteProject` 先立进程内 tombstone**——拦截删除后飞行中的生图/附件/对话回写，杜绝已删项目被重建复活。类型见 `src/lib/types.ts`。

## 前端（`src/app/projects/[projectId]/page.tsx`，三栏暗色工程制图工作台）
**左**项目面板（列表 / 切换 / 新建 / 删除 / 高亮）｜ **中**对话（`useChat`；文字 / 语音 / 上传；上传先走 `/api/projects/:id/attachments` 资产化，再以轻量 FileUIPart 发送；assistant 走 **react-markdown** 渲染；需拍板时 `present_choices` → **ChoiceCards** 可点卡片 + **FloorPlan** 数据驱动俯视草图；方案后 `present_layout` 自动弹 **LayoutEditor**(react-konva) 拖拽/缩放/L形 → 截图存 reference → `render(planAssetId)` 出图，或跳过写 `layout.status=skipped`；交付图标"推荐"、单击放大；工具过程仅"调试"可见）｜ **右**资产画廊。**对话持久化**：流式增量存盘（`/api/projects/:id/messages`，`pidRef` 防串项目），切项目 / 刷新不丢。`src/app/page.tsx` 仅 `redirect('/projects/default')`。

## 文件树（标注）
```
src/
  app/
    page.tsx                       redirect → /projects/default
    projects/[projectId]/page.tsx  三栏工作台（项目面板/对话/画廊/上传/lightbox）
    api/agent/route.ts             Orchestrator 入口（streamText + 附件预处理 + 入参兜底）
    api/assets/[id]/route.ts       本地图片读出
    api/projects/route.ts          项目列表（GET）
    api/projects/[projectId]/route.ts        删除项目（DELETE）
    api/projects/[projectId]/state/route.ts     项目状态（GET）
    api/projects/[projectId]/messages/route.ts  对话历史（GET/POST，持久化）
    api/projects/[projectId]/attachments/route.ts 上传附件资产化（POST）
    api/projects/[projectId]/attachments/[attachmentId]/route.ts 附件读出（GET）
    api/projects/[projectId]/reference/route.ts 存编辑器平面图为 reference 资产（POST）
    api/projects/[projectId]/layout/route.ts    布局跳过决策（POST）
    api/asr/route.ts               语音转写 + 清理（唯一非 Gateway）
    layout-demo/page.tsx           布局编辑器独立演示页
  agent/
    orchestrator.ts                工具集 + stopWhen + 预算
    system-prompt.ts               装配 system prompt（PREAMBLE + 知识层）
    inspect.ts                     结构化判图 helper（generateObject + Sonnet）
    prompt-writer.ts               写图 prompt 子 agent（中文意图 → 英文 prompt，带执行型知识）
  tools/                           8 个 Zod 工具（见上表：render 唯一生图入口 / present_choices / update_brief 等）
  models/gateway.ts                模型句柄（Gateway / OpenAI 兼容端点）
  knowledge/                       D26 分流：大脑 7 决策型 skill + 2 rubric；prompt-writer 拿 6 执行型 skill
  lib/
    storage.ts  types.ts           本地存储（projectId-keyed + 写锁）+ 数据类型
    attachments.ts                 附件引用还原 + docx→mammoth / xlsx→ExcelJS（含上传门限）
    layout.ts                      BoothLayout schema + 规范化/裁剪
    asr/{funasr,cleanup}.ts        Fun-ASR 转写 + DeepSeek 清理
  components/VoiceInputButton.tsx  录音按钮（前端）
  components/LayoutEditor.tsx      react-konva 2D 布局编辑器（拖拽/缩放/L形/导出 PNG）
scripts/*.mjs                      spike：连通/并发/画质/多视图/ASR/上传/一致性/进化链/pipeline
docs/                              本套文档
.data/                             本地资产与状态（gitignored）
.env.local                        密钥（gitignored）
```
