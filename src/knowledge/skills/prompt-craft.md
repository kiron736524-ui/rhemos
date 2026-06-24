---
skill: prompt-craft
load: 把已确认方案/DesignSpec 编译成生图 prompt 时（render / revise_asset）
summary: 生图 prompt 五层架构 + 工程值→视觉比例锚定表 + 模糊词→精确词表 + 批次差异 + 负向约束。
source: 旧 rhemax tasks/prompt-craft.md（去除旧工具耦合；编译检查并入 rubrics/inspection 的"预防"用法；按 gpt-image-2 适配）
---

# 生图 Prompt 编译

把已确认的 DesignSpec 编译为高质量英文图像提示词。这是后台编译，不是用户阅读阶段——中文方案服务用户理解，英文 prompt 服务图像模型，二者不是直译关系。

## 核心认知

你写的是**高度结构化的空间叙事**，不是自由散文，也不是物品清单。核心能力：**每个物体都有明确的位置、尺寸、与相邻物体的关系。** 图像模型不理解"80cm"这种绝对数字，但理解比例关系和常识类比——必须把工程数据翻译成视觉语言。

## 五层架构（按序，不可打乱）

### 第一层：全局声明
一句话锁定 输出格式 + 行业语境 + 视觉基调 + 场景环境，并铺设基准：
```
3D rendering image of an exhibition booth for [行业+展会].
Booth footprint: [长边]m × [短边]m, [开口方式] layout, [back wall / open side on which side], [main aisle direction].
Wall and height system: [overall height includes truss if applicable], [main wall 4.4m domestic / 4.0m overseas], [meeting room flush with main wall or low partition].
Brand system: [brand name placeholder or confirmed], [logo/key icon placement], [slogan display zone], [main wall/header/reception/LED/wayfinding strategy].
Overall style: [2-3 风格关键词]. Main colors: [主色], [辅色], [点缀色]. Background: [展馆环境].
```
必须声明：尺寸+开口方式（所有空间关系的基准）；开口方位（长/短边、主通道方向）；高度口径（6m 是否含 Truss、板墙 4.4/4.0、会议室是否齐平）；品牌落位（占位符，不臆造文字）。风格关键词要具体（不是 "modern" 而是 "sleek geometric minimalist"），颜色要具体（不是 "blue" 而是 "technology blue with cool gray"）。

### 第二层：顶部结构（天际线，远距离识别第一要素）
槽位：`[有无顶部] + [悬挂/支撑方式] + [框架材质形态] + [中部造型] + [灯光类型位置] + [品牌 logo 位置形式] + [装饰元素]`。
有 Truss/吊顶/门头/吊挂时必须写明中部造型（open center / suspended ring / rectangular light frame / linear lighting grid / translucent fabric canopy / floating geometric modules / scene-specific thematic element），说明它如何形成美感、识别点、空间包裹感——不要只写 "a truss frame"。除非用户明确要 open center / bare truss。

### 第三层：主体展区（核心层 — 空间叙事）
**从固定视角出发，按空间位置依次描述每个功能区**，模拟观众从主通道走进来的视觉扫描：先正对的主视觉面 → 再左右两侧 → 最后靠入口的前区。
- ❌ 禁止物品清单（"a booth with LED wall, meeting room, reception, displays"）
- ✅ 必须空间叙事（"facing the booth from the main aisle: the far wall is dominated by..."）
- 每个功能区四要素：**位置**（在哪、紧邻什么）+ **尺寸**（用常识比例，见锚定表）+ **载体**（墙/柜/台/屏）+ **效果**（什么氛围）。
- 相对位置用：相邻关系（"directly adjacent to the LED wall on the left"）/ 占比关系（"occupying roughly one-third of the left side"）/ 高度对齐（"flush with the LED wall, forming a continuous facade"）/ 间距关系（"three screens evenly spaced along the right wall"）。

### 第四层：地面与灯光
`[地面材质+反射度] + [地台+高度] + [局部铺设差异] + [灯光来源类型] + [光影效果]`。灯光分层：base illumination（overhead recessed downlights）/ focused spotlights（highlighting product cabinets）/ linear LED strips（tracing structural edges）。**永远指定色温**：cool white (5000K feel) 或 warm white (3000K feel)。

### 第五层：渲染指令
`[分辨率] + [材质质感关键词] + [细节清晰度] + [镜头视角]`。镜头明确指定：主视角默认 `slightly elevated three-quarter view from the main aisle, wide-angle`；入口 `eye-level view entering from the main aisle`；鸟瞰 `bird's-eye view showing complete floor plan`；特写 `close-up on [area]`。

**画风锚（铁律，最高优先）**：每张图都必须显式声明"工业级真实渲染"画风——`photorealistic professional architectural visualization, high-end 3D render (V-Ray/Corona/Octane-grade), physically-based materials, realistic global illumination + soft shadows + reflections, as if photographed in a clean professional exhibition hall`，并显式否定 `NOT a cartoon / illustration / flat vector or line diagram / sketch / clay model / generic AI-art`。gpt-image-2 缺这层会漂向 CG/插画/产品手册示意图——尤其 turnaround sheet（`2x2 grid / panel / turnaround` 等词天然带向 model-sheet 线稿风），更要用强渲染锚对抗，并强调每格都是 fully rendered 3D view、连俯视平面也要 realistically rendered orthographic top view。（代码层已对所有生图兜底注入该锚，但你写 prompt 时仍要主动带上，并把材质/光照落到展台真实质感。）

