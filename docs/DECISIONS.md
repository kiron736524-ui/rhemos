# Rhemos · 决策日志

> 每条 = 决策 · 为什么 · 落点。要抓任何关键决策点，看这里。状态：截至 Phase 2（2026-06-14）。

## 定位与范式
- **D1 · greenfield rhemos = rhemax v2**：不迁移旧代码，只参考旧领域知识。为何：技术栈差太大、要按 Loop Agent 重构、不被旧框架绑架。落点：整个 `~/rhemos`，关联 GitHub `kiron736524-ui/rhemos`。
- **D2 · 范式 = 单脑 Loop Agent + 多工具**：控制流交给大脑推理，不用 FSM。为何：用户要"智能沟通"而非死板模板流程。落点：`orchestrator.ts` + `system-prompt.ts`。

## 模型与平台
- **D3 · Vercel AI Gateway 为唯一模型源**（ASR 例外）：一个 key 路由全部。为何：统一/监控/fallback、契合"大脑动态选工具"。落点：`models/gateway.ts`。
- **D4 · 脑=Opus 4.8 · 生图=gpt-image-2 · 判图=Sonnet 4.6**：脑+生图由用户指定；判图选 Sonnet（成本/质量平衡，实测能做结构/物理推理）。**inspector 基准测试待做**（候选 Opus/Gemini 3.x Pro/GPT-5，见 `INSPECT_CANDIDATES`）。
- **D5 · 视频砍掉；ASR 沿用阿里云百炼/DashScope**（唯一非 Gateway 例外，key 在 `.env.local`，**尚未接线**）。
- **D6 · 生图走 OpenAI SDK 经 Gateway 兼容端点**（非 AI SDK `generateImage`）：因 `generateImage` 一次性、且要精确控 quality/size/n。落点：`gateway.ts` 的 `openaiViaGateway`、`tools/generate-best-of-n.ts`。

## 架构与体验
- **D7 · 丢弃旧 FSM / stage-contract / blockingField / harness**，领域知识重写为 `skills` + `rubrics`（大脑的参考与判断工具，非脚本）。为何：旧那套框死了大脑能动性。落点：`src/knowledge/`。
- **D8 · 自检对用户隐形**（预防为主 + 静默 best-of-N 择优 + 仅客观硬伤隐形修）：旧 rhemax 把"半成品 + 改进报告"甩给用户、逼二次操作 → 失败被废。新架构客观缺陷内部处理、主观口味走对话、**绝不出报告**。落点：`rubrics/inspection.md`、`inspect.ts`、`generate-best-of-n.ts`。
- **D9 · 横向 best-of-N 优先于纵向 revise**：实测 Gateway 真并发（4 张墙钟≈单张 82s，串行需 279s，无 429）→ 并行抽奖几乎不增延迟，是主力质量杠杆。落点：`generate-best-of-n.ts`、`scripts/concurrency-spike.mjs`。
- **D10 · 退出与预算**：`task_complete` 正常退出 + `imageBudget(5)` / `stepCountIs(16)` 兜底。为何：Phase 1 曾无预算 + curl `--retry` 误用导致跑飞（10min / 6 图），故加。落点：`orchestrator.ts`。

## 速度 / 画质（实测约束）
- **D11 · 默认画幅 1024 + quality 分档**：实测 low~8s / medium~30s / high~200s。**概念/迭代用 medium、最终交付/精密结构才用 high**；**high 不可对 best-of-N + revise**（3×200s 会超时，全闭环带 revise≈3.7min）。落点：`system-prompt.ts`、`generate-best-of-n.ts`、route `maxDuration=600`。
- **D12 · Gateway 图像端点不支持 `partial_images` 流式、不采纳 `jpeg`（强制 PNG）**：实测 `stream:true` 返回整块 JSON、`output_format=jpeg` 仍出 PNG。故**无 partial 预览帧**；流式进度靠 Agent 循环本身。落点：`scripts/image-opts-spike.mjs`。

## 工程 / 收尾
- **D13 · 持久化暂存本地 FS**（`.data/`）；部署 / Auth 暂缓；AI Elements UI 暂用极简自建。均为测试期取舍，后续可换。
- **D14 · 不用 tldraw / 不做几何白模**：v2 是 chat-first；白模是当年兜底模型能力的产物，gpt-image-2 指令遵循强、不需要。

## 安全
- **D15 · `.env.local` / `.data/` 绝不入库**（`.gitignore`）。`.env.local` 含 `AI_GATEWAY_API_KEY`、`DASHSCOPE_API_KEY`。
- **D16 · 历史泄露提醒**：旧 `~/meta rhema/过程提示词和图标/rhemax-260415-*.json` 是 GCP 服务账号私钥（旧 Vertex 项目），**未带入 rhemos**，建议去 GCP 轮换/删除。

## 多视图（Phase 3 方向）
- **D17 · 多视图 = 单图 turnaround sheet（一张图四视角），非四张独立图**。实测（`scripts/multiview-spike.mjs`）：`images.edit` 图像条件化经 Gateway **404 不可用**；单图 sheet **一次渲染 = 天然同一展台**（Sonnet 判 72，前/左/右/俯视平面自洽），而分图独立生成会漂（正是 rhemax 全套锁定机制的根因）。故走 sheet。改进：prompt **强制角度分明** + best-of-N 选最一致 + 提高画幅(1536)/quality。**per-角度独立高清重绘**（用户满意后单独做）属 drift 回归的难活，**暂缓**。落点：Phase 3 `render_multiview_sheet` 工具 + 重写 `multiview.md`（删锁定机制）。

## 进度
Phase 0（接线 + 连通 spike）· Phase 1（最小 Loop Agent：澄清 + 智能提问）· Phase 2（best-of-N 自省闭环）已完成并实测。**Phase 3**（一致性 subagent，多视图）/ **Phase 4**（ASR、持久化、approval 闸门、成本监控、AI Elements）未做 —— 见 `engineering-plan.md`。
