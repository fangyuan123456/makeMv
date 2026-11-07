/**
 * scripts/verify-storybible.ts
 * 复现 story-bible 子工作流执行，暴露被吞掉的真实失败原因。
 * 运行：cd server && npx tsx scripts/verify-storybible.ts [projectId]
 */
import { ProjectStore } from '../src/project-store/ProjectStore.js';
import { storyBibleSubWorkflow } from '../src/agents/director/generator/steps/story-bible/story-bible.workflow.js';

async function main() {
  const store = ProjectStore.getInstance();
  let projectId = process.argv[2];
  if (!projectId) {
    projectId = `test_repro_${Date.now()}`;
    store.saveProject({
      projectId,
      title: '复现测试项目',
      status: 'idle' as any,
      currentStage: 'character_design' as any,
      stageArtifacts: {},
      history: [],
      meta: {
        idea: '赛博朋克悬疑，记忆神偷潜入脑机财阀调查意识篡改案',
        style: '电影质感，写实光影',
        videoRatio: '16:9',
        videoResolution: '720P' as const,
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    } as any);
    console.log(`已创建测试项目: ${projectId}`);
  }

  console.log('== 开始执行 story-bible 子工作流 ==');
  const start = Date.now();
  try {
    const output = await (storyBibleSubWorkflow as any).execute({
      inputData: {
        projectId,
        targetSkill: 'story-bible',
        feedback: '赛博朋克悬疑，记忆神偷潜入脑机财阀调查意识篡改案',
      },
    });
    console.log(`总耗时 ${((Date.now() - start) / 1000).toFixed(1)}s`);
    console.log('== 输出诊断 ==');
    console.log('output keys:', output && typeof output === 'object' ? Object.keys(output) : typeof output);
    if (output && typeof output === 'object' && ('status' in output || 'error' in output)) {
      console.log('!! 疑似 Mastra run 原始结果 (而非步骤上下文) —— 即失败被吞的证据');
      console.log('status:', (output as any).status);
      console.log('error:', JSON.stringify((output as any).error, null, 2)?.slice(0, 1500));
    }
    console.log('lastSummary:', (output as any)?.lastSummary);
    console.log('toolResult 存在:', Boolean((output as any)?.toolResult));

    const artifact = store.getArtifact<any>(projectId, 'narrative_design');
    console.log('黑板 narrative_design 工件:', artifact ? `已落盘, 角色 ${artifact.characters?.length} 位` : '❌ 缺失');
  } catch (err: any) {
    console.error('❌ 工作流抛出异常:', err?.message || err);
    if (err?.stack) console.error(err.stack.split('\n').slice(0, 8).join('\n'));
  }
  process.exit(0);
}

main();
