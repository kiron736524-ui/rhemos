# Rhemos 领域知识层方案（v0.1 · 待批准）

> 这是大脑的"灵魂"。配套：[`../rhemos-build-plan.md`](../rhemos-build-plan.md)（策略）、[`./engineering-plan.md`](./engineering-plan.md)（工程）。
> 本文把旧 rhemax 挖出的领域知识，按新 Loop Agent 体系**重组**为四件套，并给出未尽部分的完成计划。
> 素材来源：旧 rhemax `src/lib/skills/content/*.md`、`docs/dialogue-system.md`、`过程提示词和图标/`。
> 当前实现以 [`DECISIONS.md`](DECISIONS.md) D34 为准：首稿默认两张 candidate-set 候选，由用户选择基准图；生成后判图/一致性检查不是默认链路，只在用户要求 AI 诊断、筛选或修正时启用。

---

## 0. 核心判断（先看这个）

挖完 rhemax 后的三条结论，决定了重组方式：

1. **领域知识是真资产，调度机器是负债。** 旧 rhemax 的大脑是一套结构精良的 Markdown skill（人设/必须确认清单/行业默认值表/设计方法论/Truss专题/五层Prompt/尺寸锚定表/风格库）——这些是 15 年会展经验的固化，**应保留并精炼**。要扔的是包在外面的 FSM + stage-contract + blockingField 受控词表 + 写死的 recovery 问题卡 —— 这些"逼着大脑按格子走"的机器，正是你反对的"死板模板"。

2. **检查必须前移，生成后诊断按需启用。** 旧 `quality-check.ts` 在 2026-04 被废，根因不是"检查质量"错了，而是它把"半成品 + 改进报告"丢给用户、逼用户再点一次。当前架构保留生成前专业检查，但默认首稿交给用户选基准图，生成后 AI 判图/一致性检查只在用户明确要求时启用。三层落实（优先级从高到低）：
   - **① 预防（主力）**：大脑生图前把领域规则 + 锚定表 + 自检维度当成"写 prompt 的纪律清单"跑一遍，让第一张就对（= 旧团队"自检前移"的硬道理，零延迟零打扰）。
   - **② 首稿候选（默认）**：并行生两张 candidate-set，交给用户选基准图；候选未选中前不进入资产库。
   - **③ 按需诊断/修复**：用户明确要求 AI 帮忙判断、筛选、一致性检查或修正时，才启用 `autoCheck` 或 `revise_asset`。
   - **红线**：分清**客观缺陷**（可诊断/修正）与**主观口味**（走自然对话迭代）。单次失败不自动扩展成多轮重试或多视角链路。

3. **重组的本质 = 知识不变、调用方式变。** 旧：知识被 FSM mode 条件注入、被 blockingField 锁死、被 recovery 模板兜底。新：知识作为大脑**推理的参考**；两个 rubric 是大脑**内部的 gap 分析 / 判图工具**（不是照着念的脚本）；大脑自主决定何时问、问什么、何时生、如何纠。

---

## 1. 新知识层架构（四件套）

| 件 | 是什么 | 由旧什么重组而来 | 大脑怎么用 |
|---|---|---|---|
| ① System Prompt | 决策框架 + 人设 | `core/director-persona.md` | 定义大脑是谁、怎么判断——给原则不给台词 |
| ② Skills | 领域知识模块（.md）| `domain/*.md` + `nano/booth-fundamentals.md` | 推理时的领域参考（动线/结构/材料/Truss…）|
| ③ 两个 Rubric | 提问完备度 / 生图自检（结构化）| `design-dialogue.md` 必问清单+终检10块 / `result-review.md`+`prompt-craft` checklist+废弃QC | 内部 gap 分析与判图工具 |
| ④ Prompt 模式库 | 五层架构 + 两张表 + 风格库 | `tasks/prompt-craft.md` + `nano/styles/*` | 写 DesignSpec 与生图 prompt 的方法 |

---

## 2. System Prompt 草案（新人设 + 决策框架）

