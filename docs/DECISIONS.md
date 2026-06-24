# Rhemos · 决策日志

> 每条 = 决策 · 为什么 · 落点。要抓任何关键决策点，看这里。状态：截至 Phase 4（2026-06-15）。

## 定位与范式
- **D1 · greenfield rhemos = rhemax v2**：不迁移旧代码，只参考旧领域知识。为何：技术栈差太大、要按 Loop Agent 重构、不被旧框架绑架。落点：整个 `~/rhemos`，关联 GitHub `kiron736524-ui/rhemos`。
- **D2 · 范式 = 单脑 Loop Agent + 多工具**：控制流交给大脑推理，不用 FSM。为何：用户要"智能沟通"而非死板模板流程。落点：`orchestrator.ts` + `system-prompt.ts`。

## 模型与平台
- **D3 · Vercel AI Gateway 为唯一模型源**（ASR 例外）：一个 key 路由全部。为何：统一/监控/fallback、契合"大脑动态选工具"。落点：`models/gateway.ts`。**〔已被 D29 替代："唯一"不再成立——现多来源：gpt-image-2 经 fal.ai、ASR 经 DashScope，其余仍经 Gateway〕**
- **D4 · 脑=Opus 4.8 · 生图=gpt-image-2 · 判图=Sonnet 4.6**：脑+生图由用户指定；判图选 Sonnet（成本/质量平衡，实测能做结构/物理推理）。**inspector 基准测试待做**（候选 Opus/Gemini 3.x Pro/GPT-5，见 `INSPECT_CANDIDATES`）。
- **D5 · 视频砍掉；ASR 用 DashScope Fun-ASR**（唯一非 Gateway 例外，China region）。**Phase 4 已接线**：`fun-asr-realtime` 转写 + `deepseek-v4-flash`（经 Gateway）清理去语气词；落点 `src/lib/asr/*` + `api/asr` + `VoiceInputButton`。
- **D6 · 生图走 OpenAI SDK 经 Gateway 兼容端点**（非 AI SDK `generateImage`）：因 `generateImage` 一次性、且要精确控 quality/size/n。落点：`gateway.ts` 的 `openaiViaGateway`、`tools/generate-best-of-n.ts`。**〔已被 D29 替代：gpt-image-2 经 Gateway 图编辑不通（D27）、文生图也迁出——现统一经 fal.ai（`falTextToImage`/`falEditFromRefs`）；`openaiViaGateway`、`generate-best-of-n` 均已删〕**

## 架构与体验
- **D7 · 丢弃旧 FSM / stage-contract / blockingField / harness**，领域知识重写为 `skills` + `rubrics`（大脑的参考与判断工具，非脚本）。为何：旧那套框死了大脑能动性。落点：`src/knowledge/`。
- **D8 · 自检对用户隐形**（预防为主 + 静默 best-of-N 择优 + 仅客观硬伤隐形修）：旧 rhemax 把"半成品 + 改进报告"甩给用户、逼二次操作 → 失败被废。新架构客观缺陷内部处理、主观口味走对话、**绝不出报告**。落点：`rubrics/inspection.md`、`inspect.ts`、`generate-best-of-n.ts`。
- **D9 · 横向 best-of-N 优先于纵向 revise**：实测 Gateway 真并发（4 张墙钟≈单张 82s，串行需 279s，无 429）→ 并行抽奖几乎不增延迟，是主力质量杠杆。落点：`generate-best-of-n.ts`、`scripts/concurrency-spike.mjs`。
- **D10 · 退出与预算**：`task_complete` 正常退出 + `imageBudget(5)` / `stepCountIs(16)` 兜底。为何：Phase 1 曾无预算 + curl `--retry` 误用导致跑飞（10min / 6 图），故加。落点：`orchestrator.ts`。

## 速度 / 画质（实测约束）
- **D11 · 默认画幅 1024 + quality 分档**：实测 low~8s / medium~30s / high~200s。**概念/迭代用 medium、最终交付/精密结构才用 high**；**high 不可对 best-of-N + revise**（3×200s 会超时，全闭环带 revise≈3.7min）。落点：`system-prompt.ts`、`generate-best-of-n.ts`、route `maxDuration=600`。
- **D12 · Gateway 图像端点不支持 `partial_images` 流式、不采纳 `jpeg`（强制 PNG）**：实测 `stream:true` 返回整块 JSON、`output_format=jpeg` 仍出 PNG。故**无 partial 预览帧**；流式进度靠 Agent 循环本身。落点：`scripts/image-opts-spike.mjs`。

