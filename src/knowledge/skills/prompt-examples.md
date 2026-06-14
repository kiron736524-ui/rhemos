---
skill: prompt-examples
load: 写生图 prompt 时，与 prompt-craft 一起作 few-shot 参考
summary: 旧 rhemax 实战英文展台 prompt 范例，示范五层架构的真实密度与结构。
source: 旧 rhemax 过程提示词和图标/展台设计提示词.docx（15 例，演示品牌"远航/YUANHANG/YH"——生产中按 brand-assets 改占位符）
---

# 生图 Prompt 范例（few-shot）

下面是实战英文展台 prompt 范例。**模仿其密度与结构，不要照抄内容**——行业/风格/颜色随方案变。注意：范例里的 `YUANHANG / YH / 具体 slogan` 是演示品牌，**生产中改为占位符**（`brand identity display zone` / `slogan display band` 等，见 `brand-assets`），不让模型精确生成文字。

## 范例 A · 电子科技（落地 Truss + 蓝白科技）

> 3D rendering image of the exhibition booth at an electronic technology exhibition. The overall style is futuristic industrial style, with the main colors being pure white, technology blue, and deep black. The background is a pure black exhibition space:
> - Top structure: Black metal truss frame, with black-and-white diagonal decorative strips embedded along the outer edge and white illuminated light strips in the center; a suspended double-layer gradient-blue circular illuminated device combined with a floating blue tech light box, simulating data flow and signal transmission; brand logo placement on top and sides facing the aisle.
> - Main booth:
>   1. Central core area: Reception desk with brand mark, behind it a gradient-blue background wall embedding a large high-definition display playing dynamic space/technology footage, central blue data-flow light effect.
>   2. Left brand area: Pure white raised wall with brand identity zone, blue vertical decorative strips and small displays showing application scenarios; an interior white negotiation sofa forms a private space.
>   3. Right display area: White circular illuminated frame embedding a display, with a reserved slogan band, combined with a reception desk forming an open experience area.
>   4. Detail elements: a few business visitors interacting; clothing fits the tech-exhibition scene.

## 范例 B · 营养健康（吊装白色平顶 + 浅蓝/木色商务）

> 3D rendering image of the exhibition booth for a nutritional health products exhibition. The overall style is fresh and simple business style. The main colors are pure white, light blue, and wood tone. The background is a pure black hall:
> - Top structure: Suspended pure white rounded flat roof, edges embedded with a light-blue gradient strip, front carrying a bold deep-blue brand logo zone; three gradient light-blue columns on the right enhance visual hierarchy.
> - Main booth:
>   1. Central core area: Light-blue background wall with a reserved slogan display band, combined with a light-blue storage rack displaying product cans;
>   2. Left reception area: White-and-blue reception desk with brand mark, tabletop with floral art, conveying a professional friendly image;
>   3. Right product display: Gradient light-blue stepped display stand showing cans layer by layer, rear hung with a display screen and brand poster showing ranch/factory scenes;
>   4. Negotiation area: Light wood floor with white simple tables and chairs, green plant pots softening the atmosphere.
> - Ground and lighting: Dark gray high-reflective floor with local light-wood flooring; layered commercial lighting with warm accent on the negotiation area.

## 范例 C · 精酿啤酒（活力黄 + 街头潮流）

> 3D rendering image of a craft beer exhibition stand. The overall style is lively trendy street fashion. The main colors are bright yellow, dark gray, and fluorescent yellow. The background is the black metal truss roof and dark gray industrial ceiling of a real exhibition hall:
> - Top structure: Bright-yellow metal frame flat top, double-layer fluorescent-yellow neon embedded along the edge; front hung with an illuminated signboard carrying the brand zone, decorated with green leaves; a giant beer-can-shaped light box on the right.
> - Main booth:
>   1. Central core area: Dark-gray background wall with a brand mark, a giant 3D lemon-slice decoration and floating slices creating a fresh sour atmosphere;
>   2. Left product area: Bright-yellow stepped display stand layering beer cans, a giant illuminated brand numeral on the left;
>   3. Right experience area: White simple tables and chairs for tasting/rest, wall-embedded bright-yellow storage racks; open transparent layout;
>   4. Detail: black-and-yellow warning stripes at the base, small green pots, fluorescent-yellow neon running through, conveying young trendy beer culture.
> - Ground and lighting: Dark-gray high-reflective floor with local white platforms; layered lighting.

## 用法要点

- **结构**：一句全局声明锁定 行业 + 风格 + 主/辅/点缀色 + 背景 → `Top structure` → `Main booth`（中央/左/右分区，每区写 位置 + 载体 + 内容 + 效果）→ `Ground and lighting`。与 `prompt-craft` 五层架构一一对应。
- **品牌占位**：范例的品牌字样仅为演示；生产中改占位符，不精确生成文字/logo（红线见 `brand-assets`）。
- **密度**：200-400 词，空间叙事而非物品清单；颜色带修饰、材质带表面、灯光带色温（见 `prompt-craft` 视觉词汇表）。
- gpt-image-2 文字渲染更强，但品牌文字仍守"占位优先"红线；Phase 0 用真实生图校准后再决定放宽程度。
