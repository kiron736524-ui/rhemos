# Rhemos 工程执行计划

> 配套文档：策略与决策见 [`../rhemos-build-plan.md`](../rhemos-build-plan.md)；领域知识层（大脑的"灵魂"）见 [`./domain-knowledge.md`](./domain-knowledge.md)。
> 本文回答「**怎么建**」：技术栈 → 从大到小的架构 → 模块分解 → 关键数据结构与控制流 → 分阶段任务与验收。
> 进度：Phase 0-4 已实现并实测（详见第 5 节各项勾选）；Phase 5（生产化）待部署时做。

---

## 1. 技术栈（精确选型 + 理由）

| 层 | 选型 | 理由 / 备注 |
|---|---|---|
| 框架 | Next.js（App Router）+ React 19 + TypeScript 5 | 与生态一致；API Route 承载 Agent，前端承载对话 |
| Agent 运行时 | **Vercel AI SDK 6（`ai`）** | `Agent`/ToolLoopAgent 抽象 + `stopWhen` + `prepareStep`，就是 Loop Agent 的工业级实现（确切导出名在 Phase 0 对照官方文档锁定） |
| 前端对话 | **`@ai-sdk/react` 的 `useChat`** | 流式、消息、工具调用状态 |
| UI 组件 | 自建极简三栏工作台〔历史计划 AI Elements，未采用〕| 对话/卡片/画廊/布局编辑器均自建；工具过程可折叠（调试态） |
| 模型路由 | **多来源**〔历史写"Gateway 唯一来源"——已被 D29 替代〕：Gateway（脑/判图/写prompt/清理/Gemini）+ **fal.ai**（gpt-image-2）+ DashScope（ASR）| `AI_GATEWAY_API_KEY` + `FAL_API_KEY` + `DASHSCOPE_API_KEY` |
| 生图 | `openai/gpt-image-2` 经 **fal.ai**（`fal.run/openai/gpt-image-2[/edit]`）| 〔历史计划写 `experimental_generateImage` / Gateway 图像端点——均未采用：Gateway 图编辑不通（D27），现经 fal.ai 文生图 + 图编辑（D29）；provider 层见 `models/image-providers.ts`〕|
| 工具 schema | **Zod 4** | AI SDK 6 在 Zod 3 下 `tools` 易类型错，统一 Zod 4 |
| 存储 | **本地文件系统**（`.data/`，gitignored）| 暂不接 DB/Blob；project state 存 JSON、图片存文件，预留 storage 接口以后切换 |
| 语音 ASR | 阿里云百炼 / DashScope（Fun-ASR）直连 | 非 Gateway 例外之一（另一例外：gpt-image-2 经 fal.ai，D29），key 已配 |
| 可观测 | AI SDK telemetry/DevTools + Gateway 用量面板 | 重点盯 Loop Agent 自主重试的成本放大 |
| 测试 | Vitest（轻量，仅核心逻辑：预算函数、rubric 解析、storage） | 不追求覆盖率，保关键不变量 |

**明确不引入**：`@google/genai`、tldraw、火山方舟、视频栈、旧 harness（FSM/stage-contract/generation-gate/sanitizer，理念借鉴、代码不搬）。

**视觉语言（可复用）**：旧项目已选定「Gallery Minimal」——深墨蓝单一 accent + 衬线品牌字 + 大留白。新 UI 框架重写，但这套美学方向可直接沿用做起点（资产见 `docs/ui/` 与 `过程提示词和图标/`）。

---

## 2. 宏观架构（系统全景）

