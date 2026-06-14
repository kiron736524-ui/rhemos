import { convertToModelMessages, streamText, type UIMessage } from 'ai';
import { orchestratorConfig } from '@/agent/orchestrator';

export const runtime = 'nodejs'; // 工具用 node:fs，需 nodejs 运行时
export const maxDuration = 300; // 自省循环可能多轮，放宽超时

export async function POST(req: Request) {
  const { messages }: { messages: UIMessage[] } = await req.json();
  const cfg = await orchestratorConfig();
  const result = streamText({
    ...cfg,
    messages: await convertToModelMessages(messages),
  });
  return result.toUIMessageStreamResponse();
}
