# Rhemos 工程执行计划（v0.1 · 待批准）

> 配套文档：策略与决策见 [`../rhemos-build-plan.md`](../rhemos-build-plan.md)；领域知识层（大脑的"灵魂"）见 [`./domain-knowledge.md`](./domain-knowledge.md)。
> 本文回答「**怎么建**」：技术栈 → 从大到小的架构 → 模块分解 → 关键数据结构与控制流 → 分阶段任务与验收。
> 本阶段不写应用代码，批准后按第 5 节执行。

---

## 1. 技术栈（精确选型 + 理由）

| 层 | 选型 | 理由 / 备注 |
|---|---|---|
| 框架 | Next.js（App Router）+ React 19 + TypeScript 5 | 与生态一致；API Route 承载 Agent，前端承载对话 |
| Agent 运行时 | **Vercel AI SDK 6（`ai`）** | `Agent`/ToolLoopAgent 抽象 + `stopWhen` + `prepareStep`，就是 Loop Agent 的工业级实现（确切导出名在 Phase 0 对照官方文档锁定） |
| 前端对话 | **`@ai-sdk/react` 的 `useChat`** | 流式、消息、工具调用状态 |
| UI 组件 | **AI Elements**（`npx ai-elements@latest add …`）| `Conversation`/`Message`/`PromptInput`/`Response`/`Tool`/`Agent`，把工具调度过程做成可折叠日志 |
| 模型路由 | **Vercel AI Gateway**（唯一来源）| 模型用字符串形态 `anthropic/claude-opus-4.8` 等；`AI_GATEWAY_API_KEY` 已配 |
| 生图 | `experimental_generateImage`（AI SDK）调 `openai/gpt-image-2` | 生成 + 编辑；确切调用形态（generateImage vs chat-completions、size/质量/参考图参数）在 Phase 0 spike 验证 |
| 工具 schema | **Zod 4** | AI SDK 6 在 Zod 3 下 `tools` 易类型错，统一 Zod 4 |
| 存储 | **本地文件系统**（`.data/`，gitignored）| 暂不接 DB/Blob；project state 存 JSON、图片存文件，预留 storage 接口以后切换 |
| 语音 ASR | 阿里云百炼 / DashScope（Fun-ASR）直连 | 唯一非 Gateway 例外，key 已配 |
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
│  模型层  Gateway: opus-4.8 / gpt-image-2 /        │
│          sonnet-4.6（自检）   ‖  DashScope ASR(直) │
└───────┬───────────────────────────────────────────┘
        │
┌───────▼──────────────────────────────────────────┐
│  存储层  本地 FS：.data/projects/<id>/state.json  │
│          .data/projects/<id>/assets/<assetId>.png │
└───────────────────────────────────────────────────┘
```

**主数据流（一次完整请求）**：用户意图 → API → Orchestrator 进入循环 → （信息不足？`read_project_state` + 推理 rubric → 提问）→（信息足？写 `DesignSpec` → `generate_booth_image`）→ `inspect_result`（Sonnet 4.6 看图 vs spec）→ 有偏差则 Opus 写纠正 prompt → `revise_asset`（gpt-image-2 编辑）→ 再 inspect → 通过 → `task_complete` → 交付。用户只感知两端。

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
| A | `generate_booth_image` | spec/prompt, size, count | gpt-image-2 | 否 | 主视图/概念图；独立请求，回传本地 URL |
| A | `render_multiview` | assetId, views[] | 委派 consistency subagent | 否 | 多视图 + 一致性校验 |
| B | `inspect_result` | assetId, specId | Sonnet 4.6 vision | 否 | 输出 vs spec 的结构化批评（按自检 rubric）|
| B | `read_project_state` | — | — | 否 | 读 brief/spec/资产清单（gap 分析依据）|
| C | `revise_asset` | assetId, fixPrompt | gpt-image-2 edit | 否（可逆）| 定向编辑重生 |
| C | `discard_asset` | assetId | — | 视情况 | 丢弃不合格产出 |
| C | `update_spec` | patch | — | 否 | 更新 DesignSpec / 强类型 brief 字段 |
| C | `task_complete` | summary, delivered[], gaps[] | — | 否 | 显式收尾，触发循环退出 |

**生图与推理会话隔离**：A/C 类生图工具在 `execute` 内**起独立模型请求**，生成后只把本地 URL + 简短元数据回传主脑，避免把图片 token 灌进推理上下文。

---

## 4. 微观（关键数据结构与控制流）

### 4.1 强类型 Brief（相对旧系统的实质改进）
旧 rhemax 把面积/开口/高度等都塞进自由文本 `briefSummary`+`knownConstraints`，强结构只活在 `blockingField` 字符串里。新系统**把隐含字段升为强类型**（来源见 domain-knowledge.md 的字段词典）：

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
桥接 `brief → 给用户看的方案 → 生图 prompt → 自检基准`。一份 spec 同时是人读的方案和机读的生图依据；`inspect_result` 用它做"输出 vs spec"硬对比。

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

// prepareStep（model-tiering.ts，示意）
prepareStep: ({ steps }) => {
  const lastTool = lastToolName(steps);
  if (lastTool === 'inspect_result') return { model: 'anthropic/claude-sonnet-4.6' };
  return { model: 'anthropic/claude-opus-4.8' };
  // 也可在此收窄 tools、压缩早期生图日志
}
```

