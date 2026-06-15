import { generateText } from 'ai';
import { gateway } from '@ai-sdk/gateway';
import { MODEL_IDS } from '@/models/gateway';

// 语音转写清理：DeepSeek V4 Flash（经 Gateway）。去语气词/去重复/轻度理顺，不臆造。
const CLEANUP_SYSTEM = `你是展台设计语音输入的整理助手。下面是用户口述需求的语音转写，可能有语气词（嗯/呃/那个/就是/啊）、重复、口误、同音错字、语序跳跃。请整理成简洁通顺、可直接放进输入框的书面中文：
1) 删去语气词、口头禅和无意义重复；
2) 结合展台设计语境修正明显同音错字（"洽谈区/桁架/开口/限高/LED/岛型/吊装"等术语别改错）；
3) 轻度理顺逻辑与语序，把同一件事的零散表述合并通顺；
4) 完整保留所有具体信息：数字、尺寸、面积、预算、风格、品牌、功能、材料、约束；
5) 不扩写、不总结、不臆测、不替用户补他没说的内容。
直接输出整理后的文本，不要解释或前缀；若无可识别内容，输出空字符串。`;

export async function cleanupTranscript(raw: string): Promise<string> {
  const r = await generateText({
    model: gateway.languageModel(MODEL_IDS.cleanup),
    system: CLEANUP_SYSTEM,
    prompt: raw,
    temperature: 0,
  });
  return r.text.trim();
}
