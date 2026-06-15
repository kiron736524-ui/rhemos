---
skill: multiview
load: 用户要"多视角全貌"时（render_multiview_sheet）
summary: 多视图 = 单图 2x2 turnaround sheet（前/左/右/俯视平面），一次渲染保证一致；强制角度分明 + 平面图。
source: 重写——实测 images.edit 经 Gateway 404、单图 sheet 一次渲染天然一致胜分图，故弃 rhemax 全部锁定机制
---

# 多视图 = 单图 turnaround sheet

**核心**：多视角全貌用**一张图、四宫格**呈现同一个展台（前 3/4 / 纯左 / 纯右 / 俯视平面），**一次渲染**。一致性来自"同一次生成"，不是事后对齐。

## 为什么不是四张独立图
分开生成 → 每张是独立随机采样 → 漂成不同展台（这正是旧 rhemax 全套"锁一致性"找补的根因：identity-spec 重注入、坐标锚图、失败样本重试、十几轮 inspect+revise）。**这些现在全部不要**。单图 sheet 在一次生成里保持内部一致 → 天然同一展台（实测 Sonnet 判一致性 72，可调高，胜分图）。

## 工具
用 `render_multiview_sheet`：booth 描述取自 DesignSpec；默认 high/1536/n=2 并行择优。**不要自己拆成多次 generate_best_of_n 拼多视图。**

## 让 sheet 更好（工具模板已内置，写 booth 描述时也照顾）
- **强制角度分明**：前 3/4、**纯左侧**、**纯右侧**、**真俯视正交平面**——每格相机明显不同，别重复同一角度（这是 sheet 唯一软肋）。
- **俯视格出平面图**：既是布局真值，客户也要看平面。
- 不变量（结构/材质/颜色/品牌位置/灯光）四格保持一致。
- best-of-N=2 选"角度最分明 + 最一致"那张。

## 与单张 money shot 的关系
- `render_multiview_sheet` = **多视角全貌总览**（一张图四角度）。
- `generate_best_of_n` 单张高清 = **money shot**（某个最佳角度）。
- 两者从**同一 DesignSpec** 出 → 同一设计（非像素级同一，因 Gateway 不支持图像条件化）。
- **per-角度独立高清重绘暂缓**：用户满意 sheet 后再单独高清化。
