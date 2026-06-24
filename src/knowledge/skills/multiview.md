---
skill: multiview
load: 多视角交付时（render 给 views）
summary: 最终多视角 = identity 锁定 + 参考条件化 + 进化式参考链 + 判图门控；每视角是「单视角全幅真实渲染」，不是四宫格 sheet。
source: 重写——对齐当前 render.ts（唯一入口，有 views 走进化链）；推翻旧"单图 turnaround sheet"策略（低清易漂、像 model sheet）
---

# 多视角 = 进化式参考链（每视角单视角全幅）

**核心**：最终多视角交付**不是**一张四宫格 / turnaround sheet，而是**每个角度一张独立的、单视角全幅的真实渲染**，靠 **identity 锁定 + 参考条件化 + 进化式参考链 + 判图门控**保持是同一个展台。

> 这是 prompt-writer 子模块要内化的纪律：写视角 prompt 时**绝不**用 `2x2 grid / four-panel / turnaround sheet / model sheet / orthographic line drawing` 这类措辞——那会把图带成低清拼版 / 线稿示意图（用户实测"诡异、不像正经渲染"的来源）。每个视角都是 fully rendered 3D 照片级画面。

## 为什么不是四宫格 sheet
- 四宫格把 4 个角度挤进一张图 → 每格分辨率被切到 1/4，细节糊、材质塌、容易漂成不同展台。
- "sheet / grid / turnaround / model sheet" 措辞天然把模型带向**线稿示意图 / 产品手册图**，而非建筑可视化级真实渲染。
- 客户要的是**每个角度都能放大看的高清效果图**，不是一张缩略拼版。

**单图总览 sheet 只在一种情况可用**：极早期的快速方向探索 / 总览草案（`render(mode=concept)`），**永不作为最终高清多视角交付**。

## 当前实现（render.ts 已驱动，写 prompt 时配合）
`render` 是唯一生图入口。给 `views` 时它自动走进化链：
1. 先出主图 hero（best-of-N 择优）。
2. 逐个视角：以 **[（平面图）+ 主图 + 已通过的视角]** 为**累积参考**做参考条件化生图（不是凭文字从头各画一张）。
3. 每个视角判**一致性**（是否同一展台）；**判图门控**：只有通过门控的视角才进参考池。
4. 漂移 / 不通过的视角**不进参考池**——防止漂移传染后续角度。

prompt-writer 不直接写每个视角的换角度指令（那段由 render 内部生成，已写死"only camera changes"），但你写 hero / 主图 prompt 时要为多视角留好基础：identity 部件**含数量**、配色 hex、品牌占位都钉死，后续视角才锚得住。

## 视角 prompt 铁律（render 内部已用，理解即可）
每个视角指令都必须表达："**用参考图里这个一模一样的展台，只换相机到 <某视角>；结构 / 材质 / 颜色 / 品牌位置 / 家具数量 / 灯光全部与参考图保持一致——only the camera changes, do NOT add, remove, move or redesign anything**。"

## 参考链原则（门控）
- 参考池起点 = 主图（有平面图则 [平面图 + 主图]）。
- 每出一个**通过判图门控**的视角，就把它加进参考池，给后续视角当锚。
- **不通过的漂移图绝不进参考池**——否则漂移会一路传染。
- 累积优质参考 > 单参考（实测：用 [主图 + 已过关左视] 双参考出俯视，一致性显著高于只用主图）。

## 各视角的形态
- 侧视 / 后视 / 入口视：单视角全幅、照片级 3D，侧立面 / 后立面主导画面。
- 俯视：**真实渲染的正交俯视**（realistically rendered orthographic top view），不是线稿平面图；canopy / truss 在俯视里半透明、不挡内部。

## 与单张 money shot 的关系
- hero best-of-N 单张 = 某个最佳角度的 money shot。
- views 进化链 = 同一个展台的其余角度，靠累积参考锚定一致。
- 两者同出一个 DesignSpec / identity → 同一设计。
