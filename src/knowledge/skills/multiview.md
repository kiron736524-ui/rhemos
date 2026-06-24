---
skill: multiview
load: 多视角交付时（用户已选 baseAssetId 后，render 给 views）
summary: 最终多视角 = 用户选定基准图 + identity 锁定 + 参考条件化；默认各视角并发生成，每视角是「单视角全幅真实渲染」，不是四宫格 sheet。判图/一致性检查仅按需启用。
source: 重写——对齐当前 render.ts（唯一入口，views 必须基于用户已选 baseAssetId）；推翻旧"单图 turnaround sheet"策略（低清易漂、像 model sheet）
---

# 多视角 = 基于用户选定基准图的参考条件化

**核心**：最终多视角交付**不是**一张四宫格 / turnaround sheet，而是**每个角度一张独立的、单视角全幅的真实渲染**。它必须在用户已经从首稿候选中选定 `baseAssetId` 后进行，靠 **用户选定基准图 + identity 锁定 + 参考条件化**保持是同一个展台。

> 这是 prompt-writer 子模块要内化的纪律：写视角 prompt 时**绝不**用 `2x2 grid / four-panel / turnaround sheet / model sheet / orthographic line drawing` 这类措辞——那会把图带成低清拼版 / 线稿示意图（用户实测"诡异、不像正经渲染"的来源）。每个视角都是 fully rendered 3D 照片级画面。

## 为什么不是四宫格 sheet
- 四宫格把 4 个角度挤进一张图 → 每格分辨率被切到 1/4，细节糊、材质塌、容易漂成不同展台。
- "sheet / grid / turnaround / model sheet" 措辞天然把模型带向**线稿示意图 / 产品手册图**，而非建筑可视化级真实渲染。
- 客户要的是**每个角度都能放大看的高清效果图**，不是一张缩略拼版。

**单图总览 sheet 只在一种情况可用**：极早期的快速方向探索 / 总览草案（`render(mode=concept)`），**永不作为最终高清多视角交付**。

## 当前实现（render.ts 已驱动，写 prompt 时配合）
`render` 是唯一生图入口。给 `views` 前必须已有 `baseAssetId`：
1. 首稿阶段先 `render(views=[], n=2, autoCheck=false)` 出 candidate-set，并停住等用户选择。
2. 用户点选基准图后，项目状态写入 `baseAssetId`。
3. 多视角阶段 `render(views=[...], n=1, autoCheck=false)` 以 **[（平面图）+ 用户基准图]** 为硬参考并发生成各角度（不是凭文字从头各画一张）。
4. 只有用户明确要求 AI 一致性检查时，才打开 `autoCheck=true`；此时才走串行门控，把通过的视角加入后续参考池。否则选择权交还用户，避免漂移图污染下一张。

prompt-writer 不直接写每个视角的换角度指令（那段由 render 内部生成，已写死"only camera changes"），但你写 hero / 主图 prompt 时要为多视角留好基础：identity 部件**含数量**、配色 hex、品牌占位都钉死，后续视角才锚得住。

## 视角 prompt 铁律（render 内部已用，理解即可）
每个视角指令都必须表达："**用参考图里这个一模一样的展台，只换相机到 <某视角>；结构 / 材质 / 颜色 / 品牌位置 / 家具数量 / 灯光全部与参考图保持一致——only the camera changes, do NOT add, remove, move or redesign anything**。"

## 参考链原则
- 默认参考池 = 用户选定基准图（有平面图则 [平面图 + 基准图]），所有视角并发调用，墙钟接近最慢的一张。
- 默认不要把新生成的视角再喂给下一张；未经人工/AI确认的漂移图会污染后续角度。
- 只有用户要求 AI 一致性检查时，参考池才从 [平面图 + 基准图] 开始串行扩展：通过门控的视角进入参考池，不通过的不进入，防止漂移传染。
- 累积优质参考有价值，但前提是"优质"已经被用户或 autoCheck 确认；未确认图不能默认成为新锚点。

## 各视角的形态
- 侧视 / 后视 / 入口视：单视角全幅、照片级 3D，侧立面 / 后立面主导画面。
- 俯视：**真实渲染的正交俯视**（realistically rendered orthographic top view），不是线稿平面图；canopy / truss 在俯视里半透明、不挡内部。

## 与单张 money shot 的关系
- hero candidate-set = 用户选择基准图的入口。
- views = 同一个展台的其余角度，靠用户基准图和累积参考锚定一致。
- 两者同出一个 DesignSpec / identity → 同一设计。
