// 决定性实验：Mastra + prepareStep 打本地 mock（永远秒回）
// 若挂死 → Mastra 客户端问题；若正常 → 上游(SiliconFlow)问题
import { Agent } from '@mastra/core/agent';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

const MODEL = {
  providerId: 'openai',
  modelId: 'mock-model',
  url: 'http://127.0.0.1:9911/v1',
  apiKey: 'test-key',
} as any;

const tool = createTool({
  id: 'emit_director_intent',
  description: '记录导演意图决策',
  inputSchema: z.object({ action: z.string() }),
  execute: async () => ({ success: true, message: '意图已记录' }),
});

const agent = new Agent({
  id: 'mock-agent',
  name: 'mock-agent',
  instructions: '你是测试导演。',
  model: MODEL,
  tools: { emit_director_intent: tool },
});

const mode = process.argv[2] || 'plain';
const opts: any = { maxSteps: 5 };
if (mode === 'prepare') {
  opts.prepareStep = ({ stepNumber }: any) =>
    stepNumber === 0 ? { toolChoice: 'required' as const } : { toolChoice: 'auto' as const };
}
console.log(`== 模式: ${mode} ==`);

const start = Date.now();
const timeout = setTimeout(() => {
  console.log(`❌ 120s 未完成 → 客户端挂死实锤`);
  process.exit(2);
}, 120000);

const stream = await agent.stream([{ role: 'user', content: '开始生成故事圣经' }] as any, opts);
let text = '';
for await (const chunk of (stream as any).fullStream) {
  if (chunk.type === 'text-delta') text += chunk.payload?.text ?? '';
  if (chunk.type === 'error') console.log('error chunk:', JSON.stringify(chunk).slice(0, 200));
}
const calls = await stream.toolCalls;
clearTimeout(timeout);
console.log(`✅ 完成，耗时 ${((Date.now() - start) / 1000).toFixed(1)}s, toolCalls=${JSON.stringify(calls)?.slice(0, 150)}, 正文="${text}"`);
process.exit(0);