## 工程 / 收尾
- **D13 · 持久化暂存本地 FS**（`.data/`）；部署 / Auth 暂缓；AI Elements UI 暂用极简自建。均为测试期取舍，后续可换。**〔生产化时一并重评：生图 provider 可插拔——OpenAI 官方直连 / Vercel Gateway / fal.ai / Seedream（见 D29）、DB/对象存储（D19）；UI 已落地为自建三栏暗色工作台，未采用 AI Elements〕**
- **D14 · 不用 tldraw / 不做几何白模**：v2 是 chat-first；白模是当年兜底模型能力的产物，gpt-image-2 指令遵循强、不需要。

## 安全
- **D15 · `.env.local` / `.data/` 绝不入库**（`.gitignore`）。`.env.local` 含 `AI_GATEWAY_API_KEY`、`DASHSCOPE_API_KEY`。
- **D16 · 历史泄露提醒**：旧 `~/meta rhema/过程提示词和图标/rhemax-260415-*.json` 是 GCP 服务账号私钥（旧 Vertex 项目），**未带入 rhemos**，建议去 GCP 轮换/删除。

## 多视图（Phase 3 方向）
- **D17 · 多视图 = 单图 turnaround sheet（一张图四视角），非四张独立图**。实测（`scripts/multiview-spike.mjs`）：`images.edit` 图像条件化经 Gateway **404 不可用**；单图 sheet **一次渲染 = 天然同一展台**（Sonnet 判 72，前/左/右/俯视平面自洽），而分图独立生成会漂（正是 rhemax 全套锁定机制的根因）。故走 sheet。改进：prompt **强制角度分明** + best-of-N 选最一致 + 提高画幅(1536)/quality。**per-角度独立高清重绘**（用户满意后单独做）属 drift 回归的难活，**暂缓**。落点：Phase 3 `render_multiview_sheet` 工具 + 重写 `multiview.md`（删锁定机制）。

## 产品化路线（据架构批评优化 Phase 4/5）
- **D18 · Phase 4 重切为"产品骨架"**：走向产品第一优先级是隔离/沉淀/边界，不是加模型能力。Phase 4 = 四概念(project/session/run/asset)+projectId 入 URL/存储、inspection 沉淀回 asset(修真 bug)、用户态/调试态 UI 分层(解 D8"自检隐形"与当前 UI 摊工具日志的矛盾)、用户选图=强信号、薄代码级不变量。均不依赖部署。
- **D19 · 生产化归 Phase 5**（部署时做）：DB/对象存储/签名URL/CDN、auth/多租户/限流、成本核算/取消重试降级/telemetry、长任务队列/Workflow checkpoint(解 maxDuration)。因 deploy/auth 已缓(D13)，现在做是空中楼阁。
- **D20 · 稳定性不靠 FSM，靠薄代码级不变量**：回应"缺状态机=风险"——不重引 FSM(违 D7)，而把少数必须项(生图前有 spec/预算/用户选图锁定)写成**工具前置条件**(代码硬保证)，其余排序判断仍归大脑。硬连必须项+破坏性闸门，不回退 if-else 大杂烩。（**尚未落地**，与"用户选图=强信号"一起留作 Phase 4 余项。）

## 多模态上传（Phase 4 补充）
- **D21 · 上传走服务端提取，不靠模型直读 Office**：图片/PDF 由 Opus 4.8 原生识别（原样传）；docx 用 mammoth 提正文+内嵌图、xlsx 用 SheetJS 转 CSV，再以 text/file part 注入消息。落点 `src/lib/attachments.ts`，route 在 `convertToModelMessages` 前预处理。**实测坑**：file input 别 `display:none`（Safari 点击不弹框→用 `<label htmlFor>`+`sr-only`）；onChange 别在 `setFiles` 闭包里读 `e.target.files`（会被同步行 `value=''` 清空→先同步读出再清空）。

