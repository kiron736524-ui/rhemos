/**
 * 蒙版局部编辑（画笔涂抹 inpaint）的提示词构造。
 *
 * gpt-image-2（无论模型本身还是 fal 渠道）**都不支持原生 mask 参数**，只接受 `image_urls` 多图 + 一段文字。
 * 所以蒙版编辑走「第二张图 = 黑白遮罩」+ 强指令的路子（与 rhemax 用 Gemini 时同一思路，且复用 falEditFromRefs 多图）：
 *   IMAGE 1 = 原图；IMAGE 2 = 与原图像素对齐的黑白遮罩（白=要改、黑=保持不变）。
 *
 * 注意：模型只认得 `image_urls` 的**顺序** + 这段文字，认不得我们贴在图上的 id/编号——
 * 所以一律按"第几张 + 角色"在提示词里描述，配对靠位置而非编号。
 */

/**
 * 把已翻成英文的「要改成什么」包成蒙版局部编辑指令。
 * `englishChange` 建议先经 prompt-writer(kind='revise') 产出（"change ONLY: ..."）。
 * 返回的指令外层还会被 withRenderStyle 追加画风锚（调用方负责）。
 */
export function buildMaskedEditInstruction(englishChange: string): string {
  return [
    'You are given TWO images. IMAGE 1 is the original exhibition-booth render to edit. IMAGE 2 is a BLACK-AND-WHITE MASK that is pixel-aligned to IMAGE 1: the WHITE area marks the exact region to change, the BLACK area must stay 100% identical.',
    'Apply the requested change ONLY inside the white-masked region of IMAGE 1. Everything outside the white region — overall composition, camera angle, perspective, geometry, materials, colors, lighting, brand placement, text, and every neighboring object — must remain byte-for-byte identical to IMAGE 1, blended seamlessly and naturally at the mask boundary. Do not restyle, recolor, move, shrink, or regenerate anything in the black region. Output a single edited image (do NOT draw the mask itself).',
    `Change to apply inside the white region: ${englishChange.trim()}`,
  ].join('\n\n');
}

/** data URL（data:image/png;base64,xxx）→ 字节；非法返回 null。 */
export function dataUrlToBytes(dataUrl: string): Uint8Array | null {
  const m = /^data:([^;]+);base64,(.+)$/.exec(dataUrl.trim());
  if (!m) return null;
  try {
    return new Uint8Array(Buffer.from(m[2], 'base64'));
  } catch {
    return null;
  }
}
