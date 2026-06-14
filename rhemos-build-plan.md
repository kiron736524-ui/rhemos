# Rhemos 构建方案（v0.1 · 待批准）

> 状态：**待你批准** —— 本阶段不写任何应用代码，仅产出方案与框架。
> 项目：Rhemos（= Rhemax v2，全新起步）
> 范式：Loop Agent + Orchestrator（单脑 + 多工具），最大程度放大模型能力
> 落地：本地 `~/rhemos` ↔ GitHub `kiron736524-ui/rhemos`
> 参考但不照抄：`~/Desktop/rhemax-orchestrator-plan.md`、旧 rhemax 的领域提示词/skill
> 详细展开：工程执行见 [`docs/engineering-plan.md`](docs/engineering-plan.md)；领域知识层见 [`docs/domain-knowledge.md`](docs/domain-knowledge.md)

---

## 0. 这份文档是什么

这是 rhemos（rhemax 第二代）的从零构建方案。**它不迁移旧代码**——旧 rhemax 仅作为「领域知识素材」被参考（展台设计的提示词、skill、流程经验），所有架构、harness、工具、提示词都**按 Loop Agent 思路重写**，不被旧框架绑架。

批准后才进入执行；执行顺序见第 11 节。

---

## 1. 决策基线（本次对话已锁定）

| # | 决策 | 结论 |
|---|---|---|
| 1 | 代码落地 | **全新起步**，落在 `~/rhemos`，关联 GitHub 个人仓库 `rhemos`。原 `meta-rhema/rhemax` 冻结为 v1，不动。 |
| 2 | 旧代码复用 | **不迁移、不照抄 harness、不依赖 tldraw**。仅参考旧的领域提示词/skill，并**重写**。 |
| 3 | 架构范式 | Loop Agent + Orchestrator（单脑 + 多工具），自省 + 自主循环 + 高权限。 |
| 4 | 模型来源 | **Vercel AI Gateway 为唯一来源**。一个 `AI_GATEWAY_API_KEY` 路由所有模型。 |
| 5 | 对话 + 工程脑 | `anthropic/claude-opus-4.8` |
| 6 | 生图 + 改图 | `openai/gpt-image-2`（生成与编辑均支持） |
| 7 | 视频 | **砍掉**（不再有 Veo / Seedance） |
| 8 | 语音 ASR | **唯一例外**：沿用阿里云百炼 / DashScope（非 Gateway） |
| 9 | 流程 | 先批准方案 → 再执行 |

---

## 2. 技术栈

### 2.1 已锁定
- **Next.js（App Router）+ TypeScript + React 19**
- **Vercel AI SDK 6（`ai`）** —— Loop Agent 的工业级实现（Agent / ToolLoopAgent 抽象 + `stopWhen` + `prepareStep`）。
- **AI SDK UI（`@ai-sdk/react` 的 `useChat`）** —— 流式、消息、工具状态。
- **AI Elements**（基于 shadcn/ui registry，`npx ai-elements@latest add <component>`）—— `Conversation` / `Message` / `PromptInput` / `Response` / `Tool` / `Agent`。
- **Vercel AI Gateway** —— 唯一模型路由层（监控、fallback、用量）。
- **Zod 4** —— 工具 schema（AI SDK 6 在 Zod 3 下对 `tools` 易报类型错，统一 Zod 4）。
- **图片存储**：Vercel Blob（生图工具产出回传 URL，不把 base64 灌进推理上下文）。

### 2.2 明确移除 / 不引入
- ❌ `@google/genai`、Gemini 全家桶
- ❌ tldraw（不再做自由矢量画布）
- ❌ 火山方舟 Ark（Seedream / Seedance）
- ❌ 视频生成栈（Veo 等）
- ❌ 旧 harness（FSM + 旧 Zod 校验 + generation gate + sanitizer）——理念可借鉴，代码重写

### 2.3 已定（见第 12 节）
- 持久化：暂不接后端，资产与状态存本地文件系统，以后对接
- 部署 / Auth：暂不考虑，本地开发为主
- 不做画布、不做几何白模

---

## 3. 模型矩阵（全部经 Gateway，ASR 除外）

