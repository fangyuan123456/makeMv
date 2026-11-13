import { streamRouterDialogue } from '../src/agents/router/router.agent.js';
import { buildWorkingDialogueTurns } from '../src/mastra-compat/index.js';

async function main() {
  const projectId = 'proj_mwd6hwti_cy5j';
  const message = '你好';
  const messages = buildWorkingDialogueTurns([], message);

  console.log(`[测试] 发送: "${message}"`);
  const t0 = Date.now();
  const result = streamRouterDialogue({ projectId, messages });

  let firstTokenTime = 0;
  let chunkCount = 0;
  let totalText = '';

  for await (const chunk of result.textStream) {
    chunkCount++;
    totalText += chunk;
    if (chunkCount === 1) {
      firstTokenTime = Date.now() - t0;
      console.log(`[首字延迟] ${firstTokenTime}ms -> "${chunk}"`);
    }
  }

  const totalTime = Date.now() - t0;
  console.log(`[完成] 总耗时=${totalTime}ms | chunks=${chunkCount} | 文本长度=${totalText.length}`);
  console.log(`[回复内容]:\n${totalText}`);
  
  const steps = (await result.steps) as any[];
  console.log(`[Steps] 数量=${steps.length}`);
  for (const [i, s] of steps.entries()) {
    console.log(`  step ${i}: finish=${s.finishReason}, toolCalls=${(s.toolCalls || []).map((tc: any) => tc.toolName).join(', ')}`);
  }
}

main().catch(console.error);
