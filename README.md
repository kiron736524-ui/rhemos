# Rhemos

展台设计 **Loop Agent**（rhemax v2）。用户只交需求，大脑自己 **澄清 → 写方案 → 并行生图 → 客观判图择优 → 必要时定向修 → 交付**。用户注意力只在两端（"我想要什么" / "这是不是我想要的"），中间复杂度由大脑吃掉。

> 单一大脑（Opus 4.8）+ 多工具；**控制流是大脑的推理，不是状态机**。自检对用户隐形。

## 现状
- ✅ **Phase 0** 接线 + 连通性 ｜ ✅ **Phase 1** 最小 Loop Agent（澄清 + 智能提问）｜ ✅ **Phase 2** best-of-N 自省闭环
- ⬜ **Phase 3** 一致性 subagent（多视图）｜ ⬜ **Phase 4** ASR / 持久化 / approval / 成本监控 / AI Elements

## 技术栈
Next.js 16 + React 19 + TypeScript + **AI SDK 6** + **Vercel AI Gateway**（模型唯一来源）。
脑 `anthropic/claude-opus-4.8` · 生图 `openai/gpt-image-2` · 判图 `anthropic/claude-sonnet-4.6` · ASR 阿里云百炼/DashScope（唯一非 Gateway，未接线）。

## 快速开始
```bash
# .env.local（已 gitignore）需要：
#   AI_GATEWAY_API_KEY=...   必需，路由所有模型
#   DASHSCOPE_API_KEY=...    接 ASR 才需要
npm install
npm run dev          # → http://localhost:3000
```
实测脚本（验证你的 key / 平台能力）：
```bash
node --env-file .env.local scripts/spike.mjs              # 三模型连通
node --env-file .env.local scripts/concurrency-spike.mjs  # Gateway 并发
node --env-file .env.local scripts/image-opts-spike.mjs   # 画质 / 流式实测
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
模型唯一经 Gateway（ASR 例外）· 自检对用户隐形 · 品牌无素材只占位 · `.env.local` / `.data/` 不入库 · 中文对话/注释/commit。