| 角色 | 模型 | 经由 | 说明 |
|---|---|---|---|
| Orchestrator 脑（对话 + 工程/调度/改写） | `anthropic/claude-opus-4.8` | Gateway | adaptive thinking + effort 可调；同时具备 **vision 输入**，能「看」生成结果做自省 |
| 生图 / 改图 | `openai/gpt-image-2` | Gateway | `generateImage` 调用；支持生成、编辑、参考图变体 |
| 高频自检 / 评价 | `anthropic/claude-sonnet-4.6`（备选 `google/gemini-3.5-flash`） | Gateway | 已定：自检走便宜快模型，关键判断走 Opus 4.8（成本与质量兼顾） |
| ASR 语音转写 | 阿里云百炼 / DashScope | **直连（非 Gateway）** | 唯一例外，沿用旧 key |
| 视频 | —— | —— | 已砍 |

**成本要点（重要）**：你指定 Opus 4.8 同时当对话脑和工程脑，没问题；但 Loop Agent 会自主多轮重试，「生成→inspect→revise→再 inspect」里 **inspect 是高频动作**。若每次自检都用 Opus 4.8，成本会被显著放大（文档原设想里这步是「便宜快模型」）。
- **建议**：用 `prepareStep` 做运行时分层——对话与关键判断走 Opus 4.8，高频自检/打分走便宜视觉模型（候选：`anthropic/claude-haiku-4.5` 或某 Gemini Flash，均经 Gateway）。
- 这是第 12 节的一个待确认项；默认我会按「分层」实现，你也可坚持「全程 Opus」。

---

## 4. Loop Agent 架构（核心）

单脑（Opus 4.8）持有完整项目上下文，运行 `观察 → 判断 → 调度 → 验证 → 重试` 闭环。其余能力全部降级为可调用的 `tool()`。

### 4.1 循环控制 —— 把「停止」交给大脑
```ts
stopWhen: [
  hasToolCall('task_complete'),  // 正常退出：大脑自己声明完成
  stepCountIs(40),               // 硬上限：仅防失控，非正常路径
]
```
- `task_complete` 工具的 schema 强制填「任务是否达成 / 还差什么 / 交付了哪些资产」。
- **不**采用「跑到自然停」的无上限模式——生图工具连环重试会烧 token，硬上限必须保留。

### 4.2 步间动态控制 —— `prepareStep`
- **运行时模型分层**：关键步用 Opus 4.8，高频自检用便宜模型（见第 3 节）。
- **工具收窄**：分阶段只暴露相关工具，降误调用与 token。
- **上下文压缩**：长循环里把早期生图日志折叠成摘要，保住有效上下文窗口。

### 4.3 自省闭环 —— 观察工具 + system prompt
把「生成后必先 `inspect_result`、发现偏差自己写修复 prompt 再 `revise_asset`、再 inspect、全过才 `task_complete`」写进 system prompt，成为大脑的工作习惯。这是 Loop Agent 区别于普通 chatbot 的核心价值。

### 4.4 子代理隔离 —— 一致性 subagent
把「多视图一致性」这种需十几轮 inspect+revise 的活，封装成一个独立的 subagent（一个被包成 `tool()` 的子 ToolLoopAgent）。主脑只看到「子代理交付了 N 张一致的图」这个结论，**不被十几轮检查日志撑爆上下文**。subagent 必须在 instructions 里被要求「完成后写一份清晰总结作为最终回复」。

### 4.5 高权限闸门 —— tool approval（人在环上）
- **可逆操作**（`revise_asset`、重新生成、丢弃草稿）→ 大脑全自主。
- **不可逆/破坏性操作**（永久删除、覆盖用户手动改过的内容）→ 标 `needsApproval`，UI 弹确认，用户批准才执行。
- 原则：**判断交给大脑，不可逆后果交给用户确认。**

### 4.6 重试预算（硬约束）
- 同一资产 `revise_asset` 最多 **3 次**，超了就 `task_complete` 并诚实告诉用户「这个做不到，建议调整为……」。
- 用自定义 `stopWhen` 函数实现（可读到完整 `steps` 数组算任意预算，含 token 预算）。
- **预算让大脑看见**：system prompt 写明「每个资产修复预算 3 次」，让它自己权衡何时放弃，而非框架在外硬砍。

---

## 5. 工具注册表（Zod 4 + `tool()`，三类）

> 这是初版 schema 草案，执行阶段细化。视频相关工具已全部移除。

### A 类 · 执行工具（产出资产）
| 工具 | 背后模型 | 角色 |
|---|---|---|
| `analyze_reference` | Opus 4.8（vision） | 看参考图，抽风格 / 结构 schema |
| `generate_booth_image` | gpt-image-2 | 生概念图 / 主视图 |
| `render_multiview` | gpt-image-2 × N + 自检 | 多视图渲染 + 一致性校验（通常委派给一致性 subagent） |

