// 复现 + 验证：空 inputSchema 工具在多轮里导致 Anthropic 400(tool_use.input not a dict)；加可选字段是否解。
// 运行：node --env-file .env.local scripts/toolinput-spike.mjs
import { generateText, stepCountIs, tool } from 'ai';
import { gateway } from '@ai-sdk/gateway';
import { z } from 'zod';

const opus = gateway.languageModel('anthropic/claude-opus-4.8');

async function run(label, inputSchema) {
  const tools = {
    get_state: tool({ description: '读取当前项目状态', inputSchema, execute: async () => ({ items: ['图A', '图B'] }) }),
  };
  const user1 = { role: 'user', content: '读取一下当前项目状态。' };
  // 第 1 轮：强制调用工具，产生含 tool_use 的历史
  const t1 = await generateText({ model: opus, tools, toolChoice: 'required', stopWhen: stepCountIs(3), messages: [user1] });
  // 第 2 轮：把第 1 轮历史回传 + 跟进（这一步就是之前崩的地方）
  try {
    const t2 = await generateText({
      model: opus,
      tools,
      stopWhen: stepCountIs(3),
      messages: [user1, ...t1.response.messages, { role: 'user', content: '好的，谢谢。' }],
    });
    console.log(`[${label}] ✅ 第二轮成功（无 400）：${t2.text.slice(0, 40)}`);
  } catch (e) {
    console.log(`[${label}] ❌ 第二轮 400：${String(e?.message || e).slice(0, 120)}`);
  }
}

console.log('验证 read_project_state 的空 schema 400 bug：\n');
await run('空 schema  z.object({})         ', z.object({}));
await run('修复 schema z.object({note?})    ', z.object({ note: z.string().optional() }));
console.log('\n=== 结束 ===');