**重写原则**：旧 persona 有一张"阶段导航表 + 阶段不能跳跃"的硬约束（那是 FSM 的提示词投影），**删掉**。保留人设、判断力、纪律，把"该做什么"交回大脑推理。

草案要点（执行时细化为完整文本）：

- **身份**：你是 Rhemos，资深展台设计导演，15 年以上会展工程经验。你的判断来自真实展览工程，不是空泛美学。
- **能力边界**（保留旧的"只做"清单）：收集需求、输出方案、确认交接、写生图 spec、编译 prompt、指导编辑、生成多视角。不做：平面/LOGO/文案/报价/施工图。
- **工作信条（替代旧 FSM）**：
  - 你**自己判断**当前该澄清、该出方案、还是该生图——依据是"信息是否足以对结果负责"，不是固定阶段。
  - **先收敛到可推进的结构，再推进**；不无限追问，也不在关键约束缺失时盲目硬编。
  - **生成后先让用户选基准**：首稿 `candidate-set` 是正常交互；只有用户要求诊断/修正时，才调用判图或 `revise_asset`。
  - **预算自觉**：每个资产的修复预算 3 次；接近上限时权衡是否诚实告知"做不到，建议调整为…"。
- **语气**（保留旧的）：中文回复（英文 prompt 除外）；专业不冷漠、简洁不敷衍；不用"好的，让我来帮您…"的服务员开头，直接进入设计判断。
- **委托信号**（保留）：用户说"你帮我决定/别问了/你来吧"→ 停止追问、用行业默认值推进；但顶部/Truss、产品摆放、动线、关键功能取舍仍要显式呈现（确认卡），不静默默认。
- **响应纪律**（保留 `response-discipline.md`）：服从输出格式；不自创字段；不输出思考过程/协议说明。

---

## 3. 提问完备度 Rubric（重组自 必须确认清单 + blockingField + 终检10块）

**用法（关键）**：这不是问题脚本，是大脑的**内部 gap 分析表**。每轮 `read_project_state` 后，大脑对照本表判断"一个专业设计师此刻最该补哪条"，**只问最高价值的 1-3 个缺口**。

### 3.1 完备度字段词典（= 强类型 Brief 的字段，来自旧 blockingField）
分三组（与 §engineering-plan 的 `BoothBrief` 对应）：

**空间硬约束**
- `footprint` 面积（长×宽，**必须保留长/短边语义**，如"12m 长边 × 6m 短边"，不要只写 72㎡）
- `openSides` 开口方式（一/两/三/四面开）
- `openingRelation` 两面开是**相邻直角** vs **相对平行**
- `backWall` 三面/一面开时背墙靠**长边还是短边**
- `mainAisle` 主通道方向（多开放边时定品牌主视觉/接待台/首图视角）
- `heightLimit` 限高

**高度体系**
- `height.includesTruss` "6m"是否含 Truss（极易混淆，必问）
- `mainWall` 主体板墙高：国内默认 4.4m / 国外 4.0m
- 封闭会议室贴主墙时是否与主墙齐平（齐平 4.0-4.4m vs 矮隔断 2.5-2.8m）

**顶部结构**
- `top.strategy` 无顶 / 局部门头 / 落地 Truss / 吊装 Truss
- `top.centerForm` 中部造型：开放空心/环形/方形灯框/条形灯阵/软膜天幕/几何模块/**场景化主题**
- `top.suspensionApproved` 吊装须有吊点；无吊点不得写成确定吊装

**核心目的与内容**
- `purpose` 品牌形象/产品展示/新品发布/招商洽谈/体验互动（各绑不同功能区）
- `products` 展品类型/数量/体量/载体/**观看距离**/摆放（集中/分散/演示优先）
- `circulation` 功能区（接待/洽谈/储物/会议/产品）+ 它们之间的**顺序**

**品牌资产（红线：缺失只占位、不臆造）**
- `brand.name` / `brand.slogan` / `brand.logo`（须确认是否有素材）
- `brand.placement` 落位：主入口门头/背景墙/Truss 边梁/接待台/LED/多点导视

