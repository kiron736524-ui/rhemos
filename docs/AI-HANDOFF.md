# Rhemos · AI 冷启动导航

读完这一篇 + 它指向的链接，你就能全知识冷启动、抓住每个关键决策点。

## 心智模型（30 秒）
单一大脑（默认 Sonnet 4.6，可配置升 Opus）+ 多工具的 **Loop Agent**。**控制流 = 大脑的推理，不是状态机。** 当前产品默认链路是：澄清 → 写 DesignSpec（含 footprint 外轮廓硬规则）→ 布局确认/跳过 → 首稿 `candidate-set` 两张候选 → 用户点选基准图 → 再按需多视角/俯视/精修。旧 rhemax 的 FSM + 模板被**刻意丢弃**（见 [DECISIONS](DECISIONS.md) D7）；**判图/打分已删除（D39）**，选择权交还用户，多视角一致性靠**进化式参考链**（串行累积、无门控）。

## 60 秒定位：想改 X → 去看 Y
| 想做什么 | 去哪 |
|---|---|
| 换模型 / 模型句柄 | `src/models/gateway.ts`（脑默认 Sonnet / prompt-writer 默认 Opus / 成本解释 DeepSeek / gpt-image-2 经 **fal.ai**）+ `src/models/image-providers.ts`（**fal 锁定薄封装** `textToImage`/`editFromRefs`，D39）；画风锚 `withRenderStyle` |
| 改大脑行为 / 工作循环 / 铁律 | `src/agent/system-prompt.ts`（PREAMBLE）|
| 改领域知识（决策型在大脑 / 执行型在 prompt-writer）| `src/knowledge/skills/*` + `src/knowledge/rubrics/*`（D26 分流：大脑装决策型 7 skill + 2 rubric；写图细节 6 skill 归 `prompt-writer`）|
| 加 / 改工具 | `src/tools/*.ts` → 注册在 `src/agent/orchestrator.ts` |
| 循环退出 / 生图预算 / Run 记录 | `src/agent/orchestrator.ts`（`stopWhen` / `imageBudget`）+ `src/app/api/agent/route.ts`（创建 runId、记录 step/finish）+ `src/lib/storage.ts`（runs 文件）|
| 几何单一来源（EDGES / 贴边 touchesEdge·hugsEdge / 面积 / footprint）| `src/lib/geometry.ts`（booth-rules / cad / present-choices 共用，D39）|
| 布局机读契约 / CAD 硬锁 | `src/lib/cad.ts`（`BoothLayout` → Rhemos CAD v1；render prompt 的布局 source of truth）|
| 存储 / 数据形状 / 项目列表 / 业务记忆 | `src/lib/storage.ts`（projectId-keyed + 写锁 + `listProjects`/`deleteProject` + `mergeBrief` 写 brief + 附件/Run/layout 状态 + 删除 tombstone 防复活）+ `src/lib/types.ts` |
| API 入口 | `src/app/api/agent/route.ts`（Run 创建 + 附件引用预处理 + 历史工具输出/旧文本瘦身 + tool 入参兜底）；图片读出 `assets/[id]`；附件资产化 `projects/[id]/attachments`；项目列表/删除/状态；语音 `asr` |
| 上传附件资产化 + 提取（docx→文字+内嵌图 / xlsx→CSV，含大小/行数/文本上限）| `src/app/api/projects/[projectId]/attachments/*` + `src/lib/attachments.ts`（mammoth / ExcelJS）|
| brief 业务记忆写入 | `src/tools/update-brief.ts` + `storage.mergeBrief`（澄清拍板后增量落事实）|
| 语音输入 ASR | `src/lib/asr/{funasr,cleanup}.ts` + `src/components/VoiceInputButton.tsx` |
| 前端工作台（三栏暗色科技）| `src/app/projects/[projectId]/page.tsx`（面板 / 对话 / 画廊 / 上传 / **卡片** / **markdown** / lightbox）；`src/app/page.tsx` 仅 redirect→default |
| 卡片提问 / 选项卡 + 俯视草图 | `src/tools/present-choices.ts` + 前端 `ChoiceCards`/`FloorPlan`（page.tsx）|
| 布局编辑器（拖拽/缩放/L形/截图喂生图）| `src/components/LayoutEditor.tsx`(react-konva) + `/layout-demo` 演示页；布局 schema/裁剪在 `src/lib/layout.ts` |
| 生图（**唯一入口**）/ 多视角 / 平面图条件化 | `src/tools/render.ts`（仅编排）+ `src/tools/render/{context,candidates,views-chain}.ts`（门控+准备 / 候选三分支 / 进化链，D39 拆分）；中文意图 → prompt-writer → CAD v1 布局硬锁 → 首稿 candidate-set / 用户选定 `baseAssetId` 后的进化链多视角 / 平面图条件化；final render 硬要求 spec.identity + layout confirmed/skipped |
| 写图 prompt（子 agent）| `src/agent/prompt-writer.ts`（中文意图 → 英文五层 prompt，带执行型知识；中间产物不回流大脑）|
| 成本归因 / 余额解释 | `src/tools/estimate-cost.ts` + `src/lib/cost-estimate.ts`（读取 run usage；DeepSeek V4 Flash 低成本解释）|
| 对话持久化 | `src/lib/storage.ts`(conversation) + `api/projects/[id]/messages` + page.tsx 流式存盘 effect |
| **为什么这么设计** | `docs/DECISIONS.md` |
| 架构全貌（as-built） | `docs/ARCHITECTURE.md` |
| 路线图 / 还没做的 | `docs/engineering-plan.md` |
| 连通性 / 并发 / 画质实测脚本 | `scripts/*.mjs`（`node --env-file .env.local scripts/<x>.mjs`）|

