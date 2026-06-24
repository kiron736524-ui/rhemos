# Rhemos — AI 接手须知

Rhemos = 展台设计 **Loop Agent**（rhemax v2，greenfield 重建）。用户只交需求，大脑（Opus 4.8）澄清 → 写方案(DesignSpec) → 并行生图(best-of-N) → 客观判图择优 → 必要时定向修 → 交付；自检对用户隐形。

**接手第一步：读 [`docs/AI-HANDOFF.md`](docs/AI-HANDOFF.md)**（冷启动导航 + 不变量 + 实测坑）。
为何这么设计 → [`docs/DECISIONS.md`](docs/DECISIONS.md)；架构全貌 → [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)；领域知识 → `src/knowledge/`。

## 硬约束（违反会出大问题）
- **模型多来源**（不再"唯一经 Gateway"，见 DECISIONS D29）：脑 / 判图 / 写 prompt / 语音清理 / Gemini fallback 经 **Vercel AI Gateway**；**gpt-image-2 经 fal.ai**（文生图 + 图编辑）；**ASR 经 DashScope 直连**。句柄 / 封装在 `src/models/gateway.ts` + `src/models/image-providers.ts`（生图 provider 层，多 provider 切换点）。
- **绝不提交** `.env.local` / `.data/`（已 gitignore；`.env.local` 含 `AI_GATEWAY_API_KEY` / `FAL_API_KEY` / `DASHSCOPE_API_KEY`）。
- **中文**对话 / 注释 / commit message；commit 末尾加 `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`。
- 改动后用 `npx tsc --noEmit -p tsconfig.json` 验证类型。
- **自检对用户隐形**——绝不给用户"半成品 + 改进报告"。

## 现状
Phase 0-4 + 三轮重大升级：**UI 颠覆**（暗色工程制图科技，rhemax 黑红蓝）· **卡片提问**（`present_choices` 可点卡片 + 俯视布局草图，零打字）· **工业级一致性**（identity 身份锁定 / 画风锚 / 进化式参考链 + 判图门控 / 平面图条件化生图）· **react-konva 布局编辑器**（拖拽 / 缩放 / L 形 → 截图喂生图）· **对话持久化**。可跑 `npm run dev`。生图：`gpt-image-2` 经 **fal.ai**（文生图 + 图编辑）+ 参考条件化 fallback `gemini-3-pro-image` 经 Gateway（D29）；快慢双模式 concept(medium/n1)/final(high/n2)；布局有最小规则引擎 `src/lib/booth-rules.ts`、brief 起步强类型 `BoothBrief`、判图 schema 维度化（D30）。Phase 5（DB/auth/成本/部署）见 `docs/engineering-plan.md`。
