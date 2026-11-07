// 隔离测试：全新导演 Agent + 单轮推进消息，观察 Mastra 流式是否产生原生 tool call
process.env.NODE_ENV = 'development';
const { createDirectorAgent } = await import('../src/agents/director/director.agent.js');
const agent = createDirectorAgent();
for (let i = 1; i <= 3; i++) {
  const stream = await agent.stream(
    [{ role: 'user', content: '好，开始生成故事圣经吧' }],
    { maxSteps: 5 }
  );
  const types = {};
  let text = '';
  for await (const chunk of stream.fullStream) {
    types[chunk.type] = (types[chunk.type] || 0) + 1;
    if (chunk.type === 'text-delta') text += chunk.payload?.text ?? '';
  }
  const calls = await stream.toolCalls;
  console.log(`第${i}次: toolCalls=${Array.isArray(calls) ? calls.length : 'N/A'} 帧类型=${JSON.stringify(types)}`);
  console.log(`  正文尾部: ${JSON.stringify(text.slice(-120))}`);
}
process.exit(0);
