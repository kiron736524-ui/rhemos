# Rhemos · AI 冷启动导航

读完这一篇 + 它指向的链接，你就能全知识冷启动、抓住每个关键决策点。

## 心智模型（30 秒）
单一大脑（Opus 4.8）+ 多工具的 **Loop Agent**。**控制流 = 大脑的推理，不是状态机。** 用户只看两端（说需求 / 拿结果）；中间：澄清 → 写 DesignSpec → 并行生图(best-of-N) → 客观判图择优 → 必要时定向修 → 交付，全由大脑自主，自检对用户隐形。旧 rhemax 的 FSM + 模板被**刻意丢弃**（见 [DECISIONS](DECISIONS.md) D7）。

## 60 秒定位：想改 X → 去看 Y
| 想做什么 | 去哪 |
|---|---|
| 换模型 / 模型句柄 | `src/models/gateway.ts` |
| 改大脑行为 / 工作循环 / 铁律 | `src/agent/system-prompt.ts`（PREAMBLE）|
| 改领域知识（提问/判图/生图法/展台规则）| `src/knowledge/skills/*` + `src/knowledge/rubrics/*`（见 `src/knowledge/README.md`）|
| 加 / 改工具 | `src/tools/*.ts` → 注册在 `src/agent/orchestrator.ts` |
| 循环退出 / 生图预算 | `src/agent/orchestrator.ts`（`stopWhen` / `imageBudget`）|
| 判图逻辑（结构化打分）| `src/agent/inspect.ts` |
| 存储 / 数据形状 / 项目列表 | `src/lib/storage.ts`（projectId-keyed + 写锁 + `listProjects`/`deleteProject`）+ `src/lib/types.ts` |
| API 入口 | `src/app/api/agent/route.ts`（tool 入参兜底 + 附件预处理）；图片读出 `assets/[id]`；项目列表/删除 `projects/` + `projects/[id]`；项目状态 `projects/[id]/state`；语音 `asr` |
| 上传附件提取（docx→文字+内嵌图 / xlsx→CSV）| `src/lib/attachments.ts`（mammoth / SheetJS）|
| 语音输入 ASR | `src/lib/asr/{funasr,cleanup}.ts` + `src/components/VoiceInputButton.tsx` |
| 前端工作台（三栏）| `src/app/projects/[projectId]/page.tsx`（项目面板 / 对话 / 画廊 / 上传 / lightbox）；`src/app/page.tsx` 仅 redirect→default |
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

## 现状
Phase 0-4 完成并实测：Phase 0 接线 · Phase 1 最小 Loop Agent（澄清+智能提问）· Phase 2 best-of-N 自省闭环 · Phase 3 多视图 turnaround sheet · Phase 4 产品骨架（projectId 隔离 / 三栏工作台 / 多模态上传 / ASR 语音 / inspection 沉淀回 asset / per-project 写锁）。Phase 5（生产化：DB / auth / 成本核算 / 部署 / 长任务队列）未做，见 `engineering-plan.md`。

## 深入阅读顺序
`docs/ARCHITECTURE.md`（如何建）→ `docs/DECISIONS.md`（为何这么定）→ `docs/engineering-plan.md`（路线图）→ `docs/domain-knowledge.md` + `src/knowledge/README.md`（领域知识层）→ `rhemos-build-plan.md`（最初策略基线）。
