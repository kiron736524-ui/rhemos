// ASR 两腿冒烟（无需麦克风）：A) DeepSeek V4 Flash 清理；B) Fun-ASR 握手(连接+key+模型名)。
// 运行：node --env-file .env.local scripts/asr-spike.mjs
import { generateText } from 'ai';
import { gateway } from '@ai-sdk/gateway';
import { WebSocket } from 'undici';
import { randomUUID } from 'node:crypto';

const CLEANUP_SYSTEM = `你是展台设计语音输入的整理助手。下面是用户口述需求的语音转写，可能有语气词（嗯/呃/那个/就是/啊）、重复、口误、同音错字、语序跳跃。请整理成简洁通顺、可直接放进输入框的书面中文：
1) 删去语气词、口头禅和无意义重复；
2) 结合展台设计语境修正明显同音错字（"洽谈区/桁架/开口/限高/LED/岛型/吊装"等术语别改错）；
3) 轻度理顺逻辑与语序，把同一件事的零散表述合并通顺；
4) 完整保留所有具体信息：数字、尺寸、面积、预算、风格、品牌、功能、材料、约束；
5) 不扩写、不总结、不臆测、不替用户补他没说的内容。
直接输出整理后的文本，不要解释或前缀；若无可识别内容，输出空字符串。`;

// ---------- A) DeepSeek 清理 ----------
const messy =
  '嗯…那个我想做一个就是呃九乘六米的展台，对就是科技公司的，嗯主色那个用蓝色白色，然后呢要有个那个洽谈区，就是能谈生意的，啊对还要个大屏幕，呃就这样吧。';
console.log('[A] DeepSeek V4 Flash 清理\n  原文：', messy);
try {
  const r = await generateText({
    model: gateway.languageModel('deepseek/deepseek-v4-flash'),
    system: CLEANUP_SYSTEM,
    prompt: messy,
    temperature: 0,
  });
  console.log('  ✅ 清理后：', r.text.trim());
} catch (e) {
  console.error('  ❌', String(e?.message || e).slice(0, 220));
}

// ---------- B) Fun-ASR 握手 ----------
console.log('\n[B] Fun-ASR 握手（连接 + key + 模型名）…');
const model = process.env.FUN_ASR_MODEL || 'fun-asr-realtime-2026-02-28';
await new Promise((resolve) => {
  const ws = new WebSocket('wss://dashscope.aliyuncs.com/api-ws/v1/inference/', {
    headers: { Authorization: `Bearer ${process.env.DASHSCOPE_API_KEY}` },
  });
  const taskId = randomUUID().replaceAll('-', '');
  const done = (fn) => {
    clearTimeout(timer);
    try {
      ws.close();
    } catch {
      /* ignore */
    }
    fn();
    resolve();
  };
  const timer = setTimeout(() => done(() => console.error('  ❌ 15s 未收到 task-started')), 15000);
  ws.addEventListener('open', () => {
    ws.send(
      JSON.stringify({
        header: { action: 'run-task', task_id: taskId, streaming: 'duplex' },
        payload: {
          task_group: 'audio',
          task: 'asr',
          function: 'recognition',
          model,
          parameters: { format: 'wav', sample_rate: 16000, semantic_punctuation_enabled: true },
          input: {},
        },
      }),
    );
  });
  ws.addEventListener('message', (ev) => {
    const t = typeof ev.data === 'string' ? ev.data : new TextDecoder().decode(ev.data);
    let m;
    try {
      m = JSON.parse(t);
    } catch {
      return;
    }
    const e = m.header?.event;
    if (e === 'task-started') done(() => console.log(`  ✅ task-started —— 模型 ${model} + key + 连接 全部 OK`));
    else if (e === 'task-failed') done(() => console.error(`  ❌ task-failed: ${m.header?.error_code} / ${m.header?.error_message}`));
  });
  ws.addEventListener('error', (ev) => done(() => console.error('  ❌ WS error:', ev.message || 'error')));
});
console.log('\n=== asr spike 结束 ===');