**视觉方向**
- `style.tone` 调性 + `style.primaryColor`/`secondaryColor`（每个最终 prompt 都要明确主/辅色）
- `material.budgetTier` 预算（一级约束）+ `palette` 主材（最多 3 种）+ `lighting` 灯光三层与色温

### 3.2 依赖式提问（条件触发，旧"Conditional Must-Confirm"）
这是"智能识别"的精华——某答案触发联动才追问：
- 面积≤36㎡ + 多功能 → 追功能区**优先级排序**
- 提到 LED 主屏 → 追尺寸与安装（内嵌墙体厚~80cm + 维护空间）
- 提到洽谈区/VIP → 追封闭程度与人数（封闭外墙≥2.5m）
- 说"6m 高" → 追是否含 Truss
- 选 Truss 顶部 → 追支撑方式（柱撑 vs 吊装）
- 大跨度门头/大屏 → 后台**自动**套跨度安全（木≤6m、桁架≤9m），不作偏好问用户

### 3.3 提问设计原则（保留旧的，作为大脑提问的硬纪律）
- 一次 ≤3 问，每问 2-4 个**具体可视化**选项，**绝不开放式**；不生成"其他/自定义"（前端自动追加自由输入）。
- 选项要**视觉化 + 常识锚定 + 说明代价**。范例（可复用）：
  - 风格："A. 暗场+重点照明+金属玻璃（像索尼/奔驰展台）B. 白色为主+柔和漫射光+干净几何体块（像苹果零售店）C. 暖色木饰面+柔光+高端商务（像五星酒店大堂）D. 通透玻璃+开放流线（像高端办公）"
  - 面积："A. 小型（6×6m，约一间教室）B. 中型（9×6m，约一个大客厅）C. 大型（12×9m，约半个篮球场）"
  - 洽谈区（说明空间代价）："A. 4人紧凑（一桌四椅，约占1/12，半封闭）B. 6-8人标准（约1/8）C. 10人+（约1/6，需全封闭）D. 不需要"
- 已问已答的不重复；已问被忽略的视为不在意、转默认值。

### 3.4 行业默认值表（领域事实，可自动填充但须 disclosure）
| 条目 | 默认值 | 依据 |
|---|---|---|
| 地面 | 地台10cm + 地板/地毯 | 藏电子设备走线 |
| 主体板墙高 | 国内~4.4m / 国外~4.0m | **非含 Truss 总高** |
| 含 Truss 总高 | ~5-6m | 6m 常指含 Truss/吊牌/灯架/门头 |
| 接待台 | 90cm 高、深45cm | 人体工学 |
| 展柜 | 75-100cm 高 | 视线高度 |
| 墙体厚 | ~10cm；LED 墙 ~80cm | 含检修通道 |
| 洽谈区外墙 | 半封闭2.5-2.8m；贴主墙则齐平4.0-4.4m | 隔音/立面连续 |
| 灯光色温 | 冷白5000-5500K(科技)/暖白3000-3500K(商务) | 行业惯例 |
| 画面视角 | Three-quarter wide-angle | 商业效果图标准 |

### 3.5 "可以出方案了吗"终检（旧 Prompt 10 信息块）
1-10 必须到位，才算信息足以写 DesignSpec：① 空间类型与展台属性 ② 高度体系 ③ 顶部结构 ④ 顶部中部造型 ⑤ 主体分区(3-4功能区) ⑥ 产品摆放与动线 ⑦ 品牌资产与落位 ⑧ 主视觉面 ⑨ 风格定性 ⑩ 色彩关系。（材料/灯光/镜头可自动填充；跨度安全永远后台自校正。）

---

## 4. 生图检查 Rubric（重组自 result-review + prompt-craft checklist + 废弃QC维度）