```
┌─────────────────────────────────────────────────────────────┐
│  前端 UI 层  Next.js + useChat + AI Elements                  │
│  · 两端体验：意图输入 (PromptInput) + 结果工作区 (图廊/对比)    │
│  · 中间过程：Tool 组件折叠日志（每次工具调用可观察）            │
└───────────────▲───────────────────────────┬─────────────────┘
                │ SSE 流                      │ HTTP
┌───────────────┴───────────────────────────▼─────────────────┐
│  API 层  /api/agent/route.ts                                  │
│  · streamText(orchestrator)  · 鉴权(暂无)  · 错误兜底          │
└───────────────────────────┬─────────────────────────────────┘
                            │
┌───────────────────────────▼─────────────────────────────────┐
│  Agent 核心层  Orchestrator（单脑 = Opus 4.8）                 │
│  · system prompt（决策框架，非脚本）                          │
│  · stopWhen [hasToolCall('task_complete'), 预算函数, step 40] │
│  · prepareStep（模型分层 / 工具收窄 / 上下文压缩）            │
│  · 自省闭环：生成→inspect→写纠正prompt→revise→再inspect       │
│  └── subagent：多视图一致性（独立小循环，只回总结）           │
└───────┬───────────────────────────────────────────┬─────────┘
        │ 调用 tool()                                  │ 读写
┌───────▼─────────────────────┐         ┌────────────▼─────────┐
│  工具层（Zod）              │         │  知识层（领域素材）   │
│  A 执行 / B 观察 / C 纠错   │◀────────│  system prompt 片段   │
│  （详见第 3 节）            │         │  skills + 2 rubric    │
└───────┬─────────────────────┘         │  prompt 模式库        │
        │                                └──────────────────────┘
┌───────▼──────────────────────────────────────────┐
│  模型层  Gateway: opus-4.8(脑/判图/写prompt/清理)  │
│          ‖ fal.ai: gpt-image-2 ‖ DashScope: ASR    │
│          ‖ DashScope: ASR(直连)        〔as-built〕  │
└───────┬───────────────────────────────────────────┘
        │
┌───────▼──────────────────────────────────────────┐
│  存储层  本地 FS：.data/projects/<id>/state.json  │
│          .data/projects/<id>/assets/<assetId>.png │
└───────────────────────────────────────────────────┘
```

**主数据流（一次完整请求）**：用户意图 → API → Orchestrator 进入循环 → （信息不足？`read_project_state` + 推理 rubric → 卡片提问）→（信息足？写 `DesignSpec`，含 identity + footprint 外轮廓硬规则）→ `present_layout` 让用户确认/跳过布局 → `render(views=[], n=2, autoCheck=false)` 出首稿候选 → 用户点选基准图写入 `baseAssetId` → 如用户要多视角/俯视/精修，再基于 `baseAssetId` 深化 → `task_complete` → 交付。

---

## 3. 中观架构（模块分解）

### 3.1 目录结构
```
rhemos/
├─ src/
│  ├─ app/
│  │  ├─ api/agent/route.ts          # Orchestrator 入口（streamText）
│  │  ├─ api/asr/route.ts            # DashScope 转写（唯一非 Gateway）
│  │  ├─ api/assets/[id]/route.ts    # 本地图片读出
│  │  └─ (chat)/page.tsx             # 对话主界面
│  ├─ agent/
│  │  ├─ orchestrator.ts             # Agent 装配：model/stopWhen/prepareStep/tools
│  │  ├─ system-prompt.ts            # 组装 system prompt（决策框架 + 注入 skills）
│  │  ├─ budget.ts                   # 自定义 stopWhen：每资产 revise≤3、token 预算
│  │  ├─ model-tiering.ts            # prepareStep：关键步 Opus / 自检 Sonnet
│  │  └─ subagents/consistency.ts    # 多视图一致性 subagent（包成 tool）
│  ├─ tools/                         # 每个工具一个文件，Zod schema + execute
│  │  ├─ analyze-reference.ts        # A·看参考图（Opus vision）
│  │  ├─ generate-booth-image.ts     # A·生图（gpt-image-2）
│  │  ├─ render-multiview.ts         # A·多视图（委派 subagent）
│  │  ├─ inspect-result.ts           # B·自检（Sonnet 4.6 vision，输出 vs spec）
│  │  ├─ read-project-state.ts       # B·读当前 brief/资产/spec
│  │  ├─ revise-asset.ts             # C·定向编辑重生（gpt-image-2 edit）
│  │  ├─ discard-asset.ts            # C·丢弃
│  │  ├─ update-spec.ts              # C·更新 DesignSpec / brief 字段
│  │  └─ task-complete.ts            # C·声明完成（控制循环退出）
│  ├─ knowledge/                     # 领域知识层（详见 domain-knowledge.md）
│  │  ├─ skills/*.md                 # 重写精炼的领域 skill
│  │  ├─ rubrics/questioning.ts      # 提问完备度 rubric（结构化）
│  │  ├─ rubrics/inspection.ts       # 生图自检 rubric（结构化）
│  │  └─ prompt-patterns.ts          # 五层架构 + 尺寸锚定表 + 视觉词汇表 + 风格库
│  ├─ models/gateway.ts              # 模型句柄常量 + 调用封装
│  ├─ lib/
│  │  ├─ storage.ts                  # 本地 FS 抽象（预留切 DB/Blob）
│  │  ├─ asr.ts                      # DashScope Fun-ASR 客户端
│  │  └─ types.ts                    # ProjectState / DesignSpec / Asset
│  └─ components/                    # AI Elements 封装 + 结果工作区
├─ .data/                            # 本地存储（gitignored）
├─ docs/                             # 本文档等
├─ .env.local                        # 密钥（gitignored）
└─ .gitignore
```

