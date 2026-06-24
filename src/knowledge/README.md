# Rhemos 知识层（大脑的灵魂）

这是 Loop Agent 大脑的领域知识与判断框架。**重组自旧 rhemax 的 `src/lib/skills/content/*.md`**，原则：**保留领域事实，丢弃 FSM/stage-contract/blockingField 那套"逼大脑按格子走"的调度机器**；知识作为大脑推理的参考、rubric 作为大脑的 gap 分析与判图工具，而不是锁死它的脚本。

详见方案文档：[`../../docs/domain-knowledge.md`](../../docs/domain-knowledge.md)。

## 结构

```
knowledge/
├─ skills/                      # 领域知识模块（大脑推理时按需加载）
│  ├─ persona.md                # 始终加载：人设 + 决策信条 + 对话/响应纪律
│  ├─ booth-fundamentals.md     # 始终加载：展台物理基本盘(英) + 工程值→视觉比例锚定
│  ├─ space-opening-circulation.md  # 开口→骨架、方位、动线、面积↔功能区
│  ├─ height-structure-truss.md     # 高度体系、跨度硬规则、顶部Truss两轮+中部造型
│  ├─ design-method.md          # 先骨架后填充、一个主角、材质家族、灯光三层、三色
│  ├─ materials-lighting.md     # 材料工艺术语词典 + 预算工艺
│  ├─ brand-assets.md           # 品牌资产红线 + 落位 + 英文占位词典
│  ├─ industry-heuristics.md    # 行业气质 + 预算约束 + 冲突转译
│  ├─ styles.md                 # 5 风格库（生图注入）
│  ├─ prompt-craft.md           # 生图 prompt 五层架构 + 两张表 + 批次/负向
│  ├─ prompt-examples.md        # 生图 prompt few-shot 范例（实战英文展台 prompt）
│  ├─ reference-and-editing.md  # 参考图/附件理解 + 语义/蒙版编辑
│  └─ multiview.md              # 多视角一致性（用户选基准图 + 参考条件化；每视角单视角全幅，非四宫格 sheet）
└─ rubrics/
   ├─ questioning.md            # 提问完备度（gap 分析表，非脚本）
   └─ inspection.md             # 生图检查（生成前预防为主；生成后诊断按需启用）
```

## 大脑怎么用（约定）

- **始终加载**：`persona` + `booth-fundamentals`（人设与物理底线）。
- **按需加载**（`prepareStep` 按上下文关键词选，省 token）：触及空间→`space-opening-circulation`；触及高度/顶部→`height-structure-truss`；写方案→`design-method` + `rubrics/questioning`；写 prompt→`prompt-craft` + `styles` + `brand-assets`；有参考图/改图→`reference-and-editing`；多视角→`multiview`。
- **两个 rubric 是判断工具不是台词**：`questioning` 用于"此刻该问什么"的 gap 分析；`inspection` 默认用于"生成前自律"，生成后 AI 诊断/筛选/修复只在用户明确要求时启用。

## 完成计划（待后续精修）

当前文件已把旧知识**逐字精炼 + 去 FSM 重组**到位，可直接喂给大脑。后续在 Phase 1-2 配合：
1. **Phase 0 用真实 gpt-image-2 校准** `prompt-craft` 的五层架构、两张表、负向约束、风格库（gpt-image-2 指令遵循/文字渲染更强，可调整依赖显式指令的程度）。
2. ✅ **已并入 `过程提示词和图标/` 文本资产**：`展台设计基础规则.txt` 增量（6大系统/地面4类/墙体加厚/无顶补偿/柜体与大件产品/双层/禁止模式）→ 对应 skill + `rubrics/inspection`；`展台设计提示词.docx` 的 15 个实战英文 prompt → `skills/prompt-examples.md`；`提示词1.txt` 安全边界 → `persona`、输出偏好 → `questioning`。未并入：`提示词2.txt`（中文编译器，gpt-image-2 用英文更稳）；图片（参考图/thinking 视觉/截图）留作 Phase 0 UI/测试素材，未拷入。⚠️ `rhemax-260415-*.json` 是旧 Vertex 服务账号私钥，未带入，**建议你去 GCP 轮换/删除**。
3. **挖回废弃的视觉 QC 维度**：旧 `quality-check.ts` 真实实现在 git 提交 `b412067`→`1a11138`→`868e9a4`，挖出当年判图项补进 `rubrics/inspection`。
4. **rubric 落成代码**：把 `questioning` / `inspection` 转成结构化数据（`*.ts`），`prompt-craft` 的两张表转成可复用常量，供工具与 `prepareStep` 调用。
5. **强类型 Brief**：用 `questioning` 的字段词典生成 `BoothBrief` 类型（见 `docs/engineering-plan.md` §4.1）。
6. **专家技法补充**：`design-method` 预留了"专家补充区"，可随真实项目经验追加（场景/做法/原因 三段式）。

> 原则不变：保留领域事实，丢弃调度机器；知识是大脑的参考与判图工具，不是锁死它的脚本。