### B 类 · 观察工具（自省的物理前提）
| 工具 | 背后模型 | 角色 |
|---|---|---|
| `inspect_result` | 便宜视觉模型 / Opus 4.8 | 输入资产 id，返回结构化评估：哪里对、哪里不对、与意图偏差多少 |
| `read_project_state` | —— | 读当前已生成资产清单、当前 brief / schema 版本 |

### C 类 · 读写 / 纠错工具（高权限来源）
| 工具 | 角色 | needsApproval |
|---|---|---|
| `revise_asset(asset_id, fix_prompt)` | gpt-image-2 编辑/重生成某资产 | 否（可逆） |
| `discard_asset(asset_id)` | 丢弃不合格产出 | 视情况 |
| `update_workspace(operation)` | 增删改结果工作区元素 | 破坏用户手改内容时需 approval |
| `task_complete(summary)` | 显式声明任务完成（控制循环退出） | 否 |

**生图与推理会话隔离**：生图 token 开销大（多参考图都要编码进去）。在工具的 `execute` 里起**独立请求**调 gpt-image-2，生完只把 URL（存 Vercel Blob）回传给主脑会话，避免推理上下文被生图 token 撑爆。

> 关于 `build_white_model` / 几何内核：旧 rhemax 的 `scene-core.js` 未找到，且「白模」本质是当年兜底模型能力不足的产物。gpt-image-2 指令遵循更强，**建议先不做几何内核**，纯走「参考图→生图→多视图」链路；若后续需要再评估。列为待确认项。

---

## 6. 前端 / 产品形态

- **`useChat` + AI Elements** 搭对话主干（`Conversation` / `Message` / `PromptInput` / `Response`）。
- **`Tool` 组件可视化每一次工具调用**（哪个工具、输入什么、产出什么）——把「大脑的中间过程」做成可观察 UI，默认折叠，需要时展开。
- **Generative UI**：生图、多视图结果渲成富组件（图廊 / 对比卡），而非纯文本。
- **「两端」产品哲学落到 UI**：用户只看到两端——「我想要什么」（意图输入）和「这是不是我想要的」（结果）；中间的调度、重试、自检全部由大脑吃掉，以可折叠日志呈现。

**画布替代方案（tldraw 已弃 · 待确认）**：建议 v2 起步为 **chat-first + 结果工作区（gallery/对比视图）**，不做自由矢量画布；以 AI Elements 的 generative UI 承载资产管理。若你仍要一个可编辑画布，再单独设计轻量方案。列为第 12 节待确认项。

---

## 7. System Prompt & Skills（全部重写）

- **Orchestrator system prompt**：角色定位、决策框架、调度原则、何时澄清何时直接执行、自省工作习惯（生成必先 inspect）、重试预算告知。
- **展台设计领域 skills**：把旧 rhemax 提示词里的**领域事实**（动线、品牌曝光高度、交互区布局、材料/灯光规范、不同展会类型差异、常见错误）提炼重写为新体系下的 skill / 知识注入；**不照抄旧结构**，完全为 Loop Agent 服务。
- 我会在执行阶段先起草，再交你审。

---

## 8. 持久化与会话

- **Project 级 Orchestrator session**：每个 project 持有完整上下文（brief、风格、偏好、对话历史、已生成资产）。
- **暂不接后端**：资产（图片）与 project state 直接存**本地文件系统**（如 `~/rhemos/.data/`），以后再对接 DB / Vercel Blob。配合 `prepareStep` 的步间上下文压缩。
- 何时唤醒 / 休眠、前瞻预热触发条件，列为后续工程化收尾项。

---

## 9. 成本与可观测性

- Opus-everywhere 的成本风险（第 3 节）→ 用 `prepareStep` 模型分层 + 重试预算双重控制。
- **监控**：Vercel AI Gateway 用量面板 + AI SDK telemetry / DevTools，重点盯 Loop Agent 的自主重试放大效应。

---

## 10. 建议目录结构

