/**
 * scripts/verify-director.ts
 * 计时复现导演 Agent 真实调用路径，定位慢在哪一段。
 * 运行：cd server && npx tsx scripts/verify-director.ts <projectId>
 */
import { config } from '../src/utils/config.js';
import { createDirectorAgent } from '../src/agents/director/director.agent.js';

const projectId = process.argv[2] || 'proj_1793978592398_aslk';
const sessionId = 'chat_1793978592400_6c7698';

function t0(label: string) {
  const start = Date.now();
  return () => console.log(`  [${label}] 耗时 ${((Date.now() - start) / 1000).toFixed(1)}s`);
}

async function main() {
  const doneBuild = t0('createDirectorAgent');
  const agent = createDirectorAgent(projectId, sessionId);
  doneBuild();

  const promptLen = (agent as any).instructions?.length ?? 0;
  console.log(`instructions 长度: ${promptLen} 字符`);

  console.log('\n== stream() 首帧计时 ==');
  const mode = process.argv[3] || 'prepare';
  // 与路由一致：从 ChatMemoryManager 取工作记忆 turns
  const { ChatMemoryManager } = await import('../src/agents/director/memory/chat-memory-manager.js');
  const memoryManager = ChatMemoryManager.getInstance();
  const agentDialogueInput: any = memoryManager.getWorkingTurns(projectId, sessionId, 10, '简单介绍一下你的导演构思，两句话即可');
  if (agentDialogueInput.length === 0 || agentDialogueInput[agentDialogueInput.length - 1].role !== 'user') {
    agentDialogueInput.push({ role: 'user', content: '简单介绍一下你的导演构思，两句话即可' });
  }
  console.log(`记忆 turns: ${agentDialogueInput.length}, 总字符: ${agentDialogueInput.reduce((s: number, t: any) => s + (t.content?.length || 0), 0)}`);
  const start = Date.now();
  const opts: any = { maxSteps: 6 };
  if (mode === 'required') opts.toolChoice = 'required';
  else if (mode === 'twophase') {
    // 阶段 A：强制单步意图决策
    const tA = Date.now();
    const intentRes: any = await agent.generate(
      agentDialogueInput as any,
      {
        toolChoice: 'required',
        maxSteps: 1,
      } as any
    );
    const intentCalls = intentRes.toolCalls || [];
    console.log(`  [A] 意图强制调用耗时 ${((Date.now() - tA) / 1000).toFixed(1)}s, toolCalls: ${intentCalls.length}`);
    for (const c of intentCalls) console.log('    -', c.toolName || c.payload?.toolName, JSON.stringify(c.args ?? c.payload?.args ?? {}).slice(0, 150));
  }
  console.log(`模式: ${mode}`);
  const stream = await agent.stream(
    agentDialogueInput,
    mode === 'twophase' ? { ...opts, toolChoice: 'none' } : opts
  );
  let firstToken = 0;
  let chunks = 0;
  let textLen = 0;
  const typeCount: Record<string, number> = {};
  for await (const chunk of (stream as any).fullStream ?? stream) {
    chunks++;
    typeCount[chunk.type] = (typeCount[chunk.type] || 0) + 1;
    if (!firstToken && (chunk.type === 'text-delta' || chunk.type === 'tool-call')) {
      firstToken = Date.now() - start;
      console.log(`  首个有效帧: ${chunk.type} @ ${((firstToken) / 1000).toFixed(1)}s`);
    }
    if (chunk.type === 'tool-call') console.log(`  [t+${((Date.now()-start)/1000).toFixed(1)}s] tool-call:`, (chunk as any).toolName, JSON.stringify((chunk as any).args ?? {}).slice(0, 120));
    if (chunk.type === 'tool-result') console.log(`  [t+${((Date.now()-start)/1000).toFixed(1)}s] tool-result`);
    if (chunk.type === 'error') console.log('  ❌ error chunk:', JSON.stringify(chunk).slice(0, 300));
    if (Date.now() - start > 120000) { console.log('  ⏱️ 超过 120s，手动中断'); break; }
  }
  console.log('  chunk 类型分布:', JSON.stringify(typeCount));
  console.log(`  总帧数: ${chunks}, 正文字符: ${textLen}`);
  console.log(`  总耗时: ${((Date.now() - start) / 1000).toFixed(1)}s`);
  process.exit(0);
}

main().catch((err) => {
  console.error('❌ 失败:', err?.message || err);
  process.exit(1);
});
