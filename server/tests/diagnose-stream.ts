import { streamRouterDialogue } from '../src/agents/router/router.agent.js';

async function main() {
  console.log('Testing streamRouterDialogue with real LLM...');
  const start = Date.now();
  const streamResult = streamRouterDialogue({
    projectId: 'test_diag',
    messages: [{ role: 'user', content: '你好' }],
  });

  console.log('Iterating textStream...');
  let chunkCount = 0;
  for await (const chunk of streamResult.textStream) {
    chunkCount++;
    console.log(`[+${Date.now() - start}ms] chunk #${chunkCount}: "${chunk}"`);
  }

  console.log(`textStream finished, total chunks: ${chunkCount}`);
  const steps = await streamResult.steps;
  console.log(`Total steps: ${steps.length}`);
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    console.log(`Step ${i}: finishReason=${s.finishReason}, text="${s.text}", toolCalls=${s.toolCalls.length}`);
    for (const tc of s.toolCalls) {
      console.log(`  ToolCall: ${tc.toolName}, args=${JSON.stringify(tc.args)}`);
    }
  }
}

main().catch((err) => {
  console.error('Error:', err);
});