```
rhemos/
├─ src/
│  ├─ app/
│  │  ├─ api/agent/route.ts        # 主 Loop Agent 入口（streamText / Agent）
│  │  └─ (ui)/...                  # 对话页面
│  ├─ agent/
│  │  ├─ orchestrator.ts           # ToolLoopAgent 装配（model / stopWhen / prepareStep）
│  │  ├─ system-prompt.ts          # Orchestrator system prompt
│  │  ├─ budget.ts                 # 重试 / token 预算（自定义 stopWhen）
│  │  └─ subagents/consistency.ts  # 多视图一致性 subagent
│  ├─ tools/
│  │  ├─ analyze-reference.ts      # A 类
│  │  ├─ generate-booth-image.ts   # A 类
│  │  ├─ render-multiview.ts       # A 类
│  │  ├─ inspect-result.ts         # B 类
│  │  ├─ read-project-state.ts     # B 类
│  │  ├─ revise-asset.ts           # C 类
│  │  ├─ discard-asset.ts          # C 类
│  │  ├─ update-workspace.ts       # C 类
│  │  └─ task-complete.ts          # C 类
│  ├─ models/gateway.ts            # 模型句柄（opus-4.8 / gpt-image-2 / 便宜自检模型）
│  ├─ skills/                      # 重写的展台设计领域知识
│  └─ lib/ (blob, asr, persistence...)
├─ docs/                           # 本方案及后续设计文档
├─ .env.local                      # 密钥（已 gitignore）
└─ .gitignore
```

---

## 11. 落地顺序（批准后执行 · 分阶段，每阶段有验收）

- **Phase 0 · 接线 + 连通性**
  - `~/rhemos` git init → 关联 GitHub `rhemos` → 首次提交（含 `.gitignore`，确认 `.env.local` 不入库）。
  - Next.js + AI SDK 6 脚手架；一个最小 spike：经 Gateway 各调一次 `opus-4.8`（文本）与 `gpt-image-2`（生图），**验证 key 有效**。
  - 验收：两个模型都能经 Gateway 跑通。

- **Phase 1 · 最小可行 Loop Agent**
  - 装 `analyze_reference` + `generate_booth_image` + `inspect_result` + `task_complete`，`stopWhen: [hasToolCall('task_complete'), stepCountIs(40)]`。
  - 打通 `useChat` + AI Elements `Conversation` / `Tool`：发请求 → 看到工具调用与自省过程 → 拿到结果。
  - 验收：大脑能正确**分解 + 调度**。

- **Phase 2 · 自省闭环（核心价值主张）**
  - 加 `render_multiview` + `revise_asset` + 重试预算。
  - 验收：大脑能「自检 → 写修复 prompt → revise → 再检 → 通过」自主跑完。

- **Phase 3 · 子代理隔离**
  - 抽出一致性 subagent，把多视图一致性移出主循环。

- **Phase 4 · 工程化收尾**
  - 接 ASR（DashScope）；持久化；approval 边界清单；成本监控；前瞻预热。

**最先验证的两个假设**：① 大脑能正确分解 + 调度；② 大脑能自检并自主重试。这两点成立，整个架构就成立。

---

## 12. 开放决策 —— 已拍板（2026-06-13）

| # | 决策 | 结论 |
|---|---|---|
| 1 | 画布形态 | **不要画布**。chat-first + 结果工作区（图廊 / 对比） |
| 2 | 自检模型 | **Sonnet 4.6**（备选 Gemini 3.5 Flash）做高频自检；Opus 4.8 做对话与关键判断 |
| 3 | 几何内核 / 白模 | **不做** `build_white_model`，纯走生图链路 |
| 4 | 持久化 | **暂不接后端**，资产与 project state 直接存本地文件系统，以后再对接 DB / Blob |
| 5 | 部署 & Auth | **暂不考虑**，本地开发为主 |
| 6 | DashScope key | **已提供**，存入 `.env.local`（ASR 用，与 Qwen 共用） |

### 仍待你提供 / 决定
- **领域素材**：旧 rhemax 提示词、`~/meta rhema/过程提示词和图标`、案例库 / 搭建规范 / 优秀渲染参考 —— 用于重写 skill 与两个 rubric（决定诉求 2、3 的专业度上限）。
- **是否先起草** system prompt 决策框架 + rubric + design spec 结构，再进入 Phase 0。

---

## 13. 安全说明

- 你的 Vercel key 已存入 `~/rhemos/.env.local`，该文件被 `.gitignore` 排除，**不会进入 git / GitHub**，也不在任何会被提交的文档里明文出现。
- 提醒：该 key 已在本次对话中出现过；如担心，可在用完后到 Vercel 控制台轮换一次（可选，不影响方案）。