### 3.2 工具注册表（A/B/C 三类，Zod）

| 类 | 工具 | 输入（要点）| 模型 | approval | 说明 |
|---|---|---|---|---|---|
| A | `analyze_reference` | imageRef(s) | Opus 4.8 vision | 否 | 抽风格/结构/品牌特征 → 写入 spec 素材 |
| A | `render` | intent / views / planAssetId / n / quality / autoCheck | gpt-image-2(fal) + Opus prompt-writer | 否 | 唯一生图入口；默认首稿 `candidate-set`，用户选 `baseAssetId` 后再多视角深化 |
| B | `read_project_state` | — | — | 否 | 读 brief/spec/layout/baseAssetId/资产清单（gap 分析依据）|
| B | `present_choices` | questions + layout options | — | 否 | 卡片提问与布局草图 |
| B | `present_layout` | layout | — | 否 | 方案后让用户确认/跳过布局 |
| C | `revise_asset` | assetId, fixPrompt | gpt-image-2 edit | 否（可逆）| 定向编辑重生 |
| C | `update_brief` | facts patch | — | 否 | 更新业务记忆 |
| C | `update_spec` | narrative / identity / footprint / invariants / criteria | — | 否 | 更新 DesignSpec / 外轮廓硬规则 |
| C | `task_complete` | summary, delivered[], gaps[] | — | 否 | 显式收尾，触发循环退出 |

**生图与推理会话隔离**：A/C 类生图工具在 `execute` 内**起独立模型请求**，生成后只把本地 URL + 简短元数据回传主脑，避免把图片 token 灌进推理上下文。

---

## 4. 微观（关键数据结构与控制流）

### 4.1 强类型 Brief（相对旧系统的实质改进）
旧 rhemax 把面积/开口/高度等都塞进自由文本 `briefSummary`+`knownConstraints`，强结构只活在 `blockingField` 字符串里。新系统**把隐含字段升为强类型**（来源见 domain-knowledge.md 的字段词典）：

> **现状（D30）**：最小骨架 `BoothBrief` 已落地 `src/lib/types.ts`（`brief: BoothBrief & Record<string, unknown>`，兼容旧自由键、未强制全量迁移）。下方为完整设想，字段名 / 层级与已实现版略有出入，待渐进对齐。