## 不变量（不要破坏）
1. **模型多来源**（不再"唯一经 Gateway"，见 D29/D38/D39）：脑 / 写prompt / 成本解释 / 清理经 Gateway（`src/models/gateway.ts`，均可用 `RHEMOS_*_MODEL` 覆盖）；**gpt-image-2 经 fal.ai**（唯一指定生图模型 + 唯一渠道，`falTextToImage`/`falEditFromRefs`，`FAL_API_KEY`，D39）；**ASR 经 DashScope 直连**。生图统一经 `src/models/image-providers.ts`（fal 锁定薄封装）。
2. **首稿选择权给用户**：首稿默认两张候选，用户选中后才进入资产库并写 `baseAssetId`；不要自动把候选全塞进资产库。
3. **品牌无素材只占位**、不臆造文字 / Logo。
4. 知识层是大脑的**参考与判断工具**，不是死板脚本；**不要重建 FSM / blockingField** 那套调度机器。
5. `.env.local` / `.data/` 绝不入库。
6. final render 不能绕过 `update_spec` 与布局决策；要草图只能显式 `mode=concept`。
7. 外轮廓未明确异形时必须是严格矩形；环形动线/圆形吊灯/弧形灯带不能改变展台外边界。

## 实测 gotchas（踩过的坑，省你时间）
- **gpt-image-2 慢（经 fal.ai）**：low~8s / medium~30s / high~200s；**fal API 速度 ≠ ChatGPT 内部速度**，别按体感预期。本地测试期默认 `quality=medium`；`render(mode=concept)` 默认 n=1，`render(mode=final)` 首稿默认 n=2 并发。默认画幅 1024。
- **fal 同步端点返回整图、无 partial 流式预览帧**（流式进度靠 Agent 循环本身）；输出托管 URL，代码下载字节后落 asset。〔历史：曾设想生图走 Gateway / OpenAI 兼容端点 + `generateImage`——均未采用，现经 fal.ai，见 D29〕
- **首稿 best-of-N 是并行**（并发上限 2）：默认两张候选墙钟约等于单张。候选图不是正式资产，只有用户点“选为基准”后才 promote。
- **high 不能对 best-of-N + revise**（3×200s 会超时）；本地测试期不要主动升 high。
- 流式进度靠 Agent 循环本身（文字流 + 工具状态），**不是 partial 预览帧**。
- 并行生图后**顺序** `saveAsset`（否则竞写 `state.json`）。
- **文件上传两坑**（`projects/[projectId]/page.tsx`）：① file input 别 `display:none`（Safari 下 `.click()` 不弹文件框）→ 用 `<label htmlFor>` 关联 + `sr-only`；② `onChange` 里 `setFiles` 的 updater 是**延迟闭包**，别在其中读 `e.target.files`（会被同步行 `value=''` 清空）→ 先 `const picked = Array.from(e.target.files ?? [])` 再清空。
- **多轮 400**：UIMessage 回传后历史里 `tool_use.input` 可能是空串 `""` → Gateway 400。route 的 `sanitizeToolInputs` 把非对象入参兜成 `{}`。
- **历史工具输出会瘦身后再喂模型**：`conversation.json` 和 UI 历史仍完整，`/api/agent` 发送给模型前把历史 tool 输出压成文字摘要；需要准确事实时让大脑调 `read_project_state`，避免长会话被大段工具 JSON 撑爆。
- **旧文本也会按预算截断后再喂模型**：最近消息完整保留；旧用户/助手长文本按 `RHEMOS_CONTEXT_*` 限制压缩。项目事实必须落 brief/spec/layout/asset/run，不靠整段聊天全文反复送模型。
- **成本估算不是查真实账单**：`estimate_cost` 只读本地 run usage；历史 run 缺少 prompt-writer 隐藏 usage 时会低估，fal 图像费用也要看 fal 账单。
- **改 `/api/**/route.ts` 后 dev server 热重载可能不生效**：重启或 curl 闭环验证，别只读代码就认定生效（前端 bundle 与 API route 分别编译）。
- **headless 预览测不了文件上传交互**：合成 click 不弹文件框、合成 change 触发的 onChange 也别"看到事件就算验证"；真实选文件流程交给用户或 Claude-in-Chrome `file_upload` 确认。
- **图像编辑 / 参考图：走 fal `gpt-image-2/edit`**（`falEditFromRefs`，base64 data URI 多图参考）。**生图唯一 = gpt-image-2 / fal（D39）**：`image-providers.ts` 是 fal 锁定的薄封装，已删可插拔脚手架与 Gemini fallback；`fal.run` 下载有 SSRF 白名单 + 超时/重试 + AbortSignal（客户端断流可取消）。
- **多视角一致性 = 进化式参考链（无门控，D39）**：用户选中基准图后 `render(views=[...])` 串行生成，每张以 [（平面图）+ 基准图 + 已生成视角] 为累积参考。判图门控已删——每张都进参考池，漂移可能沿链传染（已知取舍）。`autoCheck` 入参已移除。
- **平面图条件化最强**：方案定稿 → `present_layout` 显示“打开编辑器 / 按原方案出图”入口 → 用户明确打开并拖好 → `toDataURL()` 截图 → `render(planAssetId, views=[], n=2)` 先出两张候选，等用户选基准；不要直接出全套。
- **附件不再进 conversation.json 存 base64**：前端发送前先上传到 `/api/projects/:id/attachments`，UIMessage 只保留 URL；`preprocessAttachments` 发给模型前临时读取、提取或还原。若看到历史对话里还有 data URL，多半是旧消息。
- **Run 是最小运行记录，不是完整队列**：每轮 agent 写 `.data/projects/<id>/runs/<runId>.json`，可追 step/tool/deliverable/status；真正的取消、重试恢复、成本计价和跨进程队列仍是 Phase 5。
- **react-konva 要 `dynamic(ssr:false)`**（用 canvas，SSR 报错）；canvas 内对象不是 DOM，preview_click 点不到（要真鼠标）。
- **dev 模式偶发跳 default**：新动态路由（`/projects/<新id>`）+ agent 长 SSE 流交织时整页 reload→根→redirect default。用左栏"新建项目"(SPA) 正常；对话已流式存盘不丢；**生产 build 无此问题**。
- **生图画风锚**：`RENDER_STYLE_ANCHOR`+`withRenderStyle` 代码层强制注入工业渲染风，否则 gpt-image-2 漂向 CG/插画/示意图（尤其 turnaround sheet 措辞）。**外轮廓/矩形硬规则不在画风锚里**——单一来源 `cad.buildFootprintLock(spec,layout)`（footprint 一处声明、多处复用，D39）。
- **xlsx 解析用 ExcelJS、不用 SheetJS**：npm 上的 `xlsx`(SheetJS) 有原型污染 + ReDoS（high）且官方不再在 npm 修 → 换 ExcelJS。附件解析一律设上限（文件 20MB / 30 表 / 5000 行 / 24 内嵌图 / 20 万字），防内存与模型上下文被超大文件撑爆。
- **删项目要防复活**：删除后可能仍有飞行中的生图 `saveAsset`，其 `mkdir` 会重建已删目录、`writeState` 把项目整个写回来 → `storage.ts` 用进程内 **tombstone** 拦截删除后的一切写盘（`writeState`/`saveAsset`/`saveConversation`）。这是数据正确性补丁，完整的长任务取消 / run 队列仍归 Phase 5。
- **brief 是要主动写的**：`ProjectState.brief` 不会自己填——大脑须在澄清拍板后调 `update_brief` 增量落事实（`storage.mergeBrief`），否则 `read_project_state` 永远读到空 `{}`、跨轮记忆丢失、重复追问。

