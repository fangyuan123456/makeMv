import { StoryboardAgent } from '../server/dist/agents/storyboard/agent.js';
import { dispatchApprovedIntent } from '../server/dist/agents/runtime/task-events.js';
import { ProjectStore } from '../server/dist/project-store/ProjectStore.js';
import { safeReadJsonSync } from '../server/dist/utils/atomicFile.js';
import path from 'node:path';

async function main() {
  const projectId = 'proj_1795370334832_mzzw';
  const clipId = 'c1';
  const sessionId = `storyboard_${clipId}`;

  console.log(`========== 1. 启动真实 StoryboardAgent (${sessionId}) ==========`);
  const agent = new StoryboardAgent({ projectId, clipId, sessionId });

  console.log('\n========== 2. 向分镜 Agent 发送指令：升级为视听演绎剧本 ==========');
  const userPrompt = '请将第 1 幕《归乡夜忌》的故事剧本正式升级为导演视听演绎剧本。注意：按戏剧场景自然展开、不可把整幕混成单一时空，必须完整保留所有角色对话对白、动作与现场拟音，杜绝粗暴压缩。';

  let streamedText = '';
  const result = await agent.stream({
    message: userPrompt,
    onTextChunk: (chunk) => {
      streamedText += chunk;
      process.stdout.write(chunk);
    },
  });

  console.log('\n\n========== 3. 检查 Agent 决策与提案 ==========');
  console.log('Action:', result.intent?.action);
  console.log('Tool:', result.intent?.tool);
  console.log('Title:', result.intent?.title);
  console.log('Params:', JSON.stringify(result.intent?.params, null, 2));

  if (result.intent?.action === 'propose' && result.messageId) {
    console.log(`\n========== 4. 模拟创作者点击【批准执行】(MessageId: ${result.messageId}) ==========`);
    await dispatchApprovedIntent(agent, {
      messageId: result.messageId,
      intent: {
        action: 'approve',
        tool: result.intent.tool,
        title: result.intent.title,
        params: result.intent.params,
        operations: result.intent.operations,
      },
    });

    console.log('批准已派发，等待任务执行及自动落盘...');
  } else {
    console.log('Agent 未发起 propose 提案，当前返回:', result);
  }
}

main().catch((err) => {
  console.error('执行异常:', err);
  process.exit(1);
});
