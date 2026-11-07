const { createDirectorAgent } = await import('../src/agents/director/director.agent.js');
const { ChatMemoryManager } = await import('../src/agents/director/memory/chat-memory-manager.js');
const projectId = process.argv[2] || 'proj_1793978592398_aslk';
const sessionId = process.argv[3] || 'chat_1793978592400_6c7698';
const agent = createDirectorAgent(projectId, sessionId);
const memory = ChatMemoryManager.getInstance();
const turns = memory.getWorkingTurns(projectId, sessionId, 10);
const input = [...turns, { role: 'user', content: '好，开始生成故事圣经吧' }];
console.log('记忆轮数:', turns.length);
for (let i = 1; i <= 4; i++) {
  const stream = await agent.stream(input as any, { maxSteps: 5 });
  let text = '';
  for await (const chunk of stream.fullStream) {
    if (chunk.type === 'text-delta') text += chunk.payload?.text ?? '';
  }
  const calls = await stream.toolCalls;
  console.log(`第${i}次: toolCalls=${Array.isArray(calls) ? calls.length : 'N/A'}`);
  if (!calls || calls.length === 0) console.log(`  正文尾部: ${JSON.stringify(text.slice(-100))}`);
}
process.exit(0);
