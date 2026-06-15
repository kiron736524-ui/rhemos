# Rhemos · AI 冷启动导航

读完这一篇 + 它指向的链接，你就能全知识冷启动、抓住每个关键决策点。

## 心智模型（30 秒）
单一大脑（Opus 4.8）+ 多工具的 **Loop Agent**。**控制流 = 大脑的推理，不是状态机。** 用户只看两端（说需求 / 拿结果）；中间：澄清 → 写 DesignSpec → 并行生图(best-of-N) → 客观判图择优 → 必要时定向修 → 交付，全由大脑自主，自检对用户隐形。旧 rhemax 的 FSM + 模板被**刻意丢弃**（见 [DECISIONS](DECISIONS.md) D7）。

## 60 秒定位：想改 X → 去看 Y
| 想做什么 | 去哪 |
|---|---|
| 换模型 / 模型句柄 | `src/models/gateway.ts`（脑 / 文生图 / **参考条件化 Gemini** / 判图 / 清理 + `generateImageFromRefs` 参考生图 + `withRenderStyle` 画风锚）|
| 改大脑行为 / 工作循环 / 铁律 | `src/agent/system-prompt.ts`（PREAMBLE）|
| 改领域知识（提问/判图/生图法/展台规则）| `src/knowledge/skills/*` + `src/knowledge/rubrics/*`（见 `src/knowledge/README.md`）|
| 加 / 改工具 | `src/tools/*.ts` → 注册在 `src/agent/orchestrator.ts` |
| 循环退出 / 生图预算 | `src/agent/orchestrator.ts`（`stopWhen` / `imageBudget`）|
| 判图逻辑（结构化打分）| `src/agent/inspect.ts` |
| 存储 / 数据形状 / 项目列表 / 业务记忆 | `src/lib/storage.ts`（projectId-keyed + 写锁 + `listProjects`/`deleteProject` + `mergeBrief` 写 brief + 删除 tombstone 防复活）+ `src/lib/types.ts` |
| API 入口 | `src/app/api/agent/route.ts`（tool 入参兜底 + 附件预处理）；图片读出 `assets/[id]`；项目列表/删除 `projects/` + `projects/[id]`；项目状态 `projects/[id]/state`；语音 `asr` |
| 上传附件提取（docx→文字+内嵌图 / xlsx→CSV，含大小/行数/文本上限）| `src/lib/attachments.ts`（mammoth / ExcelJS）|
| brief 业务记忆写入 | `src/tools/update-brief.ts` + `storage.mergeBrief`（澄清拍板后增量落事实）|
| 语音输入 ASR | `src/lib/asr/{funasr,cleanup}.ts` + `src/components/VoiceInputButton.tsx` |
| 前端工作台（三栏暗色科技）| `src/app/projects/[projectId]/page.tsx`（面板 / 对话 / 画廊 / 上传 / **卡片** / **markdown** / lightbox）；`src/app/page.tsx` 仅 redirect→default |
| 卡片提问 / 选项卡 + 俯视草图 | `src/tools/present-choices.ts` + 前端 `ChoiceCards`/`FloorPlan`（page.tsx）|
| 布局编辑器（拖拽/缩放/L形/截图喂生图）| `src/components/LayoutEditor.tsx`(react-konva) + `/layout-demo` 演示页 |
| 多视角一致性 / 平面图条件化生图 | `src/tools/{generate-views,render-from-plan}.ts`（identity + 进化式参考链 + 门控）|
| 对话持久化 | `src/lib/storage.ts`(conversation) + `api/projects/[id]/messages` + page.tsx 流式存盘 effect |
| **为什么这么设计** | `docs/DECISIONS.md` |
| 架构全貌（as-built） | `docs/ARCHITECTURE.md` |
| 路线图 / 还没做的 | `docs/engineering-plan.md` |
| 连通性 / 并发 / 画质实测脚本 | `scripts/*.mjs`（`node --env-file .env.local scripts/<x>.mjs`）|

## 不变量（不要破坏）
1. **模型唯一经 Gateway**（`src/models/gateway.ts`）；ASR(DashScope) 是唯一例外。
2. **自检对用户隐形**：客观缺陷大脑内部处理、主观口味走对话，**绝不给用户报告 / 半成品**。
3. **品牌无素材只占位**、不臆造文字 / Logo。
4. 知识层是大脑的**参考与判断工具**，不是死板脚本；**不要重建 FSM / blockingField** 那套调度机器。
5. `.env.local` / `.data/` 绝不入库。

