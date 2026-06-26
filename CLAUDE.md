# Rhemos — AI 接手须知

Rhemos = 展台设计 **Loop Agent**（rhemax v2，greenfield 重建）。**用户深度参与、但省心省力**：大脑（默认 Sonnet 4.6，可配置升 Opus）澄清需求 → 写方案(DesignSpec) → 推俯视布局让用户确认/跳过 → 出首稿候选 → 用户点选基准图 → 按需多视角/局部精修 → 交付。判图/打分已删除（D39），选择权交还用户；多视角靠**进化式参考链**保持一致。

**接手第一步：读 [`docs/AI-HANDOFF.md`](docs/AI-HANDOFF.md)**（冷启动导航 + 不变量 + 实测坑）。
为何这么设计 → [`docs/DECISIONS.md`](docs/DECISIONS.md)；架构全貌 → [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)；领域知识 → `src/knowledge/`。

## 硬约束（违反会出大问题）
- **模型多来源**（不再"唯一经 Gateway"，见 DECISIONS D29/D39）：脑 / 写 prompt / 成本估算 / 语音清理 经 **Vercel AI Gateway**；**gpt-image-2 经 fal.ai**（**唯一指定生图模型 + 唯一渠道**，文生图 + 图编辑，D39 锁定，不再有 Gemini fallback）；**ASR 经 DashScope 直连**。句柄 / 封装在 `src/models/gateway.ts` + `src/models/image-providers.ts`（fal 锁定的薄封装）；几何统一在 `src/lib/geometry.ts`。
- **绝不提交** `.env.local` / `.data/`（已 gitignore；`.env.local` 含 `AI_GATEWAY_API_KEY` / `FAL_API_KEY` / `DASHSCOPE_API_KEY`）。
- **中文**对话 / 注释 / commit message；commit 末尾加 `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`。
- 改动后用 `npx tsc --noEmit -p tsconfig.json` 验证类型。
- **用户在环、省心省力**：默认出首稿候选让用户选基准，不自动判图 / 不自动批量出图（判图打分已删，D39）；但也别把内部协议黑话 / 技术细节抛给用户。

## 现状
Phase 0-4 + 架构收敛 D39：**UI 颠覆**（暗色工程制图科技，rhemax 黑红蓝）· **卡片提问**（`present_choices` 可点卡片 + 俯视布局草图，零打字）· **用户在环一致性**（identity 身份锁定 / 画风锚 / **进化式参考链·无门控** / 平面图条件化生图 / Rhemos CAD v1 布局硬锁）· **react-konva 布局编辑器**（拖拽 / 缩放 / L 形 → 截图喂生图）· **首稿候选 + 用户选基准** · **对话持久化 + 附件资产化 + 成本估算**。可跑 `npm run dev`。生图：**唯一 `gpt-image-2` 经 fal.ai**（文生图 + 图编辑，D39 锁定，无 Gemini fallback）；快慢双模式 concept/final 均默认 medium（`DEFAULT_IMAGE_QUALITY`）；几何单一来源 `src/lib/geometry.ts`、规则引擎 `src/lib/booth-rules.ts`、footprint 硬规则 `cad.buildFootprintLock`、render 拆分 `src/tools/render/*`、brief 强类型 `BoothBrief`。判图/打分已删除（D39）。Phase 5（DB/auth/成本/部署）见 `docs/engineering-plan.md`。