## 生图一致性（2026-06-15 重构）
- **D22 · 多视角一致性 = identity 锁定 + 参考条件化 + 进化式参考链 + 判图门控**（部分推翻 D17 "走 sheet" 的结论）。**纠正 D17**：`images.edit` 经 Gateway 确实 404，但图像编辑/参考图**可走 `generateText` + input image part 经 Gemini 3 Pro Image**——D17 当年只测了 `images.edit` 一条就判"不可用"，片面。实测依据：① 单参考换角度方差大（62~88，故 best-of-N 择优是刚需）② 累积优质参考提升一致性（俯视用[主图+已过关左视]双参考 → 92 > 单参考 72）③ 把漂移图当参考会传染漂移（故**门控**：仅判图通过的视角才进参考池，`CONSISTENCY_GATE=70`）。落点：`models/gateway.ts` 的 `generateImageFromRefs` + `MODEL_IDS.imageEdit=google/gemini-3-pro-image`、`tools/generate-views.ts`（`generate_views` 多视角交付主力）、`agent/inspect.ts` 的 `inspectConsistency`、`revise_asset` 改为参考图局部编辑、`DesignSpec.identity`（基础信息 schema）。**sheet 降级为"快速对齐探索"，不做最终交付**（单格低清易漂）；多视角交付走 `generate_views` 的单视角全幅。spike：`scripts/{consistency,evolution,pipeline}-spike.mjs`。
- **D23 · 画风锚代码层强制注入**：`RENDER_STYLE_ANCHOR` + `withRenderStyle` 对所有生图前置"V-Ray/Corona 级工业渲染 + 否定卡通/插画/示意图"。因 gpt-image-2 缺强画风约束会漂向 CG/示意图（尤其 turnaround sheet 措辞带向 model-sheet 线稿）。

## 架构收敛（2026-06-15 第二轮 review 后）
- **D24 · 能力成型期收敛到"统一契约 + 硬边界"，而非继续加能力**（回应二次 review："能力太多却缺统一结果协议与预算边界"）。三条契约：① **结果协议**——所有 render 工具收口到同一 deliverable 形状（`{type, assets[{id,url,role,view,status,score}], recommendedId, issues}`），前端/对话气泡/画廊/task_complete 都吃这一种，以后加新生图工具前端零改动；② **状态归属**——`identity`/`selfCheckCriteria` 等 canonical state 归 project state，render 工具自读、模型只传 delta（不再让模型搬运易抄错的状态）；③ **边界协议**——输入只收结构化、生图工具 schema 内硬上限 + execute 预检、附件落 asset。**本轮已落地**：删 `present_choices.sketch` + 前端 `dangerouslySetInnerHTML`（**安全**：layout 已替代，sketch 是可被上传内容注入的 HTML 逃生口，删了零损失）；`generate_views`/`render_from_plan` 的 `views` 加 `.max(4)` + execute 预算预检（补 `imageBudget` 事后统计挡不住的"单工具内部跑飞"）；**xlsx 换 ExcelJS**（纠正 D21：npm `xlsx`(SheetJS) 有原型污染 + ReDoS high 且官方不在 npm 修）+ 上传门限（20MB/30 表/5000 行/24 图/20 万字）。**待落地**：①② 的统一协议 + 状态自读 + 前端 ViewSet 分组展示（先定 schema 再一次性改各工具，避免零敲碎打）。落点：`tools/present-choices.ts`、`tools/{generate-views,render-from-plan}.ts`、`lib/attachments.ts`、`app/projects/[projectId]/page.tsx`。
- **D25 · 附件资产化 / 长任务 Run 模型明确推迟 Phase 5**：① 对话持久化目前整条 `messages`（含 base64 附件、工具输出）存进 `conversation.json`、每轮 `/api/agent` 又全量预处理——正解是上传落 asset、消息只存引用，但**数据未真变重前不紧急**，归 Phase 5 数据层一起做；② tombstone（D 本轮）只堵住"删除后复活"的数据正确性，**生图取消 / 成本核算 / 重试 / 状态恢复**仍需 Run 模型或任务队列（D19 已列）。为何推迟而非现在做：协议（D24）未收敛时再加一层会重蹈"做多了乱"；先把三契约立稳，再上 Run。

## 大脑收敛（2026-06-15 第三轮：orchestrator 减法）
- **D26 · 三刀收敛——大脑当 CEO 不当店长**（回应"系统是加法长出来的、该一次减法收敛；大脑上下文污染"）。① **生图 4→1**：`generate_best_of_n`/`generate_views`/`render_from_plan`/`render_multiview_sheet` 合并为唯一入口 `render`（内部按 intent/views/planAssetId 自动选 文生图 best-of-N / 进化链多视角 / 平面图条件化三套 pipeline，**完整保留**门控/画风锚/参考条件化）；删半废 sheet + 鸡肋 `inspect_result`（生图已内置判图）。工具 12→8。② **大脑变薄·知识分流**：执行型知识（`prompt-craft`/`prompt-examples`/`materials-lighting`/`styles`/`reference-and-editing`/`multiview`）从 system 下沉到 `prompt-writer` 子 agent；大脑 system 只留决策型（persona / 空间·结构常识 / design-method / 品牌红线 / industry-heuristics / questioning / inspection）。③ **prompt 撰写下放**：大脑只给**中文意图**，`prompt-writer`（工具内 Sonnet + 执行知识）翻成英文五层 prompt；`render`/`revise_asset` 自读 `spec.identity/selfCheckCriteria`。判据：**做判断的留大脑、做产出的下放工具**（按用途切，不按 skill 文件切）。配套：`read_project_state` 返回资产摘要（不再塞长 prompt + 全部判图史）。落点：`tools/render.ts`、`agent/prompt-writer.ts`、`agent/system-prompt.ts`、`tools/{revise-asset,read-project-state}.ts`、`agent/orchestrator.ts`。

