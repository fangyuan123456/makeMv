// 真实环境复测 prepareStep：真实 Agent + 真实上游，验证"第0步required+后续auto"
const { createDirectorAgent } = await import('../src/agents/director/director.agent.js');
const agent = createDirectorAgent();
const opts: any = {
  maxSteps: 5,
  prepareStep: ({ stepNumber }: any) =>
    stepNumber === 0 ? { toolChoice: 'required' as const } : { toolChoice: 'auto' as const },
};
for (let i = 1; i <= 10; i++) {
  const start = Date.now();
  const stream = await agent.stream([{ role: 'user', content: '好，开始生成故事圣经吧' }] as any, opts);
  let text = '';
  const timer = setTimeout(() => {
    console.log(`第${i}次: ❌ 90s 未完成 → 挂死复现`);
    process.exit(2);
  }, 90000);
  for await (const chunk of (stream as any).fullStream) {
    if (chunk.type === 'text-delta') text += chunk.payload?.text ?? '';
  }
  const calls: any[] = await stream.toolCalls;
  clearTimeout(timer);
  console.log(`第${i}次: ✅ ${((Date.now() - start) / 1000).toFixed(1)}s toolCalls=${calls?.length ?? 'N/A'} 正文长度=${text.length}`);
}
process.exit(0);
