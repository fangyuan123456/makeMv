const { createDirectorAgent } = await import('../src/agents/director/director.agent.js');
const projectId = 'proj_1793978592398_aslk';
const agent = createDirectorAgent(projectId, undefined); // 有黑板上下文，无记忆历史
for (let i = 1; i <= 3; i++) {
  const stream = await agent.stream([{ role: 'user', content: '好，开始生成故事圣经吧' }] as any, { maxSteps: 5 });
  let text = '';
  for await (const chunk of stream.fullStream) {
    if (chunk.type === 'text-delta') text += chunk.payload?.text ?? '';
  }
  const calls = await stream.toolCalls;
  console.log(`第${i}次: toolCalls=${Array.isArray(calls) ? calls.length : 'N/A'}`);
  if (!calls || calls.length === 0) console.log(`  正文尾部: ${JSON.stringify(text.slice(-80))}`);
}
process.exit(0);