**三种用法（见 §0 判断 2）**：同一套维度，大脑在三个时机用——
1. **生成前 · prompt 纪律清单**（主力）：写 prompt 时逐维度自查，预防胜于纠正，零延迟零打扰。
2. **生成后 · 用户选择**：默认两张 candidate-set，由用户选基准图。
3. **按需诊断/修复**：用户要求 AI 帮忙判断、筛选或修正时，才启用 `autoCheck` / `revise_asset`。

判图永远是 **"输出 vs DesignSpec" 的客观对比**，返回 `{维度, pass/warning/fail, evidence}`。下列维度均为**客观可判**项（主观口味不在此列）：

**结构与物理可信（fail 级，最高优先）**
1. 无悬浮结构；屏/桁架/顶棚/吊牌都有物理支撑
2. 无穿插、无裁切主结构、无比例失真
3. 跨度规则：木≤6m、桁架≤9m 无中支撑；未知吊点不画成吊装
4. LED/大屏有承重墙体与维护空间；电子区有地台走线

**空间与动线**
5. 开口方式/背墙方位/主通道方向正确
6. 入口-接待-主视觉-产品-洽谈-储物 可走通、无死角拥堵
7. 会议室尺度与容量匹配；贴主墙时齐高
8. 产品有清晰载体/尺度/观看距离/演示空间，未被遮挡

**一致性（多视图专用）**
9. 跨视角 结构/尺度/材质/色彩/灯光 统一（同材质表、同色温、同灯光氛围）
10. 品牌位置跨视角一致
11. 视角确实变了（非主图近似复制/裁切/微调）；侧视图侧立面主导画面
12. 俯视图是**正交坐标图**而非美化鸟瞰；canopy/truss 在俯视图中半透明不挡内部

**材质/灯光/品牌/渲染纯净度**
13. 材质是真实展览材料 + 带表面处理；灯具有真实来源、基础/重点/氛围三层、色温明确
14. 品牌识别朝主通道、主次清晰、占位而非乱码、logo 不失真
15. 无文字乱码、无重复屏幕、无人物喧宾夺主、背景不喧闹、photorealistic 商业可信
16. 输出尺寸/宽高比与请求一致（编辑场景尤其：不裁/不缩/不变比例）

> **预防为主、用户选择优先**：同一套维度在"生成前"作为 prompt 纪律清单（主力、零延迟），在"生成后"作为按需诊断/修复工具。首稿默认交给用户选择基准图。

---

## 5. Prompt 模式库（重组自 prompt-craft.md）

### 5.1 五层架构（写 prompt 的骨架，不可打乱）
1. **全局声明**：一句锁定 输出格式/行业语境/视觉基调/场景环境 + footprint(长×短边) + 开口方位 + 高度体系 + 品牌系统 + 风格2-3词 + 主辅点缀色 + 展馆背景
2. **顶部结构**：有无顶/支撑方式/框架材质形态/中部造型/灯光位置/logo 位置/装饰
3. **主体展区（核心）**：从固定视角按空间位置**叙事**（非物品清单），每区四要素=位置/尺寸/载体/效果
4. **地面与灯光**：base/focused/linear 三层 + **必带色温**
5. **渲染指令**：分辨率 + 材质质感词 + 细节清晰度 + 镜头视角

### 5.2 相对尺寸锚定表（工程数字 → 视觉比例，关键技巧）
模型不懂绝对数字、只懂常识比例：
| 工程值 | Prompt 描述 |
|---|---|
| 展柜 75-100cm | display cabinets at waist-to-hip height |
| 接待台 90cm | reception counter at about chest height |
| 板墙 4.0-4.4m | walls rising to ~twice the height of a standing person |
| LED 墙厚 80cm | a deep housing, thick enough to walk behind for maintenance |
| Truss 5-6m | overhead truss ~2.5× human height |
| 大 LED(≥6㎡) | a large video wall spanning most of the back wall |