## 实测 gotchas（踩过的坑，省你时间）
- **gpt-image-2 慢**：low~8s / medium~30s / high~200s。概念/迭代用 medium，high 仅单张终图。默认画幅 1024。
- **Gateway 图像端点不支持 `partial_images` 流式**（`stream` 被忽略），**不采纳 `output_format=jpeg`**（强制 PNG）。故生图走 **OpenAI SDK 经 Gateway 兼容端点**（`https://ai-gateway.vercel.sh/v1`），**不是** AI SDK 的 `generateImage`。
- **best-of-N 是并行**（实测 4 张墙钟≈单张）→ 横向抽奖是主力质量杠杆；纵向 `revise` 是窄回退。并发上限 2。
- **high 不能对 best-of-N + revise**（3×200s 会超时）；全闭环带 revise ≈ 3.7min。
- 流式进度靠 Agent 循环本身（文字流 + 工具状态），**不是 partial 预览帧**。
- 并行生图后**顺序** `saveAsset`（否则竞写 `state.json`）。
- **文件上传两坑**（`projects/[projectId]/page.tsx`）：① file input 别 `display:none`（Safari 下 `.click()` 不弹文件框）→ 用 `<label htmlFor>` 关联 + `sr-only`；② `onChange` 里 `setFiles` 的 updater 是**延迟闭包**，别在其中读 `e.target.files`（会被同步行 `value=''` 清空）→ 先 `const picked = Array.from(e.target.files ?? [])` 再清空。
- **多轮 400**：UIMessage 回传后历史里 `tool_use.input` 可能是空串 `""` → Gateway 400。route 的 `sanitizeToolInputs` 把非对象入参兜成 `{}`。
- **改 `/api/**/route.ts` 后 dev server 热重载可能不生效**：重启或 curl 闭环验证，别只读代码就认定生效（前端 bundle 与 API route 分别编译）。
- **headless 预览测不了文件上传交互**：合成 click 不弹文件框、合成 change 触发的 onChange 也别"看到事件就算验证"；真实选文件流程交给用户或 Claude-in-Chrome `file_upload` 确认。
- **图像编辑 / 参考图：走 `generateText` + input image part 经 `gemini-3-pro-image`，不是 `images.edit`**（后者经 Gateway 仍 404）——纠正 D17。封装在 `gateway.ts` 的 `generateImageFromRefs`。
- **多视角一致性**：单参考换角度方差大（实测 62~88，故 best-of-N 择优是刚需）；累积参考链能提升一致性，但**把漂移图当参考会传染漂移** → 必须判图门控（仅通过的进参考池，`CONSISTENCY_GATE=70`）。`generate_views` 是落地。
- **平面图条件化最强**：用户在 `LayoutEditor` 拖好布局 → `stage.toDataURL()` 截图 → `render_from_plan` 以平面图为硬参考出 3D，比纯文字 prompt 精确一个量级。
- **react-konva 要 `dynamic(ssr:false)`**（用 canvas，SSR 报错）；canvas 内对象不是 DOM，preview_click 点不到（要真鼠标）。
- **dev 模式偶发跳 default**：新动态路由（`/projects/<新id>`）+ agent 长 SSE 流交织时整页 reload→根→redirect default。用左栏"新建项目"(SPA) 正常；对话已流式存盘不丢；**生产 build 无此问题**。
- **生图画风锚**：`RENDER_STYLE_ANCHOR`+`withRenderStyle` 代码层强制注入工业渲染风，否则 gpt-image-2 漂向 CG/插画/示意图（尤其 turnaround sheet 措辞）。
- **xlsx 解析用 ExcelJS、不用 SheetJS**：npm 上的 `xlsx`(SheetJS) 有原型污染 + ReDoS（high）且官方不再在 npm 修 → 换 ExcelJS。附件解析一律设上限（文件 20MB / 30 表 / 5000 行 / 24 内嵌图 / 20 万字），防内存与模型上下文被超大文件撑爆。
- **删项目要防复活**：删除后可能仍有飞行中的生图 `saveAsset`，其 `mkdir` 会重建已删目录、`writeState` 把项目整个写回来 → `storage.ts` 用进程内 **tombstone** 拦截删除后的一切写盘（`writeState`/`saveAsset`/`saveConversation`）。这是数据正确性补丁，完整的长任务取消 / run 队列仍归 Phase 5。
- **brief 是要主动写的**：`ProjectState.brief` 不会自己填——大脑须在澄清拍板后调 `update_brief` 增量落事实（`storage.mergeBrief`），否则 `read_project_state` 永远读到空 `{}`、跨轮记忆丢失、重复追问。

## 现状
Phase 0-4 完成并实测，并经三轮重大升级：**UI 颠覆**（暗色工程制图科技，rhemax 黑红蓝）· **卡片提问 + 布局编辑器**（`present_choices` 可点卡片 + 俯视草图，零打字；react-konva `LayoutEditor` 拖拽精调 → 截图喂生图）· **工业级一致性**（identity 锁定 / 画风锚 / 进化式参考链 + 判图门控 / 平面图条件化生图，参考条件化用 Gemini 3 Pro Image）· **对话持久化**（流式存盘）。Phase 5（生产化：DB / auth / 成本核算 / 部署 / 长任务队列）未做，见 `engineering-plan.md`。

## 深入阅读顺序
`docs/ARCHITECTURE.md`（如何建）→ `docs/DECISIONS.md`（为何这么定）→ `docs/engineering-plan.md`（路线图）→ `docs/domain-knowledge.md` + `src/knowledge/README.md`（领域知识层）→ `rhemos-build-plan.md`（最初策略基线）。
