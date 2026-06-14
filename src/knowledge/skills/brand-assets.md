---
skill: brand-assets
load: 触及 品牌名称/slogan/Logo/关键图标/KV/品牌落位 时（几乎所有方案都涉及）
summary: 品牌资产是结构性信息不是装饰；缺素材只占位不臆造；落位策略；英文占位词典（生图用）。
source: 重组自旧 rhemax domain/design-method.md(品牌落位) + tasks/design-dialogue.md(品牌资产保护) + tasks/prompt-craft.md(占位规则)
---

# 品牌资产：结构性信息，不是装饰小细节

品牌名称、slogan/标语、Logo/关键图标决定主视觉墙、顶部、接待台、LED、导视系统**到底展示什么内容**。不确认会导致方案只有"品牌区"空壳。所以它们**不属于普通 Optional**——至少要确认，或显式占位。

## 红线：缺素材只占位，绝不臆造

无论信息多完整，以下内容**不能作为生图的精确生成目标**（模型会生成乱码/失真）：
- LOGO 具体图形 → 用"品牌标识区域"占位
- 品牌 slogan → 用"品牌信息展示面"占位
- KV 主视觉 → 用"主视觉展示区"占位
- 包装文字 → 用"产品展示区"占位

在 prompt 中只标注**位置和发光方式**，具体内容由后期贴图/产品层叠加。
若用户提供了 Logo/关键图标素材，先确认它主要用于哪里：顶部远距离识别 / 主视觉墙大面积展示 / 接待台近距离转化 / 导视多点分布 / LED·KV 主画面。

## 落位策略（给用户可点选方向）

- **主视觉墙**：大面积品牌展示 + slogan 展示带。
- **顶部/门头**：远距离识别（发光字朝主通道）。
- **接待台**：近距离转化（小 logo，主次低于主墙）。
- **LED/KV**：作为核心墙的动态品牌内容。
- **多点导视**：门头、接待、导视面重复小标记，但要有一面主导品牌墙避免杂乱。
- **slogan 不应在所有位置重复堆满**：常规是主视觉墙或 LED 放完整标语，顶部和接待台只放品牌名/Logo，导视用小型重复标记。

## 英文占位词典（生图 prompt 用）

统一占位符，不写具体品牌文字、不复刻精确 logo 几何：
- `brand logo illuminated signage` — 发光字位置
- `brand identity display zone` — 品牌信息展示面
- `slogan display band` — slogan/标语展示带
- `key logo icon area` — 关键 logo 图标区域
- `product showcase area` — 产品展示区
- `key visual display panel` — KV 主视觉区

落位英文写法示例：
- 主视觉墙：`large brand identity display zone on the back wall, with a reserved slogan display band below the logo area`
- 顶部/门头：`brand logo illuminated signage integrated into the overhead header, facing the main aisle for long-distance recognition`
- 接待台：`small logo mark on the reception counter front, for close-range conversion, secondary to the main wall`
- 多点导视：`repeated small brand markers on header, reception, and wayfinding panels, with one dominant brand wall to avoid visual clutter`

用户提供具体品牌名/slogan 时，中文方案可记录原文；英文 prompt 仍优先用占位描述，避免乱码。