```ts
type BoothBrief = {
  space:   { footprint?: {longSide:number; shortSide:number}; openSides?: 1|2|3|4;
             openingRelation?: 'corner'|'parallel'; backWall?: 'long'|'short';
             mainAisle?: string; heightLimit?: number };
  height:  { includesTruss?: boolean; mainWall?: number /*默认4.4国内/4.0国外*/ };
  top:     { strategy?: 'none'|'header'|'ground_truss'|'suspended_truss';
             centerForm?: string; suspensionApproved?: boolean };
  purpose?: 'brand'|'product'|'launch'|'negotiation'|'experience';
  products?: { kind:string; count?:number; viewingDistance?:string; layout?:string };
  circulation?: { zones: string[]; priority?: string[] };
  brand:   { name?:string; slogan?:string; logo?:'has'|'placeholder'; placement?:string[] };
  style?:  { tone?:string; primaryColor?:string; secondaryColor?:string };
  material?: { budgetTier?:'low'|'mid'|'high'; palette?:string[]; lighting?:string };
  // 每字段附 source: 'user'|'assumed'，assumed 须 disclosure
};
```

### 4.2 DesignSpec（"成熟方案"产物 —— 用户不写、大脑写）
桥接 `brief → 给用户看的方案 → 生图 prompt → 外轮廓硬规则 → 按需诊断基准`。一份 spec 同时是人读的方案和机读的生图依据；`render(autoCheck=true)` 或后续诊断工具可用它做"输出 vs spec"硬对比。

```ts
type DesignSpec = {
  id: string;
  narrative: string;          // 给用户看的中文方案
  layers: PromptFiveLayers;   // 五层架构（见 prompt-patterns）
  invariants: string[];       // 跨视图不可变量（多视图一致性用）
  selfCheckTargets: string[]; // 本方案要重点盯的自检维度
};
```

### 4.3 循环控制
```ts
// orchestrator.ts（示意）
stopWhen: [
  hasToolCall('task_complete'),
  budgetExceeded,            // budget.ts：任一资产 revise>3 或 token 超限 → 让大脑收尾
  stepCountIs(40),           // 硬上限，仅防失控
]

// 当前实现：主脑 / prompt-writer / 按需 inspect 均走 Opus 4.8；
// 生图经 fal.ai gpt-image-2，ASR 经 DashScope。
```

### 4.4 自省闭环（核心价值，伪代码）—— 自检全程对用户隐形（见 domain-knowledge §0 判断 2）
```
loop (大脑自主):
  state = read_project_state()
  if brief 不完备 (按 questioning rubric 做 gap 分析):
      present_choices 问当前最高价值的 1 个布局骨架缺口（具体可视化选项，用户回答后再重排下一问）; continue
  if 无 spec:
      spec = 写 DesignSpec(brief + skills + analyze_reference + footprint); update_spec; continue
  if layout 未 confirmed/skipped:
      present_layout; 等用户确认或跳过; continue
  if 无 baseAssetId:
      render(views=[], n=2, autoCheck=false)                   # 并发首稿候选 candidate-set
      等用户点选基准图; continue
  if 用户明确要多视角/俯视/深化:
      render(views=[...], n=1, autoCheck=false)                # 基于 baseAssetId 参考条件化
  if 用户明确要求诊断/修正:
      render(..., autoCheck=true) 或 revise_asset(...)
  task_complete(交付用户选定/深化后的结果)
```

---

## 5. 分阶段执行（任务级 + 验收）

### Phase 0 · 接线 + 连通性（地基）
- [ ] `~/rhemos` `git init` → 关联 GitHub `kiron736524-ui/rhemos` → 首次提交（确认 `.env.local` 不入库）
- [ ] Next.js + TS + AI SDK 6 + AI Elements 脚手架；`models/gateway.ts`、`lib/storage.ts` 雏形
- [ ] **连通性 spike**：经 Gateway 各调一次 `opus-4.8`（文本）、`gpt-image-2`（生图）；验证 key 有效、**锁定 gpt-image-2 的确切调用形态与参数**（size/质量/编辑/参考图）
- [ ] **视觉判图基准（inspector 选型）**：用真实生成的展台图（含已知缺陷：悬浮结构/薄墙挂大屏/比例失真）对照 spec，让候选模型各判一遍——**Sonnet 4.6 / Opus 4.8 / Gemini 3.x Pro / GPT-5.x**（Gemini 3.5 Flash 作快档对照），以 Opus 4.8 或人工为 ground truth 比命中率，选质量/成本最优者。inspector 做成**可切换 config**，支持"便宜档先判、不确定或最终交付升级 Opus"分档。
- **验收**：opus-4.8 与 gpt-image-2 经 Gateway 跑通、图片存本地并读出；inspector 候选有一份判图命中率对比并选定默认值。

