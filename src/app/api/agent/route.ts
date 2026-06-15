import { convertToModelMessages, streamText, type UIMessage } from 'ai';
import { orchestratorConfig } from '@/agent/orchestrator';

export const runtime = 'nodejs'; // 工具用 node:fs，需 nodejs 运行时
export const maxDuration = 600; // best-of-N + revise 多张生图，放宽超时（生产部署需对应平台上限）

export async function POST(req: Request) {
  const { messages, projectId }: { messages: UIMessage[]; projectId?: string } = await req.json();
  const cfg = await orchestratorConfig();
  const result = streamText({
    ...cfg,
    messages: await convertToModelMessages(messages),
    // 把 projectId 注入工具上下文，实现项目隔离（工具用 projectIdFromContext 读取）
    experimental_context: { projectId: projectId ?? 'default' },
  });
  return result.toUIMessageStreamResponse();
}
