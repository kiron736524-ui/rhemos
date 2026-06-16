# Rhemos

展台设计 **Loop Agent**（rhemax v2）。用户只交需求，大脑自己 **澄清 → 写方案 → 并行生图 → 客观判图择优 → 必要时定向修 → 交付**。用户注意力只在两端（"我想要什么" / "这是不是我想要的"），中间复杂度由大脑吃掉。

> 单一大脑（Opus 4.8）+ 多工具；**控制流是大脑的推理，不是状态机**。自检对用户隐形。

## 现状
- ✅ **Phase 0-4** Loop Agent 全链路（澄清 → 方案 → 生图 → 判图择优 → 修 → 交付）· projectId 隔离 · 多模态上传 · ASR 语音
- ✅ **UI 颠覆**：暗色 · 工程制图科技（rhemax 黑红蓝 `#1A1815/#BF4136/#5D85A8`），作品在暗场发光；assistant 走 markdown 渲染
- ✅ **卡片式提问 + 布局编辑器**：澄清走可点选卡片（零打字）；方案定稿后**自动弹 react-konva 布局编辑器**（拖拽 / 缩放 / L 形精调，或一键跳过）→ 截图喂生图
- ✅ **工业级一致性**：identity 身份锁定 + 画风锚 + **进化式参考链**（judge 门控）+ **平面图条件化生图**（编辑器截图 → 喂模型出贴合布局的 3D）
- ✅ 对话持久化 + **附件资产化**（上传先落 `.data/projects/<id>/attachments`，消息只存引用；发给模型前临时还原 / 提取）
- ✅ **Run 记录 + 代码层流程守卫**：每轮 `/api/agent` 生成 runId，记录 step/tool/deliverable；final render 必须已有 spec.identity 且布局已确认或明确跳过
- ⬜ **Phase 5** 生产化（DB / auth / 成本核算 / 部署）

**工作台**（`/projects/:projectId`）三栏暗色科技界面：左项目面板（列表 / 切换 / 新建 / 删除）｜ 中对话（文字 / 语音 / 上传 + **卡片选择** + markdown；交付图标"推荐"、单击放大）｜ 右资产画廊。需要拍板时大脑出**卡片 + 俯视草图**让你点选；布局可进编辑器拖拽精调 → 截图喂生图。工具过程默认隐藏（调试开关可见）。

## 技术栈
Next.js 16 + React 19 + TypeScript + **AI SDK 6** + **Vercel AI Gateway**（模型唯一来源）。UI：Tailwind 4 暗色 token + react-markdown（assistant 渲染）+ **react-konva**（2D 布局编辑器，`toDataURL` 截图喂生图）。
脑 `anthropic/claude-opus-4.8` · 文生图 `openai/gpt-image-2` · **参考条件化 / 编辑 `google/gemini-3-pro-image`**（换角度 / 平面图条件化；可选 gpt-image-2 直连）· **判图 + 写 prompt `anthropic/claude-opus-4.8`**（升 Opus，质量优先）· 语音清理 `deepseek/deepseek-v4-flash`（均经 Gateway）· ASR `fun-asr-realtime`（DashScope）+ gpt-image-2 图编辑（OpenAI 直连）为 Gateway 例外。
上传先资产化为轻量引用；发给模型前服务端按需读取。docx/xlsx 用 mammoth / **ExcelJS** 提取（含大小/行数/文本上限防护）；图片/PDF Opus 4.8 原生识别。

## 快速开始
```bash
# .env.local（已 gitignore）需要：
#   AI_GATEWAY_API_KEY=...   必需，路由所有模型
#   DASHSCOPE_API_KEY=...    接 ASR 才需要
npm install
npm run dev          # → http://localhost:3000
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
模型唯一经 Gateway（ASR + gpt-image-2 图编辑直连例外）· 自检对用户隐形 · final render 不绕过 spec/layout 决策 · 品牌无素材只占位 · `.env.local` / `.data/` 不入库 · 中文对话/注释/commit。
