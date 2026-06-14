---
skill: styles
load: 写生图 prompt 需要注入风格基调时
summary: 5 个命名风格库（英文 emphasis 一句），按需注入生图 prompt。可扩展。
source: 旧 rhemax nano/styles/*.md（逐字保留）
---

# 风格库（生图风格注入）

每个风格一句英文 `Style emphasis`，在编译生图 prompt 时按方案调性选 1 个（必要时取最贴近的）注入第一层"全局声明"。可随经验扩展更多风格。

- **clean-tech**：`minimalist clean-tech booth, bright white architectural shells, precise geometry, soft blue accent light, restrained branding, high clarity, calm premium atmosphere.`
- **hard-tech**：`hard-tech booth language, exposed truss logic, geometric metal framing, vivid blue linear light, strong engineering presence, crisp contrast, confident corporate expression.`
- **transparent-fusion**：`transparent fusion, glass and translucent partitions, open circulation, lighter massing, balanced white structure, integrated LED displays, breathable and contemporary space.`
- **premium-warm**：`premium warm tone, soft warm-white lighting, refined wood or champagne-metal accents, comfortable hospitality feeling, elegant detailing, balanced contrast, high-end business atmosphere.`
- **immersive-dark**：`immersive dark expo environment, dramatic contrast, black or charcoal background, controlled neon accents, cinematic lighting hierarchy, strong focal glow, premium tech mood.`

## 选用

- 按方案调性与用户语言里的关键词匹配最贴近的风格；不确定时默认 `clean-tech`（最稳、最通用）。
- 风格只定基调，不覆盖已确认的结构、品牌、色彩；与 `design-method` 的材质家族/色温保持一致。
- gpt-image-2 指令遵循强，可在风格句基础上再叠加方案的主辅点缀色与材质表面处理（见 `prompt-craft` 视觉词汇精确度）。