**边界锚（铁律）**：用户没有明确要求异形时，写 `one clean unbroken rectangular platform/carpet edge and truss perimeter, four 90-degree corners, no notches, no protrusions, no chamfers, no add-on floor islands, no polygonal outline`。圆形动线、圆桌、圆形吊灯、弧形 LED、产品塔、立牌都只能是内部元素，不能改变外轮廓。

**立牌 / totem / standee**：用户说"加立牌/丰富场地"时，不要泛泛写 decorations。写成 `2-6 slim rectangular freestanding sign totems / standees inside the footprint, about 0.6-0.9m wide and 1.8-2.4m tall, placed along aisles without blocking circulation, not walls, not changing the booth boundary`。数量、位置和形态要明确，避免模型生成随机柱子、奇怪墙片或把边界顶歪。

**深色风格曝光**：黑金、暗色、沉浸式项目也必须写 `well-exposed, readable booth details, clean uncluttered neutral exhibition hall, controlled spotlights and linear LEDs`。避免 `dark dramatic atmosphere` 单独出现；否则容易变成灰暗、背景杂、像零售店/舞台。

## 相对尺寸锚定表（绝对值 → prompt 描述）

| 工程值 | Prompt 描述 |
|---|---|
| 地台 10cm | a subtly raised platform, roughly ankle height |
| 展柜 75-100cm | display cabinets at waist to hip height |
| 接待台 90cm | reception counter at about chest height |
| 接待台深 45cm | a narrow counter, about half its own height in depth |
| 墙体 4.0-4.4m | main structural walls rising to approximately twice the height of a standing person |
| 墙体厚 10cm | slim structural walls |
| LED 墙厚 80cm | a deep structural housing, thick enough for a person to walk behind for maintenance |
| 洽谈墙 2.5-2.8m | low/semi-enclosed meeting room walls just above standard door-frame height |
| 洽谈室与主墙齐平 | meeting room exterior walls flush with the main structural wall, forming a continuous facade |
| 4 人洽谈室 | a compact meeting space with a small round table and four chairs, roughly a home dining area |
| 6-8 人洽谈室 | a mid-size meeting room with a rectangular table and six chairs, about a small office |
| 10 人+洽谈室 | a full conference room with a long table, roughly a living room footprint |
| Truss 高 5-6m | overhead truss structure rising about 2.5× human height |
| 舞台高 30-50cm | a low stage platform, about knee height |
| 大 LED 屏(≥6㎡) | a large video wall spanning most of the back wall |
| 中型电视(55-65") | a flat screen about the width of an outstretched arm span |
| 小型电视(32-42") | a monitor roughly the width of a person's shoulders |

## 视觉词汇精确度表（模糊 → 精确，铁律）

| 模糊 | 精确 |
|---|---|
| blue | technology blue / ice blue / gradient blue |
| floor | dark gray high-reflective raised platform floor |
| wall | pure white matte-finished structural wall |
| glass | frosted glass partition with subtle transparency |
| lighting | cool white (5000K) overhead recessed spots |
| modern | sleek geometric with clean intersecting planes |
| high-end | matte black powder-coated steel with brushed aluminum accents |
| wood | warm oak-toned wood veneer panels |

**铁律**：颜色永远带修饰词，材质永远带表面处理，灯光永远带色温和方向，风格永远落到具体空间特征。

## 品牌占位 & 有序参考图
- 品牌只描述"放在哪、多大、主次、是否发光、与哪个结构结合"，用占位符不写具体文字/不复刻 logo 几何。词典与落位英文写法见 `brand-assets`。
- 参考图必须保留用户指定顺序：`Reference image #N = [角色]`，不按文件名/相似度重排。细则见 `reference-and-editing`。

## 编译前自检（预防，写完即查；这是"自检前移"的主力）
对照 `rubrics/inspection` 的客观维度，在 prompt 里逐条确认：尺寸+开口方位是否声明？高度口径是否区分含 Truss 总高 vs 板墙、会议室是否齐平？有 Truss 是否写明中部造型且与场景适配？品牌落位是否占位符？每个功能区是否有位置+常识比例尺寸+相邻关系？灯光是否三层+色温？镜头是否指定？是否避免物品清单？是否有悬浮结构？控制在 200-400 英文词。

## 批次差异（一次多张时，每张不同）
主视角全景（整体空间关系体量）/ 重点功能区特写（核心展示或主视觉面）/ 灯光氛围（材质质感与光影层次）。每张至少在 空间布局 / 视觉重心 / 材质表达 / 氛围 一个维度不同。

## 负向约束（每批附带）
No floating / unsupported structures；不像展台（像零售店/舞台/住宅）；矩形展位被画成缺角/外凸/斜切/多边形；立牌变墙或改变外边界；透视失衡、材质脏乱、灯光失控/过暗；文字乱码、品牌图形失真；人物喧宾夺主、背景过杂。

## gpt-image-2 适配
gpt-image-2 指令遵循与**文字渲染**远强于旧 nano/gemini：可更依赖显式分层指令；品牌**占位**仍守红线（无素材不臆造），但可更可靠地放置"标识区"的位置与发光方式。五层架构与两张表先沿用，Phase 0 用真实生图校准（size/质量/编辑/参考图行为）后微调。
