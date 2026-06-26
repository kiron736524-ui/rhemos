# Rhemos

展台设计 **Loop Agent**（rhemax v2）。用户只交需求，大脑自己 **澄清 → 写方案 → 首稿候选 → 用户选基准图 → 多视角/精修深化 → 交付**。用户注意力放在关键拍板点（"方案对不对" / "哪张首稿作为基准" / "是否继续深化"），中间复杂度由大脑和工具吃掉。

> 单一大脑（默认 Sonnet 4.6，可配置升 Opus）+ 多工具；**控制流是大脑的推理，不是状态机**。首稿选择权交给用户，AI 判图/一致性检查默认关闭，按需启用。

## 现状
- ✅ **Phase 0-4** Loop Agent 全链路（澄清 → 方案 → 首稿候选 → 用户选基准 → 按需多视角/判图/修图 → 交付）· projectId 隔离 · 多模态上传 · ASR 语音
- ✅ **UI 颠覆**：暗色 · 工程制图科技（rhemax 黑红蓝 `#1A1815/#BF4136/#5D85A8`），作品在暗场发光；assistant 走 markdown 渲染
- ✅ **卡片式提问 + 对象级布局编辑器**：澄清走可点选卡片（零打字）；布局骨架问题一次只问一个，用户选完后再重排下一问；方案定稿后显示“打开编辑器 / 按原方案出图”的确认入口，用户明确进入 react-konva 布局编辑器（对象库 / 拖拽 / 缩放 / 属性面板 / 撤销重做 / 规则提示，或一键跳过）→ 截图 + 对象级坐标一起喂生图
- ✅ **首稿候选机制**：final 首稿默认 `n=2 / quality=medium / autoCheck=false` 并发生成，两张候选先显示在对话中，用户点选后才进入正式资产库并写入 `baseAssetId`
- ✅ **工业级一致性**：identity 身份锁定 + **footprint 外轮廓硬规则**（未明确异形则默认严格矩形）+ 画风锚 + 用户选定基准图后的参考条件化多视角 + **平面图条件化生图**（编辑器截图 + CAD 机读硬锁 → 先出候选）
- ✅ **Rhemos CAD v1 布局契约**：render 不再靠模型自由长文解释平面图，而是把 `BoothLayout` 编译为机器可读 CAD 文档（坐标系 / 开口边 / footprint / 对象 bbox+layer+shape+height+facing+material），作为生图硬锁
- ✅ 对话持久化 + **附件资产化**（上传先落 `.data/projects/<id>/attachments`，消息只存引用；发给模型前临时还原 / 提取）
- ✅ **Run 记录 + 代码层流程守卫**：每轮 `/api/agent` 生成 runId，记录 step/tool/deliverable；prompt-writer / inspect 等隐藏模型调用也写 usage；final render 必须已有 spec.identity 且布局已确认或明确跳过
- ✅ **历史上下文瘦身 + 成本估算**：对话 UI 与项目状态完整保存，但每轮发给模型前会压缩历史工具输出和旧文本；`estimate_cost` 走 DeepSeek V4 Flash 低成本解释余额消耗
- ✅ **质量闭环基础设施**：展台规则引擎单测（Vitest）+ 10 个真实案例回归集（`fixtures/booth-cases`，不调模型）+ `IMAGE_PROVIDER` 可配置（默认 fal）+ 生成耗时/供应商沉淀进 asset/run
- ✅ **生图输入快照（RenderInputSnapshot）**：每次 render/revise 调模型**前**固化 prompt/provider/质量/refs/spec/layout/规则问题到 `.data/.../render-inputs/`，生成 asset 关联 `renderInputId` → 任一张图都能追溯"由哪些输入产生、能否复现"（不存 base64，不喂回大脑）
- ✅ **用户素材分析层（AssetAnalysis）**：上传文件**自动**生成结构化分析（文件名/类型启发式 + Office/文本轻量提取，不调 vision/OCR）→ `selectedAttachments` 选材 → render 把素材引用写进快照与 asset 的 `sourceAttachmentIds`；任一张图都能追溯"引用了哪些用户素材、被理解成了什么"（分析失败不阻断上传）
- ⬜ **Phase 5** 生产化（DB / auth / 成本核算 / 部署）

**工作台**（`/projects/:projectId`）三栏暗色科技界面：左项目面板（列表 / 切换 / 新建 / 删除）｜ 中对话（文字 / 语音 / 上传 + **卡片选择** + markdown；交付图标"推荐"、单击放大）｜ 右资产画廊。需要拍板时大脑出**卡片 + 俯视草图**让你点选；布局骨架选择按顺序一项项锁定；布局可进对象级编辑器拖拽精调 → 截图与对象表一起喂生图。工具过程默认隐藏（调试开关可见）。