### 5.3 视觉词汇精确度表（模糊 → 精确，铁律）
颜色永远带修饰词、材质永远带表面处理、灯光永远带色温+方向、风格永远落到空间特征：
blue→technology/ice/gradient blue；wall→pure white matte structural wall；glass→frosted glass partition；lighting→cool white (5000K) recessed spots；modern→sleek geometric clean intersecting planes；high-end→matte black powder-coated steel + brushed aluminum；wood→warm oak-toned veneer。

### 5.4 五个命名风格（风格库种子，每个一句英文 emphasis）
clean-tech / hard-tech / transparent-fusion / premium-warm / immersive-dark（原文见旧 `nano/styles/*.md`，可直接搬）。

### 5.5 负向约束（旧无独立 negative 字段，以约束句形式）
No floating structures / no clipping / no proportion distortion / all supports physically plausible / photorealistic；避免：不像展台（像零售店/舞台/住宅）、透视失衡、文字乱码、品牌失真、人物喧宾夺主、无支撑结构。

> **gpt-image-2 适配（Phase 0 校准）**：gpt-image-2 指令遵循与**文字渲染**远强于旧 nano/gemini——意味着可更依赖显式指令、品牌文字可更大胆（但仍遵守"无素材只占位"红线）。五层架构与两张表先沿用，spike 时按 gpt-image-2 实际表现校准。

---

## 6. DesignSpec（"成熟方案"产物）
大脑在生图前写出的结构化方案，**一物多用**：给用户看的中文方案（narrative）、生图 prompt 来源、外轮廓硬规则（footprint）、跨视图不变量（invariants）与按需诊断基准（selfCheckCriteria）。结构见 engineering-plan §4.2 与 DECISIONS D34。

---

## 7. 多视图一致性（重组自 multiview V2 + 相机规范）
交给一致性 subagent，机制保留：
- **四件套锚点**：主图（事实锚点）+ `identitySpec`（语义锚点：跨视角不变量 12 条）+ `cameraSpec`（相机锚点：5m 距、1.6m eye-level、35mm，每视角精确参数）+ per-view 独立生成/失败/重试。
- **强制俯视坐标锚图**：不是美化鸟瞰，是正交投影 PLAN-ANCHOR，标 FRONT/BACK/LEFT/RIGHT + 角标 + 编号地标，canopy/truss 半透明。
- **核心教训（旧 M32）**：锚点只做方向/footprint/相对位置导航，**视觉真值永远是主图 + identity lock**；别让锚图"覆盖"原图布局导致漂移。
- 参考图顺序硬协议：`Reference image #N = [角色]`，禁止按文件名/相似度重排。

---

## 8. 完成状态与剩余精修

✅ **option 1 已完成**：本文的结构 + 核心内容已**落地为 `src/knowledge/` 下的 12 个 skill + 2 个 rubric + README**（旧 skill 逐字精炼 + 去 FSM/stage-contract/blockingField 调度机器 + 自检按"隐形监督"重写）。完整清单与大脑加载约定见 [`../src/knowledge/README.md`](../src/knowledge/README.md)。

剩余精修（建议在 Phase 0-2 配合进行）：
2. **并入 `过程提示词和图标/` 资产**：`展台设计基础规则.txt`（194行领域规范）、`展台设计提示词.docx`、`提示词1/2.txt` 与旧 skill 交叉补全；高清参考图与 gallery-minimal "thinking" 视觉留作 UI/参考素材。
3. **挖回废弃的视觉 QC 维度**：`quality-check.ts` 的真实实现藏在旧 git 提交（`b412067`→`1a11138`→`868e9a4`），挖出当年它想检的项，补进 §4 自检 rubric。
4. **Phase 0 校准 gpt-image-2**：用真实生图验证并微调 §5 的五层架构、两张表、负向约束、风格库。
5. **把 rubric 落成代码**：§3/§4 转成 `knowledge/rubrics/{questioning,inspection}.ts` 的结构化数据 + `knowledge/prompt-patterns.ts`。

> 原则不变：**保留领域事实，丢弃调度机器；知识作大脑的参考与判图工具，而非锁死它的脚本。**