### Phase 1 · 最小可行 Loop Agent
- [ ] 装 `analyze_reference` + `render` + `read_project_state` + `present_choices` + `update_brief` + `update_spec` + `task_complete`
- [ ] orchestrator：`stopWhen`、`prepareStep` 模型分层、system prompt v1（注入精简 skills + questioning rubric）
- [ ] `useChat` + AI Elements `Conversation`/`Tool` 链路；本地 storage
- **验收**：发请求 → 看到工具调用与自省过程 → 拿到结果；**大脑能正确分解 + 调度 + 智能提问**（诉求 1、2 初步成立）。

### Phase 2 · 自省闭环（核心价值主张）· 横向优先
> **实测（2026-06-14）**：4 张 gpt-image-2 并行 = 墙钟 82s ≈ 单张（串行需 279s），4/4 成功无 429。**Gateway 真并发** → best-of-N 几乎不增延迟。另：1024×1024 ~50-82s，远快于 1536×1024 ~190s（画幅决定速度）。
- [x] **首稿候选并行生图**：`render(views=[], n=2, autoCheck=false)` 内部 `Promise.all` 并行两张；候选先交给用户选基准，不默认 AI 筛掉。
- [x] DesignSpec 写作 + `update_spec`（存 project state，含 identity + footprint 外轮廓硬规则 + selfCheckCriteria）
- [x] `revise_asset`（gpt-image-2 编辑模式）作**按需窄回退**：用户要求修正时只改一处硬伤
- [ ] 正式预算 `budget.ts`（替换 Phase 1 兜底）+ **并发上限 + 429 退避**；大脑按"分量"选 N 与画幅（概念 1-2@1024 ~60s；最终 4-6@1536 并行 + 择优）
- [ ] inspection rubric 完整化；system prompt v2
- **验收**：大脑能「写方案 → 并行两张首稿候选 → 用户选基准 → 按需深化/修正 → 交付」跑通，且首稿总延迟接近单张。

### Phase 3 · 多视图（历史：单图 turnaround sheet；已被 D34 基准图多视角替代）
> 实测（`scripts/multiview-spike.mjs`）：`images.edit` 图像条件化经 Gateway **404 不可用**；单图 sheet 一次渲染**天然一致**(Sonnet 72，胜分图)。故**弃 rhemax 全套锁定机制**（不再做 identity-spec 重注入/坐标锚图/失败重试/十几轮 subagent）。
- [x] 历史 `render_multiview_sheet` 工具已废弃：当前多视角走 `render(views=[...])`，且必须先由用户选 `baseAssetId`。
- [x] 重写 `src/knowledge/skills/multiview.md`：sheet prompt 模板（**强制角度分明 + 平面图**），删除锁定机制。
- [x] 注册工具 + system-prompt 告知大脑何时用（用户要"多视角全貌"）；单张 money shot 仍走 hero best-of-N。
- [ ] （暂缓）per-角度独立高清重绘：用户满意 sheet 后再单独高清化。
- **验收（当前）**：用户先选定首稿基准图，再说"给我多视角/俯视" → 大脑基于 `baseAssetId` 出单视角全幅图。

