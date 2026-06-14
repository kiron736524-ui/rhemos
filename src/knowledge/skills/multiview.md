---
skill: multiview
load: 生成多视角时（render_multiview / 一致性 subagent）
summary: 多视角=同一展台不同相机位；四件套锚点、跨视角一致约束、强制俯视坐标锚图、视角必须真的变。
source: 重组自旧 rhemax modifiers/multiview.md + multiview V2（identitySpec/cameraSpec）+ 相机规范 + M31/M32 教训
---

# 多视角一致性

**核心**：多视角不是"多生几张图"，而是"同一个展台从不同相机位置观看"。结构、尺度、品牌位置、灯光逻辑必须跨视角一致；不要把同一展台改造成另一个方案。

## 四件套锚点

1. **主图（事实锚点）**：始终作为第一张参考图，是视觉真值。
2. **identity spec（语义锚点）**：一份"跨视角不应变化的规格书"，列出 footprint/开口/墙位/结构件相对位置/Truss/板墙/接待台/房间/LED/产品区/材料表面/灯光方向色温/品牌(logo/slogan/文字/颜色/位置)，以及 **negative invariants**（不可新增/删除/移动/缩放/改色/换品牌/换风格的元素）。不臆造隐藏元素；不确定标 "uncertain"。
3. **camera spec（相机锚点）**：每个角度写死精确相机参数（统一 ~5m 距离、1.6m eye-level、35mm 等效），并纠正主图的 3/4 斜视。
4. **per-view 生成**：逐视角独立生成 / 失败 / 重试，不指望一次出全。

## 跨视角一致约束（每个 view prompt 都带）
- No floating / clipping / proportion distortion；所有支撑结构从每个角度都物理可信。
- Lighting consistent across all views（same direction, same color temperature）。
- Branding elements in correct positions from each viewpoint。
- 不在某视角添加或移除原方案中不存在/已存在的元素。
- 前置硬指令：`The master image is the anchor and must remain structurally identical. Only the camera viewpoint may change.`

## 强制俯视 = 坐标锚图（不是美化鸟瞰）
`top_down` 要求严格正交投影的 PLAN-ANCHOR：footprint 留 10-15% 边距，标 FRONT/BACK/LEFT/RIGHT 边标 + A/B/C/D 角标 + 编号地标；**canopy/truss 必须半透明(ghosted)**，让下方布局可读。各立面视角（front/left/right/back）要求"该立面主导画面，原正面只作薄边"。

## 视角必须真的变（防退化）
- 输出必须明显不同于主图（当请求角度不同时）；**不要输出主图的近似复制、裁切、缩放或轻修版**。
- 按 camera spec **把虚拟相机物理地绕展台中心移动**。

## 关键教训（旧 M32）
锚图（俯视坐标图）**只做方向/footprint/相对位置导航**；视觉真值永远是"主图 + identity lock"。**别让锚图覆盖原图布局**，否则模型把锚点当几何主图导致结构漂移。失败重试时可把前几次失败图作为"错误样本/方向示例"喂回，但禁止继承其结构漂移。

> 这类多轮 inspect+revise 的活交给独立的"一致性 subagent"在自己的小循环里跑完，主脑只接收"已交付 N 张一致的图"的结论。