## 模型档 / 接线 / 交互（2026-06-15 第四轮：用户指定调整）
- **D27 · 判图+写prompt 升 Opus · gpt-image-2 经 Gateway 接不通图输入 · 编辑器后挪**。三件：
  1. **判图 + prompt-writer 升 Opus 4.8**（用户指定，质量优先；纠正 D26 的 Sonnet 档）：`MODEL_IDS.inspect` 改 Opus，判图与工具内写 prompt 共用。成本更高（一次多视角出图 ≈ 9 次 Opus 调用），用户认可。
  2. **gpt-image-2 经 Gateway 用不了图像输入**（实测，否掉"换 gpt-image-2"的设想）：4 路全不通——`generateText`/`responses` 被拒 "is an image model, not a language model"；`images.edit`（SDK + 原始 fetch）均 **404**。根因：Gateway 把 gpt-image-2 锁成"只能文生图"的 image model、没代理它的图编辑端点；Gemini 能做参考条件化是因它在 Gateway 里是**多模态 language model**（走 chat 端点）。**要用 gpt-image-2 做参考条件化只能直连 OpenAI**（第二个非 Gateway 例外，类比 ASR）——`generateImageFromRefs` 已写好：有 `OPENAI_API_KEY` 走 gpt-image-2 直连 `images.edit`（多图参考 + quality high）、否则回退 Gemini。待用户加 key 实测。spike：`scripts/gpt-image-edit-spike.mjs`。**〔bullet 2 已被 D29 替代：最终未走 OpenAI 直连——改用 fal.ai（fal 暴露 gpt-image-2 的 `/edit` 端点且接受 data URI，文生图+图编辑都经 fal）；`OPENAI_API_KEY` 直连路径已移除〕**
  3. **布局编辑器后挪**：从"澄清卡片的精调按钮"挪到"方案定稿后"——大脑写完 spec 调 `present_layout`（带布局）→ 前端 `LayoutGate` **自动弹**布局编辑器（用方案布局初始化）→ 用户精调确认（截图 → `render` planAssetId）/ 或"按原方案直接出"跳过。线性流：选方向 → 方案 → 自动弹编辑器 → 出图。落点：`tools/present-layout.ts`、`agent/{orchestrator,system-prompt}.ts`、`page.tsx`（LayoutGate + 去卡片精调按钮 + 编辑器跳过按钮）。

## 运行时边界（2026-06-16 第五轮：Run / 状态硬守卫 / 附件资产化）
- **D28 · 把 Phase 4 的软边界补成代码边界，前端样式不动**。本轮只做运行时与数据契约，不改 UI 视觉：① **最小 Run 模型落地**：`/api/agent` 每轮创建 `run-...`，写 `.data/projects/<id>/runs/<runId>.json`，记录 step/tool 摘要、Deliverable、状态、usage；项目 state 保留最近 30 条 run 摘要。完整队列/取消/成本计价仍属 Phase 5，但现在至少有可恢复的运行痕迹。② **final render 硬守卫**：`render(mode=final)` 代码层要求 `spec.identity` 存在，且 layout 已 `confirmed` 或 `skipped`；`present_layout` 会写 `layout.status=pending`，编辑器确认写 `confirmed + planAssetId`，跳过写 `skipped`。若只是早期方向探索，必须显式 `mode=concept`。③ **附件资产化**：前端发送前先 POST `/api/projects/:id/attachments`，消息只存轻量 FileUIPart URL；`preprocessAttachments` 在发给模型前按需读取附件，docx/xlsx 提取、图片/PDF 临时还原为 data URL。④ **布局规范化**：`BoothLayout` schema 收口到 `lib/layout.ts`，`present_choices`/`present_layout` 输出统一裁剪坐标、限制 zone 数量和尺寸，防止模型布局越界直接打坏编辑器。落点：`lib/{types,storage,layout,attachments}.ts`、`app/api/{agent,projects/...}`、`tools/{render,present-layout,present-choices,read-project-state,revise-asset}.ts`、`page.tsx`。

