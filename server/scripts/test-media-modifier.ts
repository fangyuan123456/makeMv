// 媒体型微调子工作流验证：character-portrait 四步进度 + mock 渲染
// 隔离副本项目，不动真实项目数据
import fs from 'node:fs';
import path from 'node:path';

const { Workflow } = await import('../src/workflow-engine/index.js');
const { registerPipelineWorkflows } = await import('../src/agents/director/generator/register.js');
const { ProjectStore } = await import('../src/project-store/ProjectStore.js');

const SRC = 'proj_1794014246317_0cta';
const DST = 'proj_mediatest';
const root = path.resolve('data/projects');
const srcDir = path.join(root, SRC);
const dstDir = path.join(root, DST);

fs.rmSync(dstDir, { recursive: true, force: true });
fs.cpSync(srcDir, dstDir, { recursive: true });

const pjPath = path.join(dstDir, 'project.json');
const pj = JSON.parse(fs.readFileSync(pjPath, 'utf-8'));
pj.projectId = DST;
pj.title = '媒体微调轨验证副本';
pj.currentStage = 'character_design';
fs.writeFileSync(pjPath, JSON.stringify(pj, null, 2), 'utf-8');
fs.rmSync(path.join(dstDir, 'chat'), { recursive: true, force: true });
fs.writeFileSync(path.join(dstDir, 'tasks.json'), '[]', 'utf-8');

registerPipelineWorkflows();
const engine = Workflow.getInstance();
const store = ProjectStore.getInstance();

// 注入一套最小可用的角色定妆资产（模拟已生成过）
const mockArtifact = {
  characters: [
    {
      name: '李娜',
      role: '女主角',
      gender: '女',
      age: 28,
      appearance: '短发，眼神锐利，黑色风衣',
      personality: '冷静克制',
      motivation: '找回被窃取的记忆',
      visualPrompt: '电影级特写，短发女性，黑色风衣，冷色调布光',
      imageUrl: 'mock://portrait/lena/v1.png',
      useReference: false,
      history: [],
      isNew: false,
    },
  ],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};
store.setArtifact(DST, 'character_design', mockArtifact);
console.log(`\n[媒体验证] 目标=${DST} 已注入 1 个角色资产`);

const userFeedback = '把她的风衣换成米白色针织衫';
const start = Date.now();
const dispatchRes = await engine.dispatch({
  projectId: DST,
  sessionId: 'test-session',
  workflowKey: 'character-portrait',
  actionType: 'TARGETED_REVISE',
  reason: userFeedback,
  userPrompt: userFeedback,
  parameters: { target: '李娜', userFeedback, isMock: true },
});
const proposalId = dispatchRes.proposal.taskId;
console.log(`[媒体验证] 提案 ${proposalId} 状态=${dispatchRes.proposal.status}`);

let final: any = dispatchRes.proposal;
const trace: string[] = [];
let lastSeen = '';
for (let i = 0; i < 200; i++) {
  const p = JSON.parse(fs.readFileSync(path.join(dstDir, 'tasks.json'), 'utf-8')).find(
    (x: any) => x.taskId === proposalId
  );
  if (p) final = p;
  const pr = final.progress || {};
  const snapshot = `${pr.percent ?? '-'}% | ${(final.progress?.note || final.resultSummary) || '(无阶段文案)'}`;
  if (snapshot !== lastSeen) {
    trace.push(`[${((Date.now() - start) / 1000).toFixed(1)}s] ${final.status} ${snapshot}`);
    lastSeen = snapshot;
  }
  if (final.status && final.status !== 'running' && final.status !== 'pending') break;
  await new Promise((r) => setTimeout(r, 300));
}

console.log(`\n[媒体验证] 终态=${final.status} 耗时=${((Date.now() - start) / 1000).toFixed(1)}s`);
console.log('[媒体验证] 进度轨迹:');
trace.forEach((t) => console.log('[媒体验证] 轨迹 ' + t));
console.log(`[媒体验证] resultSummary=${final.resultSummary}`);

const after = store.getArtifact<any>(DST, 'character_design');
const c = after?.characters?.[0];
console.log(`[媒体验证] 角色数=${after?.characters?.length} 主角=${c?.name}`);
console.log(`[媒体验证] 提示词: ${c?.visualPrompt?.slice(0, 60)}`);
console.log(`[媒体验证] 历史版本数=${c?.history?.length ?? 0} 图片=${c?.imageUrl}`);

process.exit(0);