### Phase 4 · 产品骨架（隔离 + 用户可见层边界）· 据架构批评优化
> 走向产品的第一优先级不是加模型能力，而是**隔离 / 沉淀 / 边界**。以下都不依赖部署决定。
- [x] **ASR 语音输入**（Fun-ASR 直连 + DeepSeek V4 Flash 清理 + 录音前端 `VoiceInputButton`）。
- [x] **projectId 隔离落地**：storage 从单一 `DEFAULT_PROJECT` 改 projectId-keyed（`.data/projects/<id>/`）；projectId 入 URL（`/projects/:projectId`）并注入工具 `experimental_context`。左侧项目面板：列表 / 切换载入 / 新建 / 删除 / 当前高亮。最小 Run 记录已落地；完整队列/取消/重试仍归 Phase 5。
- [x] **inspection 沉淀回 asset**：`render(autoCheck=true)` / `revise_asset` 的判图结果可经 `addInspection` 写回 `Asset.inspections`，修了"判完不写回 → `read_project_state` 永远空"的真 bug。
- [x] **用户态 / 调试态 UI 分层**：三栏工作台（项目面板 / 对话 / 资产画廊）；交付图进对话气泡（"✓ 推荐"标记），工具过程默认隐藏、**调试开关**才露；**用户级进度旁白**（"正在整理方案/生成候选/筛选/修正结构"），不露评分。
- [x] **多模态上传**（计划外补充）：上传先资产化为轻量引用；图片/PDF（Opus 原生）+ Word（mammoth 提取正文+内嵌图）+ Excel（ExcelJS 转 CSV），服务端 `src/lib/attachments.ts` 按需预处理；附件 Claude 式缩略图 / 悬浮预览 / 单击放大 / 文件卡片。
- [x] **轻并发安全**：per-project 写锁（`withLock`，进程内串行化 state.json 写）。
- [ ] **用户选图=强信号**（未做）：选某候选"用这张继续"→ 后续围绕它、不自动改选 recommended；重生(开分支) vs 改图(派生 parentId) 在 UX 显性化。
- [x] **薄代码级不变量（非 FSM）**（部分落地）：final render 必须有 `spec.identity`，且布局已 confirmed/skipped；`render` 内部有单工具图片预算硬上限。用户选图锁定仍未做。
- **验收**：✅ 多项目互不污染、用户只见两端+资产、inspection 有记忆、上传/语音可用；⬜ 选图强信号 + 薄不变量待补。

### Phase 5 · 生产化（部署时做；当前 deploy/auth 已缓，见 DECISIONS D13）
- [ ] **真持久化**：DB(Postgres/Prisma) + 对象存储(Blob) + 签名 URL + CDN/cache（替本地 `.data` + 开放的 `/api/assets`）。
- [ ] **auth + 多租户 + 限流/配额**。
- [ ] **成本核算**(按 user/project/model/quality) + telemetry + 取消/重试/降级策略。
- [ ] **长任务承托**：job/队列/Workflow checkpoint（解 serverless `maxDuration` 限制，替 `maxDuration=600`）。
- **验收**：可公开部署、多用户、成本可观测、长任务不超时。

---

## 6. 风险与对策
| 风险 | 对策 |
|---|---|
| **视觉自检的 UX 陷阱**（旧团队曾因此废弃 QC）| 当前默认把首稿选择权交给用户：`candidate-set` 两张候选先选基准，AI 判图/一致性检查只在用户要求诊断时启用；避免把半成品报告、自动重试和冗余图堆给用户。 |
| **成本放大**（Opus 全程 + 自主重试）| prepareStep 模型分层（自检走 Sonnet）；每资产 revise≤3 硬预算；预算让大脑看见 |
| **自由 → 乱跑/过度提问** | system prompt 给决策框架 + questioning rubric 约束布局骨架一次 1 问；step 硬上限兜底 |
| **gpt-image-2 调用细节未定** | Phase 0 spike 先锁定（size/编辑/参考图/多图）再开发上层 |
| **gpt-image-2 vs 旧 nano 的 prompt 适配** | 五层架构/锚定表可复用；但 gpt-image-2 指令遵循/文字渲染更强，可更依赖显式指令，spike 校准 prompt 模式库 |