## 多来源路由 / 工程收敛（2026-06-24 第六轮）
- **D29 · 模型多来源 as-built——gpt-image-2 经 fal.ai，不再"唯一经 Gateway"**（替代 D3"唯一"、D6 端点、D27 bullet 2 的 OpenAI 直连设想）。三来源：① **经 Gateway**：脑 / 判图 / 写图 prompt（均 Opus 4.8）/ 语音清理（DeepSeek）/ 参考条件化 fallback（Gemini 3 Pro Image）；② **经 fal.ai**：`openai/gpt-image-2` 文生图（`fal.run/openai/gpt-image-2`）+ 图编辑（`…/edit`，base64 data URI 多图参考、免上传 storage）；③ **直连**：ASR（DashScope）。为何 fal 而非 OpenAI 直连：fal 暴露 gpt-image-2 的 `/edit` 端点且接受 data URI，文生图 + 参考条件化一套搞定；而 gpt-image-2 经 Gateway 只代理文生图、不代理图编辑（D27）。**速度提醒**：fal gpt-image-2 默认 quality high 偏慢（~200s 级），**fal API 速度 ≠ ChatGPT 内部速度**，别按体感预期。**provider 抽象**：`src/models/image-providers.ts` 收口 `textToImage`/`editFromRefs`，render/revise 经它调用——生产化在一处切 OpenAI 直连 / Gateway / fal / Seedream，不动业务逻辑。鉴权 `FAL_API_KEY`（`.env.local`，gitignore）。落点：`models/{gateway,image-providers}.ts`、`tools/{render,revise-asset}.ts`、`agent/{orchestrator,system-prompt}.ts`。
- **D30 · 架构收敛型修改（文档对齐 + 知识前移 + 强类型起步）**。本轮不堆能力，让系统更可维护：① **文档对齐真实链路**：README / ARCHITECTURE / DECISIONS / engineering-plan / AI-HANDOFF / CLAUDE.md 去掉"gpt-image-2 经 Gateway / 唯一经 Gateway"等过时表述（D3/D6/D27 标注被替代）。② **multiview.md 重写**：最终多视角 = 进化式参考链 + 判图门控、每视角单视角全幅，不再是四宫格 sheet（防污染 prompt-writer 生成 turnaround sheet）。③ **最小展台规则引擎** `lib/booth-rules.ts`（纯函数 15 条：长宽/越界/面积超额/关键区重叠/只有家具/主视觉缺失/开口关系/背墙倾向/接待堵口/储物位/开放边被占/四面开中心阻断/洽谈面积/大件上高柜；顶部 Truss 留 TODO 不伪造），present-layout / present-choices / render 三处接入（blocker 打回，fail/warning 写 deliverable issues）——把 markdown 展台规则前移成可执行、可单测的纯计算校验，VLM 判图之外再加一道关。④ **brief 强类型起步** `BoothBrief`（最小骨架，`brief: BoothBrief & Record<string,unknown>` 兼容旧自由键，update_brief 仍写自由 patch）。⑤ **判图 schema 维度化**：inspect 增 `dimensions{structure,circulation,brand,materialLighting}`（可选，保留 score/fails/summary 与 `toInspectionResult` 兼容，沉淀回资产）。⑥ **快慢双模式**：render 的 quality/n 不设 Zod 默认、按 mode 解析（concept→medium/n1 快草案、final→high/n2 慢终稿），避免 Zod 默认与系统提示打架；final 硬守卫不变。⑦ **render 轻拆分**：抽 provider 层（见 D29），外部工具 schema 不变。落点：`lib/{types,booth-rules}.ts`、`models/image-providers.ts`、`agent/{inspect,system-prompt,orchestrator}.ts`、`tools/{render,revise-asset,present-layout,present-choices}.ts`、`knowledge/skills/multiview.md` + 各文档。

## 进度
Phase 0（接线 + 连通 spike）· Phase 1（最小 Loop Agent）· Phase 2（best-of-N 自省闭环）· Phase 3（多视图 turnaround sheet）· Phase 4（projectId 隔离 / 三栏工作台 / 多模态上传 / ASR / inspection 沉淀 / per-project 写锁）已完成并实测。**Phase 4 余项**（用户选图=强信号、薄代码级不变量）+ **Phase 5**（DB / auth / 成本核算 / 部署 / 长任务队列）未做 —— 见 `engineering-plan.md`。
