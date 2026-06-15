# Rhemos · 架构（as-built）

> 当前已建状态（Phase 0-4 + UI 颠覆 / 卡片提问 / 工业级一致性 pipeline / 布局编辑器）。路线图见 [`engineering-plan.md`](engineering-plan.md)；为何这么定见 [`DECISIONS.md`](DECISIONS.md)。

## 分层
```
前端 UI  src/app/projects/[projectId]/page.tsx —— 三栏工作台（项目面板/对话/画廊）
   │        useChat + 上传(图/PDF/Word/Excel) + 语音 + lightbox（page.tsx 仅 redirect→default）
   │ SSE (UI message stream)
API     src/app/api/agent/route.ts —— streamText(orchestrator)；附件预处理 + tool 入参兜底
   │   其余：assets/[id]（图片读出）· projects/(+[id]、[id]/state)（列表/删除/状态）· asr（语音）
Agent 核心  src/agent/orchestrator.ts —— 单脑 Opus 4.8 + stopWhen + 工具集
   │   system = src/agent/system-prompt.ts（PREAMBLE + 全部 skills + 2 rubrics）
   ├── 工具  src/tools/*（Zod）
   ├── 判图  src/agent/inspect.ts（generateObject + Sonnet 4.6）
   └── 知识  src/knowledge/*（大脑的领域参考）
上传    src/lib/attachments.ts —— docx(mammoth)/xlsx(ExcelJS) 服务端提取（大小/行数/文本上限防护）；图/PDF 原生
语音    src/lib/asr/{funasr,cleanup}.ts + components/VoiceInputButton.tsx
模型层  src/models/gateway.ts —— 全部经 Vercel AI Gateway（ASR 例外）
存储层  src/lib/storage.ts —— 本地 .data/projects/<id>/（state.json + assets/*.png）+ 写锁
```

## 一次请求的流
用户消息 → `/api/agent` → 大脑循环：`read_project_state` →（需拍板）`present_choices` 出卡片 + 俯视布局草图（用户点选 / 进 LayoutEditor 精调截图）→ `update_brief` 落已确认事实 → `update_spec` 写方案（含 **identity 身份锁定**）→ 出图：`generate_best_of_n`（单张）/ `generate_views`（多视角进化链）/ `render_from_plan`（按编辑器平面图条件化）→ 看 recommended + fails →（硬伤）`revise_asset` 参考图局部修 → `task_complete` → 全程流式回前端（文字 + 卡片 + 工具部件 + 图）。

## Loop Agent 机制（`src/agent/orchestrator.ts`）
- `model` = Opus 4.8（经 Gateway）。
- `stopWhen = [hasToolCall('task_complete'), imageBudget(16), stepCountIs(16)]`：正常由大脑 `task_complete` 退出；`imageBudget`（统计 best_of_n / generate_views / render_from_plan 的 n×视角 + revise 次数）与步数上限是**防失控兜底**。
- `system` 由 `system-prompt.ts` 装配：PREAMBLE（工具说明 + 工作循环 + 速度/预算 + 铁律）+ 13 skill + 2 rubric 全量。
- **模型分档天然成立**：主脑恒 Opus；判图在工具内部用 Sonnet 4.6（省钱），无需 `prepareStep` 切模型。

## 工具注册表（`src/tools/*`，Zod schema）
| 工具 | 作用 | 模型 | 关键 I/O |
|---|---|---|---|
| `read_project_state` | 读 brief / spec / 资产清单 | — | → {brief, spec, assets} |
| `present_choices` | **卡片提问**：结构化选项 + 俯视布局 layout 数据，前端渲染可点卡片（零打字）+ FloorPlan 草图 | — | intro/locked/questions[] → 透传渲染 |
| `analyze_reference` | 看参考图抽设计语言 | Opus(vision) | imageUrl → analysis |
| `update_brief` | **写业务记忆**：增量并入已确认事实（面积/墙高/行业/品牌/必含区/硬约束）| — | facts(record) → 合并进 brief |
| `update_spec` | 写 DesignSpec 存盘（含 **identity 身份锁定**） | — | narrative / **identity** / invariants / selfCheckCriteria |
| `generate_best_of_n` | 单张生图：并行 N≤2 + 判图择优（+ 画风锚） | gpt-image-2 + Sonnet | prompt/n/quality/size/criteria → {candidates[], recommended} |
| `generate_views` | **多视角交付主力**：主图 best-of-N → identity + 累积参考链 + 判图门控 出单视角全套 | gpt-image-2 + Gemini + Sonnet | frontPrompt/identity/views/criteria → {hero, views[]} |
| `render_from_plan` | **平面图条件化**：以编辑器定稿的俯视平面图为硬参考出贴合布局的 3D + 多视角 | Gemini + Sonnet | planAssetId/identity/views → {hero, views[]} |
| `render_multiview_sheet` | 2×2 turnaround sheet —— **仅快速对齐探索**，不做最终交付 | gpt-image-2 + Sonnet | booth/n/quality/size → {sheets[], recommended} |
| `inspect_result` | 临时核对 / 复检 | Sonnet | assetId/criteria → {score, fails, summary} |
| `revise_asset` | **参考图局部编辑**：加载原图作参考、只改一处其余不变 | Gemini + Sonnet | parentAssetId/fix/criteria → {asset, 复检} |
| `task_complete` | 声明完成、退出循环 | — | summary / delivered / gaps |