## 技术栈
Next.js 16 + React 19 + TypeScript + **AI SDK 6**。UI：Tailwind 4 暗色 token + react-markdown（assistant 渲染）+ **react-konva**（2D 布局编辑器，`toDataURL` 截图喂生图）。

**模型多来源路由**（不再"唯一经 Gateway"；句柄/封装见 `src/models/gateway.ts` + `src/models/image-providers.ts`）：
- **经 Vercel AI Gateway**：脑默认 `anthropic/claude-sonnet-4.6`（`RHEMOS_BRAIN_MODEL` 可切 Opus）· 写图 prompt 默认 `anthropic/claude-opus-4.8` · 判图默认 `anthropic/claude-sonnet-4.6` · 成本解释/语音清理 `deepseek/deepseek-v4-flash`。
- **经 fal.ai**：文生图 + 图编辑 `openai/gpt-image-2`（`fal.run/openai/gpt-image-2[/edit]`，接受 base64 data URI 免上传）。本地测试期默认 `quality=medium`；fal API 速度 ≠ ChatGPT 内部速度。当前生图/改图不再自动回退 Gemini。
- **直连**：ASR `fun-asr-realtime`（阿里云 DashScope）。

> 生产化仍需重评生图链路：把 OpenAI 官方直连 / Vercel Gateway / fal.ai / Seedream 做成可插拔 provider（`image-providers.ts` 已留接口）。见 [DECISIONS](docs/DECISIONS.md) D29。

上传先资产化为轻量引用；发给模型前服务端按需读取。docx/xlsx 用 mammoth / **ExcelJS** 提取（含大小/行数/文本上限防护）；图片/PDF 由当前 Gateway 视觉模型原生识别。

## 快速开始
```bash
# .env.local（已 gitignore；可复制 .env.example 起步）需要：
#   AI_GATEWAY_API_KEY=...   必需，路由经 Gateway 的模型（脑/判图/写prompt/语音清理）
#   FAL_API_KEY=...          必需，gpt-image-2 文生图 + 图编辑经 fal.ai
#   DASHSCOPE_API_KEY=...    接 ASR 才需要（阿里云）
#   IMAGE_PROVIDER=fal       可选，生图 provider（默认 fal；openai/seedream/gemini 为预留接口）
npm install
npm run dev          # → http://localhost:3000
npm run test         # 规则引擎单测 + 案例回归（纯本地，不需 key / 不联网）
```
实测脚本（验证 key / 平台能力，`node --env-file .env.local scripts/<x>.mjs`）：
```bash
scripts/spike.mjs              # 三模型连通
scripts/concurrency-spike.mjs  # Gateway 并发（best-of-N 真并行）
scripts/image-opts-spike.mjs   # 画质 / 流式实测
scripts/multiview-spike.mjs    # 多视图 sheet 一致性
scripts/asr-spike.mjs          # Fun-ASR 语音转写
scripts/attach-spike.mjs       # 上传 xlsx 端到端（需 dev server 在 3000）
scripts/image-attach-spike.mjs # 上传图片端到端（需 dev server）
scripts/consistency-spike.mjs  # 参考图换角度一致性（Gemini）
scripts/evolution-spike.mjs    # identity + 累积参考链增量
scripts/pipeline-spike.mjs     # 进化式多视角端到端
scripts/fal-spike.mjs          # fal.ai gpt-image-2 文生图 + 图编辑连通
```

## 文档地图
| 你想干嘛 | 读这个 |
|---|---|
| **AI 接手，要冷启动** | **[docs/AI-HANDOFF.md](docs/AI-HANDOFF.md)** ← 从这开始 |
| 为什么这么设计（每个关键决策点）| [docs/DECISIONS.md](docs/DECISIONS.md) |
| 架构全貌（as-built）| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) |
| 路线图 / 还没做的 | [docs/engineering-plan.md](docs/engineering-plan.md) |
| 领域知识层（大脑的灵魂）| [src/knowledge/README.md](src/knowledge/README.md) + [docs/domain-knowledge.md](docs/domain-knowledge.md) |
| 最初策略基线 | [rhemos-build-plan.md](rhemos-build-plan.md) |
| Claude Code 接手须知 | [CLAUDE.md](CLAUDE.md) |

## 红线
模型多来源（脑/判图/写prompt/语音清理经 Gateway · gpt-image-2 经 fal.ai · ASR 经 DashScope 直连）· 首稿候选必须由用户选基准后才进入资产库 · final render 不绕过 spec/layout 决策 · 外轮廓未说明异形则严格矩形 · 品牌无素材只占位 · `.env.local` / `.data/` 不入库 · 中文对话/注释/commit。
