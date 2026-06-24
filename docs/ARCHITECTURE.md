# Rhemos · 架构（as-built）

> 当前已建状态（Phase 0-4 + UI 颠覆 / 卡片提问 / 首稿候选选择 / 工业级一致性 pipeline / 布局编辑器）。路线图见 [`engineering-plan.md`](engineering-plan.md)；为何这么定见 [`DECISIONS.md`](DECISIONS.md)。

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
模型层  src/models/gateway.ts + image-providers.ts —— 多来源：脑/判图/写prompt/语音清理经 Gateway · gpt-image-2 经 fal.ai · ASR 经 DashScope 直连
存储层  src/lib/storage.ts —— 本地 .data/projects/<id>/（state.json + assets/*.png）+ 写锁
```

## 一次请求的流
用户消息 → `/api/agent` 创建 `Run` → 附件引用按需还原/提取 → 大脑循环：`read_project_state` →（需拍板）`present_choices` 出卡片 + 俯视布局草图（布局骨架一次只问一个，用户选完再重排下一问）→ `update_brief` 落已确认事实 → `update_spec` 写方案（含 **identity 身份锁定 + footprint 外轮廓硬规则**，未明确异形时默认严格矩形，narrative 引用 layout 对象 ID）→ `present_layout` 写入对象级 `layout.status=pending` 并自动弹编辑器 → 用户确认截图 + 对象级坐标（`layout.status=confirmed + planAssetId + proposal`）或跳过（`layout.status=skipped`）→ `render(views=[], n=2, autoCheck=false)` 把截图作为 floor_plan 参考，并把 `layout.proposal` 注入最终 prompt 的对象表硬锁，生成 **candidate-set 首稿候选**（候选图片落盘但不进入正式 assets）→ 用户在对话里点“选为基准” → `/api/projects/:id/assets/:assetId/promote` 把该候选加入正式资产库并写 `baseAssetId` → 用户明确要求多视角/俯视/深化时，`render(views=[...])` 只从 `baseAssetId` 继续 → 必要时 `revise_asset` 局部精修 → `task_complete` → Run 记录 step/tool/deliverable/status，全程流式回前端。

## Loop Agent 机制（`src/agent/orchestrator.ts`）
- `model` = Opus 4.8（经 Gateway）。
- `stopWhen = [hasToolCall('task_complete'), imageBudget(16), stepCountIs(16)]`：正常由大脑 `task_complete` 退出；`imageBudget`（统计 `render` 的 n×(1+视角) + revise 次数）与步数上限是**防失控兜底**。
- `system` 由 `system-prompt.ts` 装配：PREAMBLE + **决策型** 7 skill + 2 rubric。**执行型知识**（prompt-craft/examples/materials/styles/reference-editing/multiview）下沉到 `prompt-writer` 子 agent（D26 知识分流，抗大脑上下文污染）。
- **Run 记录**：每轮 `/api/agent` 创建 `run-...`，写到 `.data/projects/<id>/runs/<runId>.json`，项目状态保留最近 30 条摘要；`onStepFinish` 记录 step/tool 摘要，`render`/`revise_asset` 记录 Deliverable，`onFinish/onError/onAbort` 收口状态。
- **模型分档现状**：主脑恒 Opus；判图（inspect）与写图 prompt（prompt-writer）在工具内部共用 Opus 4.8（D27 质量优先，成本更高），无需 `prepareStep` 切模型。

## 工具注册表（`src/tools/*`，Zod schema）
| 工具 | 作用 | 模型 | 关键 I/O |
|---|---|---|---|
| `read_project_state` | 读 brief / spec / layout / `baseAssetId` / 资产**摘要** / 最近 Run（瘦身：不回长 prompt + 判图史） | — | → {brief, spec, layout, baseAssetId, recentRuns, assets[]摘要} |
| `present_choices` | **卡片提问**：结构化选项 + 对象级俯视布局 layout 数据，前端渲染可点卡片（零打字）+ FloorPlan 草图；布局骨架问题强制一次 1 个，且文字语义与 layout 冲突会被工具拒绝 | — | intro/locked/questions[] → 透传渲染 |
| `analyze_reference` | 看参考图抽设计语言 | Opus(vision) | imageUrl → analysis |
| `update_brief` | **写业务记忆**：增量并入已确认事实（面积/墙高/行业/品牌/必含区/硬约束）| — | facts(record) → 合并进 brief |
| `update_spec` | 写 DesignSpec 存盘（含 **identity 身份锁定 + footprint 外轮廓硬规则**） | — | narrative / **identity** / footprint / invariants / selfCheckCriteria |
| `present_layout` | **方案定稿后推布局**：规范化对象级 layout，写 `layout.status=pending`，前端据此**自动弹布局编辑器**让用户精调 / 跳过 | — | intro / layout → 透传，前端弹 LayoutEditor |
| `render` | **唯一生图入口**：给**中文意图**，内部 prompt-writer 写英文 prompt；final 模式硬要求 spec.identity + layout confirmed/skipped；按平面图出图时同时使用 reference PNG 和 `layout.proposal` 对象表硬锁（ID/type/shape/height/facing/material/description）；默认输出 `candidate-set` 首稿候选，用户选 `baseAssetId` 后才允许 views 多视角深化；`autoCheck` 默认 false | gpt-image-2(fal) + **Opus prompt-writer** | intent / views / planAssetId / mode / n / quality / autoCheck → **Deliverable** |
| `revise_asset` | **参考图局部精修**：只改一处其余不变；给**中文** fix，内部 prompt-writer 翻英文 | gpt-image-2(fal)/Gemini + **Opus** | parentAssetId / fix(中文) → **Deliverable** |
| `task_complete` | 声明完成、退出循环 | — | summary / delivered / gaps |

## 模型矩阵（`src/models/gateway.ts` + `src/models/image-providers.ts`）
| 角色 | 模型 | 经由 |
|---|---|---|
| 脑（对话+工程） | `anthropic/claude-opus-4.8` | Gateway（`gateway.languageModel`）|
| 文生图 | `openai/gpt-image-2` | **fal.ai**（`fal.run/openai/gpt-image-2`，`falTextToImage`）；本地测试期默认 quality medium（fal API 速度 ≠ ChatGPT 体感）|
| 参考条件化 / 编辑 | `openai/gpt-image-2` | **fal `…/edit`**（`falEditFromRefs`，base64 data URI 多图参考）。当前不自动回退 Gemini；历史 D27：gpt-image-2 经 Gateway 图输入不通，现走 fal。|
| 判图 + 写 prompt(worker) | `anthropic/claude-opus-4.8`（用户指定升 Opus，质量优先）| Gateway；`MODEL_IDS.inspect` 共用，prompt-writer 也走它 |
| 语音清理 | `deepseek/deepseek-v4-flash` | Gateway（ASR 后处理：去语气词 / 顺逻辑 / 修同音错字）|
| ASR | DashScope `fun-asr-realtime` | 直连（非 Gateway 例外，China region）|
| 视频 | —— | 砍 |

> **多来源例外**：gpt-image-2 经 **fal.ai**、ASR 经 **DashScope** 直连，其余经 Gateway。`image-providers.ts` 把 `textToImage`/`editFromRefs` 收口为 provider 层——生产化时在一处切 OpenAI 直连 / Gateway / fal / Seedream，详见 [DECISIONS](DECISIONS.md) D29/D34。

## 知识层（`src/knowledge/`）
15 块知识，**D26 分流**：大脑 system 只装 7 个决策型 skill + 2 rubric（`questioning`/`inspection`）；6 个执行型 skill（prompt-craft/examples/materials-lighting/styles/reference-and-editing/multiview）下沉到 `prompt-writer` 子 agent。由旧 rhemax skill 去 FSM 重组而来，详见 `src/knowledge/README.md`。

## 存储（`src/lib/storage.ts`，本地 FS）
`.data/projects/<id>/state.json`（`ProjectState`: brief / spec / layout / `baseAssetId` / assets / attachments / runs 摘要）+ `assets/<assetId>.png` + `candidates/<candidateId>.json`（首稿候选 metadata，未选中前不进 `state.assets`）+ `attachments/<attachmentId>.*` + `runs/<runId>.json` + **`render-inputs/<snapshotId>.json`（D32 生图输入快照：prompt/provider/refs/spec·layout 摘要/规则问题，不含 base64）** + **`asset-analyses/<id>.json`（D33 上传素材的结构化理解，不含 base64）** + **`conversation.json`（对话历史，流式存盘；附件为轻量 URL 引用）**。**projectId-keyed 隔离**（默认 `DEFAULT_PROJECT='default'`）；`listProjects`/`deleteProject` 支撑项目面板；`mergeBrief` 写业务记忆 brief；`saveConversation`/`loadConversation` 支撑对话持久化；**per-project `withLock` 写锁**串行化；**`deleteProject` 先立进程内 tombstone**——拦截删除后飞行中的生图/附件/对话回写，杜绝已删项目被重建复活。类型见 `src/lib/types.ts`。

## 前端（`src/app/projects/[projectId]/page.tsx`，三栏暗色工程制图工作台）
**左**项目面板（列表 / 切换 / 新建 / 删除 / 高亮）｜ **中**对话（`useChat`；文字 / 语音 / 上传；上传先走 `/api/projects/:id/attachments` 资产化，再以轻量 FileUIPart 发送；assistant 走 **react-markdown** 渲染；需拍板时 `present_choices` → **ChoiceCards** 可点卡片 + **FloorPlan** 数据驱动俯视草图，布局类只显示当前一步；方案后 `present_layout` 自动弹 **LayoutEditor**(react-konva) 对象库/拖拽/缩放/属性面板/撤销重做/规则提示 → 截图存 reference，并把拖拽后的对象坐标写回 `layout.proposal` → 首稿 `candidate-set` 两张候选；候选图按钮“选为基准”会调用 promote API，选中后才进右侧资产画廊；工具过程仅"调试"可见）｜ **右**资产画廊。**对话持久化**：流式增量存盘（`/api/projects/:id/messages`，`pidRef` 防串项目），切项目 / 刷新不丢。`src/app/page.tsx` 仅 `redirect('/projects/default')`。

## 测试 / 质量闭环（D31）
- **单测**：`npm run test`（Vitest，node 环境）。`src/lib/booth-rules.test.ts` 覆盖 12 类展台规则 + `openingRelation`；`src/lib/booth-cases.test.ts` 跑 `fixtures/booth-cases/basic-cases.json`（10 个真实案例）做回归——**纯函数、不调模型、不需 key、不联网**。
- **生成可观测**：每次 render / revise 把 `provider/model/quality/size/mode/durationMs` 写进 asset 元数据 + 一条 run 事件——fal 慢可统计，为对比多 provider 留入口。
- **生图输入快照（D32）**：每次调 provider **前**写 `render-inputs/<id>.json`（最终 prompt / refs / spec·layout 摘要 / 规则问题，不含 base64，provider 失败也留），asset 关联 `renderInputId` → 任一张图可复现/追溯；`read_project_state` 只回 ≤5 条轻量摘要。
- **素材链路（D33）**：上传 → Attachment → AssetAnalysis（启发式分类 + Office/文本轻量提取，不调 vision/OCR，上传后自动生成、失败不阻断）→ selectedAttachments（选材，去重）→ RenderInputSnapshot（attachment refs）→ Asset（`sourceAttachmentIds`）。`asset-analysis.test.ts` 覆盖分类/存储/截断/选材去重。
- **provider 可配置**：`IMAGE_PROVIDER`（默认 fal）；未知值抛清晰错误，openai/seedream/gemini 预留接口调用即抛"未实现"（不伪造）。

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
    api/projects/[projectId]/assets/[assetId]/promote/route.ts  首稿候选选为基准（POST）
    api/projects/[projectId]/layout/route.ts    布局跳过决策（POST）
    api/asr/route.ts               语音转写 + 清理（唯一非 Gateway）
    layout-demo/page.tsx           布局编辑器独立演示页
  agent/
    orchestrator.ts                工具集 + stopWhen + 预算
    system-prompt.ts               装配 system prompt（PREAMBLE + 知识层）
    inspect.ts                     结构化判图 helper（generateObject + Opus；含分维度 dimensions）
    prompt-writer.ts               写图 prompt 子 agent（中文意图 → 英文 prompt，带执行型知识）
  tools/                           8 个 Zod 工具（见上表：render 唯一生图入口 / present_choices / update_brief 等）
  models/gateway.ts                模型句柄 + fal 封装（Gateway / fal.ai / DashScope 多来源）
  models/image-providers.ts        生图 provider 抽象层 + IMAGE_PROVIDER 选择（默认 fal；textToImage/editFromRefs，留多 provider 接口）
  knowledge/                       D26 分流：大脑 7 决策型 skill + 2 rubric；prompt-writer 拿 6 执行型 skill
  lib/
    storage.ts  types.ts           本地存储（projectId-keyed + 写锁）+ 数据类型
    attachments.ts                 附件引用还原 + docx→mammoth / xlsx→ExcelJS（含上传门限）
    layout.ts                      BoothLayout schema + 规范化/裁剪
    booth-rules.ts                 最小展台规则引擎（纯函数 15 条，present-layout/choices/render 接入）
    booth-rules.test.ts            booth-rules 单测（Vitest，12 类规则 + openingRelation）
    booth-cases.test.ts            真实案例回归（读 fixtures，跑规则，不调模型）
    render-inputs.test.ts          RenderInputSnapshot 存储单测（save/read/list/asset 关联）
    asset-analysis.ts              用户素材分析层（D33 启发式分类 + Office/文本轻量提取 + 选材推导）
    asset-analysis.test.ts         AssetAnalysis 单测（分类/存储/截断/选材去重）
    asr/{funasr,cleanup}.ts        Fun-ASR 转写 + DeepSeek 清理
  components/VoiceInputButton.tsx  录音按钮（前端）
  components/LayoutEditor.tsx      react-konva 2D 布局编辑器（拖拽/缩放/L形/导出 PNG）
scripts/*.mjs                      spike：连通/并发/画质/多视图/ASR/上传/一致性/进化链/pipeline/fal
fixtures/booth-cases/*.json        真实展台案例回归集（不调模型）
vitest.config.ts                   Vitest 配置（node 环境，纯逻辑单测）
docs/                              本套文档
.data/                             本地资产与状态（gitignored）
.env.local                        密钥（gitignored）
.env.example                       环境变量样例（含 IMAGE_PROVIDER；勿填真实 key）
```