## 现状
Phase 0-4 完成并实测，并经多轮重大升级：**UI 颠覆**（暗色工程制图科技，rhemax 黑红蓝）· **卡片提问 + 布局编辑器**（`present_choices` 可点卡片 + 俯视草图，零打字；react-konva `LayoutEditor` 拖拽精调 → 截图喂生图）· **Rhemos CAD v1 布局契约**（对象级布局变机读硬锁）· **首稿候选 + 用户选基准**（candidate-set 不进资产库，promote 后写 `baseAssetId`）· **工业级一致性**（identity 锁定 / footprint 外轮廓硬规则 / 画风锚 / 用户基准图参考条件化 / 平面图条件化生图）· **对话持久化 + 附件资产化** · **最小 Run 记录 + hidden usage + final render 代码守卫** · **架构收敛 D39**（判图/打分删除 · 生图锁定 gpt-image-2/fal · 几何单一来源 `geometry.ts` · render 拆分 `render/*` · 用户在环 UX · SSRF/超时/原子写加固）。Phase 5（生产化：DB / auth / 成本核算 / 部署 / 长任务队列）未做，见 `engineering-plan.md`。

## 深入阅读顺序
`docs/ARCHITECTURE.md`（如何建）→ `docs/DECISIONS.md`（为何这么定）→ `docs/engineering-plan.md`（路线图）→ `docs/domain-knowledge.md` + `src/knowledge/README.md`（领域知识层）→ `rhemos-build-plan.md`（最初策略基线）。