### 4.4 自省闭环（核心价值，伪代码）—— 自检全程对用户隐形（见 domain-knowledge §0 判断 2）
```
loop (大脑自主):
  state = read_project_state()
  if brief 不完备 (按 questioning rubric 做 gap 分析):
      问最高价值的 1-3 个缺口（具体可视化选项）; continue
  if 无 spec:
      spec = 写 DesignSpec(brief + skills + analyze_reference); update_spec; continue
  depth = 大脑按"这次的分量"定(概念→N=1; 最终交付→N=2~3 且允许修复)
  assets = generate_booth_image(spec, count=depth.N)          # 并行 best-of-N
  best = argmax over assets of inspect_result(a, spec)         # Sonnet 4.6 静默判图择优
  if best 有 fail 级客观硬伤 and depth 允许修复:
      fix = Opus 写定向纠正 prompt(仅针对客观硬伤, 采样对的部分)
      best = revise_asset(best, fix)                           # gpt-image-2 隐形定向编辑(≤1次)
  task_complete(静默交付 best, 不出报告)                       # 用户只收到成品
  # 仅当遇到"必须用户拍板的真实抉择"(非质量问题)才在 loop 中用一句自然问话开口
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
- [ ] 装 `analyze_reference` + `generate_booth_image` + `inspect_result` + `read_project_state` + `task_complete`
- [ ] orchestrator：`stopWhen`、`prepareStep` 模型分层、system prompt v1（注入精简 skills + questioning rubric）
- [ ] `useChat` + AI Elements `Conversation`/`Tool` 链路；本地 storage
- **验收**：发请求 → 看到工具调用与自省过程 → 拿到结果；**大脑能正确分解 + 调度 + 智能提问**（诉求 1、2 初步成立）。

### Phase 2 · 自省闭环（核心价值主张）· 横向优先
> **实测（2026-06-14）**：4 张 gpt-image-2 并行 = 墙钟 82s ≈ 单张（串行需 279s），4/4 成功无 429。**Gateway 真并发** → best-of-N 几乎不增延迟。另：1024×1024 ~50-82s，远快于 1536×1024 ~190s（画幅决定速度）。
- [ ] **best-of-N 并行生图（主力杠杆）**：`generate_booth_variants(prompt|prompts, n)` 内部 `Promise.all` 并行 N 张；inspect 也并行；静默择优交付。**横向抽奖优先于纵向重试。**
- [ ] DesignSpec 写作 + `update_spec`（存 project state，供 inspect 做"输出 vs spec"硬对比）
- [ ] `revise_asset`（gpt-image-2 编辑模式）作**窄回退**：仅对择优后仍存的客观硬伤定向修 ≤1 次
- [ ] 正式预算 `budget.ts`（替换 Phase 1 兜底）+ **并发上限 + 429 退避**；大脑按"分量"选 N 与画幅（概念 1-2@1024 ~60s；最终 4-6@1536 并行 + 择优）
- [ ] inspection rubric 完整化；system prompt v2
- **验收**：大脑能「写方案 → 并行 N 张 → 静默判图择优 → 必要时定向修 1 次 → 交付」自主跑完，且总延迟接近单张。

### Phase 3 · 多视图（单图 turnaround sheet）· 实测定型
> 实测（`scripts/multiview-spike.mjs`）：`images.edit` 图像条件化经 Gateway **404 不可用**；单图 sheet 一次渲染**天然一致**(Sonnet 72，胜分图)。故**弃 rhemax 全套锁定机制**（不再做 identity-spec 重注入/坐标锚图/失败重试/十几轮 subagent）。
- [ ] `render_multiview_sheet` 工具：best-of-N 出 2×2 turnaround sheet（前/左/右/俯视平面，**默认 high/1536，n≤2 并行**）→ Sonnet 判（同一展台 + 角度分明 + 平面合理）择优 → 交付。
- [ ] 重写 `src/knowledge/skills/multiview.md`：sheet prompt 模板（**强制角度分明 + 平面图**），删除锁定机制。
- [ ] 注册工具 + system-prompt 告知大脑何时用（用户要"多视角全貌"）；单张 money shot 仍走 hero best-of-N。
- [ ] （暂缓）per-角度独立高清重绘：用户满意 sheet 后再单独高清化。
- **验收**：一句"给我多视角全貌" → 大脑出一张四视角自洽的 sheet。

### Phase 4 · 产品骨架（隔离 + 用户可见层边界）· 据架构批评优化
> 走向产品的第一优先级不是加模型能力，而是**隔离 / 沉淀 / 边界**。以下都不依赖部署决定，现在就能做。
- [x] **ASR 语音输入**（Fun-ASR 直连 + DeepSeek V4 Flash 清理 + 录音前端）—— 已完成。
- [ ] **四概念落地**：project / session / run / asset 在存储与 URL 立住（`/projects/:projectId`、`/projects/:projectId/chat/:sessionId`）。温和版：进页面自动建 project、用户无感，点"新项目/历史"再显性化。storage 从 `DEFAULT_PROJECT` 改 projectId-keyed。
- [ ] **inspection 沉淀回 asset（修 bug）**：`generate_best_of_n`/`revise_asset` 判图结果写回 `Asset.inspections` + lineage(`parentId`)，否则 `read_project_state` 永远空、大脑丢记忆。
- [ ] **用户态 / 调试态 UI 分层**（解与"自检隐形"D8 的矛盾）：工作台 = ChatPanel(无原始工具日志) + SpecCard(当前方案,可确认/改) + AssetGallery(推荐/候选/修订/多视图) + ActionBar(继续深化/换风格/多视图/重生/下载/新项目)；DebugDrawer 仅开发模式露工具调用/评分/prompt。**用户级进度旁白**("正在整理方案/生成候选/筛选/修正结构")，不露评分。
- [ ] **用户选图=强信号**：选某候选"用这张继续"→ 后续围绕它，不自动改选 recommended。**重生(开分支) vs 改图(派生 parentId)** 语义在 UX 显性化。
- [ ] **薄代码级不变量（非 FSM）**：生图前必须有 spec、预算、用户选图锁定 等"必须项"写成工具前置条件(代码硬保证)；排序/判断仍归大脑。
- [ ] **轻并发安全**：per-project 原子写 / 写锁（不上 DB）。
- **验收**：多项目互不污染；用户只见两端 + 资产、工具过程进调试抽屉；选图被尊重；inspection 有记忆。

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
| **视觉自检的 UX 陷阱**（旧团队曾因此废弃 QC）| 自检**全程内部、对用户隐形**：预防(prompt 纪律)为主 + 静默 best-of-N 择优 + 仅客观硬伤触发隐形修复；**绝不向用户出报告或逼其二次操作**；客观缺陷自动处理、主观口味走自然对话；深度由大脑按分量自定。用 Sonnet 4.6 vision 提升判图可靠性。Phase 2 重点验证 |
| **成本放大**（Opus 全程 + 自主重试）| prepareStep 模型分层（自检走 Sonnet）；每资产 revise≤3 硬预算；预算让大脑看见 |
| **自由 → 乱跑/过度提问** | system prompt 给决策框架 + questioning rubric 约束提问数（≤3）；step 硬上限兜底 |
| **gpt-image-2 调用细节未定** | Phase 0 spike 先锁定（size/编辑/参考图/多图）再开发上层 |
| **gpt-image-2 vs 旧 nano 的 prompt 适配** | 五层架构/锚定表可复用；但 gpt-image-2 指令遵循/文字渲染更强，可更依赖显式指令，spike 校准 prompt 模式库 |
