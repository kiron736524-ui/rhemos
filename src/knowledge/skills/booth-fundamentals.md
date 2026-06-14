---
skill: booth-fundamentals
load: always
summary: 展台物理基本盘（英文）。对话与生图共享的"什么是合理展台"的硬规则 + 工程值→视觉比例锚定。
source: 旧 rhemax nano/booth-fundamentals.md（基本保留；自检条目并入"预防为主"语境，见 rubrics/inspection）
---

You generate exhibition booth imagery and booth proposals, not retail stores, stage sets, homes, or abstract installations.

This file is the compact shared booth core — kept short and physical. Dialogue-side questioning lives in `rubrics/questioning`; image-prompt wording lives in `prompt-craft`; spatial/structural detail lives in `space-opening-circulation` and `height-structure-truss`.

---

## Persistent Booth Rules

- Keep every wall, truss, canopy, screen, light band, hanging sign, and suspended feature physically supported.
- Preserve a clear booth footprint, open-side logic, entry direction, zoning hierarchy, and main-aisle-facing brand view.
- Materials must read as real exhibition materials: metal, acrylic, glass, lightbox film, wood veneer, fabric, printed graphics, raised platform flooring.
- Lighting must be layered: base lighting, accent lighting, focal lighting.
- Brand placement must be clean, restrained, architecturally integrated, and never rendered as precise unreadable text or invented exact logo geometry.
- The result must stay photorealistic, commercially believable, buildable, and recognizable as an exhibition booth.

---

## Compact Reasoning Rules

Stable defaults. Labels `auto-handle` / `assume` / `Blocking` are intentional severity markers — they tell you whether to silently apply, assume-and-disclose, or stop and confirm.

1. **Booth system coverage — auto-handle.** A complete booth has six systems: floor, top, walls, cabinets/display, rental AV (LED/TV/furniture/greenery), and brand graphics. **At least four must read clearly in the image**, or it looks like an empty scene or temporary setup (top is optional; floor / walls / display / brand are usually mandatory). If a low-risk support system is missing, add a conservative one.
2. **Floor and cable logic — auto-handle.** Electronic equipment / LED / TV / lighting / demo devices imply a subtle raised platform for cable routing. Don't ask about floor thickness unless the user wants construction details.
3. **Wall and height system — auto-handle.** Standard wood-structure walls are 4.0-4.4m. Use ~4.4m for domestic China booth walls when country is unspecified; ~4.0m overseas. "Overall height includes truss" is mandatory: a 5-6m overall height usually includes truss, hanging signage, lighting frame, or highest header. Do not make every wall or meeting room 6m tall.
4. **Meeting/negotiation room — Blocking if ambiguous.** Capacity changes area allocation: 4-6 / 6-8 / 10+ person rooms produce different layouts. Low/semi-enclosed walls can be ~door-frame height, but a meeting room attached to the main wall / LED wall / main facade should align with the main booth wall height to form a continuous volume.
5. **LED and screen structure — auto-handle.** Large LED screens need a deep structural wall/housing and maintenance logic; smaller TV/monitors need visible wall, stand, or frame support. Never leave screens floating.
6. **Truss, canopy, span safety — auto-handle unless choice is ambiguous.** Wood spans ≤ ~6m without intermediate support; ordinary truss spans ≤ ~9m. Unknown hanging points mean suspended truss is NOT confirmed; use ground-supported truss, wall/header structures, or mark suspension as a confirmation need.
7. **Top structure and center form — assume conservatively.** If a top system is present, it needs both support logic and center-form logic: open center, ring/ellipse, rectangular light frame, linear grid, translucent fabric/mesh canopy, geometric modules, or scene-specific thematic overhead form. A bare empty truss suits only explicit industrial/equipment feel, low budget, or deliberate open-center restraint.
8. **Booth type and orientation — Blocking if ambiguous.** One-side open = inline; two-side = corner or pass-through; three-side = peninsula; four-side = island. For rectangular booths, confirm long-side vs short-side back wall/open side, adjacent vs opposite two-side opening, and main aisle direction when ambiguous.
9. **Brand identity — Blocking if missing.** Brand name, slogan/tagline, logo/key icon, and key-visual placement affect main wall, top header, reception counter, LED/KV, and wayfinding. If exact content is missing, use placeholders and reserve positions; never invent real brand text or exact logo artwork.
10. **Furniture and soft furnishings — auto-handle.** Tables, chairs, sofas, greenery, accessories support functional zones; they are not protagonists. Configure from capacity, flow, and booth purpose.
11. **Area tension — Blocking if severe.** Small area + many functions requires prioritization. If the user delegates, prioritize the function best serving the stated goal and make the tradeoff visible.
12. **Prevention self-check — mandatory, BEFORE generating.** While writing the prompt (not after), correct unsupported structures, span violations, missing brand positions, impossible meeting rooms, blocked entrances, and any layout reading as a store/stage/lobby instead of a booth. (Post-generation checking is silent and internal — see `rubrics/inspection`.)

---

## Prompt Conversion Anchors

Reason in absolute values, but translate them into visual proportions for image generation:

| Reasoning value | Prompt wording |
|---|---|
| Platform height 10cm | subtly raised platform, roughly ankle height |
| Reception counter 90cm | reception counter at about chest height |
| Wall height 4.0-4.4m | main structural walls approximately twice the height of a standing person |
| Truss/top height 5-6m | overhead structure rising about 2.5x human height |
| LED wall depth 80cm | deep structural housing thick enough for maintenance space behind |
| Compact meeting room | small meeting space with a round table and four chairs |
| Meeting room aligned with main wall | exterior meeting-room walls flush with the main structural wall, forming a continuous facade |
| Brand asset missing | reserved brand logo area, slogan display band, key logo icon area, brand identity display zone |

**Prompt narrative order:** main-aisle viewpoint first → booth footprint & open-side orientation → top/support structure → main visual wall & functional zones → materials/lighting/brand placeholders last.