## 模型矩阵（`src/models/gateway.ts`）
| 角色 | 模型 | 经由 |
|---|---|---|
| 脑（对话+工程） | `anthropic/claude-opus-4.8` | Gateway（`gateway.languageModel`）|
| 文生图 | `openai/gpt-image-2` | **OpenAI SDK 经 Gateway** `https://ai-gateway.vercel.sh/v1`（精确控 quality/size/n）|
| 参考条件化 / 编辑 | `google/gemini-3-pro-image` | Gateway（`generateText` + input image part）—— 换角度 / 平面图条件化 / 局部编辑，一致性标杆（**纠正 D17**：图像编辑可用，走此路而非 `images.edit`）|
| 判图 | `anthropic/claude-sonnet-4.6` | Gateway；候选 `INSPECT_CANDIDATES`（基准测试待做）|
| 语音清理 | `deepseek/deepseek-v4-flash` | Gateway（ASR 后处理：去语气词 / 顺逻辑 / 修同音错字）|
| ASR | DashScope `fun-asr-realtime` | 直连（唯一非 Gateway 例外，**已接线**，China region）|
| 视频 | —— | 砍 |

## 知识层（`src/knowledge/`）
13 个 skill + 2 个 rubric（`questioning` / `inspection`），由 `system-prompt.ts` 全量装进 system prompt（缓存）。是大脑的领域参考与判断工具，由旧 rhemax skill 去 FSM 重组而来。详见 `src/knowledge/README.md`。

## 存储（`src/lib/storage.ts`，本地 FS）
`.data/projects/<id>/state.json`（`ProjectState`: brief / spec / assets）+ `assets/<assetId>.png` + **`conversation.json`（对话历史，流式存盘）**。**projectId-keyed 隔离**（默认 `DEFAULT_PROJECT='default'`）；`listProjects`/`deleteProject` 支撑项目面板；`mergeBrief` 写业务记忆 brief；`saveConversation`/`loadConversation` 支撑对话持久化；**per-project `withLock` 写锁**串行化；**`deleteProject` 先立进程内 tombstone**——拦截删除后飞行中的生图回写，杜绝已删项目被重建复活。类型见 `src/lib/types.ts`（`Asset` / `DesignSpec`(含 **identity 身份锁定串**) / `ProjectState` / `ProjectSummary`）。**并行生图先并行拿字节、再顺序 `saveAsset`**（避免竞写）。

## 前端（`src/app/projects/[projectId]/page.tsx`，三栏暗色工程制图工作台）
**左**项目面板（列表 / 切换 / 新建 / 删除 / 高亮）｜ **中**对话（`useChat`；文字 / 语音 / 上传；assistant 走 **react-markdown** 渲染；需拍板时 `present_choices` → **ChoiceCards** 可点卡片 + **FloorPlan** 数据驱动俯视草图，可"精调出图"拖入 **LayoutEditor**(react-konva) 拖拽/缩放/L形 → 截图存 reference → `render_from_plan` 出图；交付图标"推荐"、单击放大；工具过程仅"调试"可见）｜ **右**资产画廊。**对话持久化**：流式增量存盘（`/api/projects/:id/messages`，`pidRef` 防串项目），切项目 / 刷新不丢。`src/app/page.tsx` 仅 `redirect('/projects/default')`。

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
    api/projects/[projectId]/reference/route.ts 存编辑器平面图为 reference 资产（POST）
    api/asr/route.ts               语音转写 + 清理（唯一非 Gateway）
    layout-demo/page.tsx           布局编辑器独立演示页
  agent/
    orchestrator.ts                工具集 + stopWhen + 预算
    system-prompt.ts               装配 system prompt（PREAMBLE + 知识层）
    inspect.ts                     结构化判图 helper（generateObject + Sonnet）
  tools/                           12 个 Zod 工具（见上表：present_choices / update_brief / generate_views / render_from_plan 等）
  models/gateway.ts                模型句柄（Gateway / OpenAI 兼容端点）
  knowledge/                       13 skill + 2 rubric（领域知识层）
  lib/
    storage.ts  types.ts           本地存储（projectId-keyed + 写锁）+ 数据类型
    attachments.ts                 上传附件提取（docx→mammoth / xlsx→SheetJS）
    asr/{funasr,cleanup}.ts        Fun-ASR 转写 + DeepSeek 清理
  components/VoiceInputButton.tsx  录音按钮（前端）
  components/LayoutEditor.tsx      react-konva 2D 布局编辑器（拖拽/缩放/L形/导出 PNG）
scripts/*.mjs                      spike：连通/并发/画质/多视图/ASR/上传/一致性/进化链/pipeline
docs/                              本套文档
.data/                             本地资产与状态（gitignored）
.env.local                        密钥（gitignored）
```
