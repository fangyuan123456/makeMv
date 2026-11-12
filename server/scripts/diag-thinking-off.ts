/**
 * scripts/diag-thinking-off.ts
 * 验证 LLMProvider 是否真的把 enable_thinking=false 注入到请求体
 */
const origFetch = globalThis.fetch;
let captured: string | null = null;

globalThis.fetch = (async (input: any, init?: any) => {
  if (init?.body && typeof init.body === 'string' && String(input).includes('chat/completions')) {
    captured = init.body;
  }
  return origFetch(input, init);
}) as typeof fetch;

const { LLMProvider } = await import('../src/llm/provider.js');
const { generateText } = await import('ai');

const t0 = Date.now();
const res = await generateText({
  model: LLMProvider.getModel(),
  prompt: '只回答两个字：收到',
  maxTokens: 20,
});

console.log('耗时:', Date.now() - t0, 'ms | 文本:', res.text.trim().slice(0, 30));
if (captured) {
  const body = JSON.parse(captured);
  console.log('请求体含 enable_thinking:', 'enable_thinking' in body, '| 值:', body.enable_thinking);
} else {
  console.log('未捕获到请求体（可能走了缓存或不同端点）');
}
process.exit(0);
