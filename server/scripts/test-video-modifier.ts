// 视频型微调子工作流验证：video-production 命中互斥分支 + 四段进度
// 隔离副本项目，不动真实项目数据
import fs from 'node:fs';
import path from 'node:path';

const { Workflow } = await import('../src/workflow-engine/index.js');
const { registerPipelineWorkflows } = await import('../src/agents/director/orchestration/register.js');
const { ProjectStore } = await import('../src/project-store/ProjectStore.js');

const SRC = 'proj_1794014246317_0cta';
const DST = 'proj_videotest';
const root = path.resolve('data/projects');
const srcDir = path.join(root, SRC);
const dstDir = path.join(root, DST);

fs.rmSync(dstDir, { recursive: true, force: true });
fs.cpSync(srcDir, dstDir, { recursive: true });

const pjPath = path.join(dstDir, 'project.json');
const pj = JSON.parse(fs.readFileSync(pjPath, 'utf-8'));
pj.projectId = DST;
pj.title = '视频微调轨验证副本';
pj.currentStage = 'video_production';
fs.writeFileSync(pjPath, JSON.stringify(pj, null, 2), 'utf-8');
fs.rmSync(path.join(dstDir, 'chat'), { recursive: true, force: true });
fs.writeFileSync(path.join(dstDir, 'tasks.json'), '[]', 'utf-8');

registerPipelineWorkflows();
const engine = Workflow.getInstance();
const store = ProjectStore.getInstance();

// 注入一套最小可用的视频切片资产（模拟已生成过）
store.setArtifact(DST, 'video_production', {
  clips: [
    {
      clipId: 'clip_1',
      shotId: 'shot_1',
      videoUrl: 'mock://clip/shot_1/v1.mp4',
      durationSec: 3,
      resolution: '720P',
      ratio: '16:9',
      status: 'rendered',
    },
  ],
  totalClips: 1,
  completedClips: 1,
  totalDurationSec: 3,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
} as any);
console.log(`\n[视频验证] 目标=${DST} 已注入 1 个视频切片`);

const userFeedback = '这个镜头改成一镜到底的缓慢推近';
const start = Date.now();
const dispatchRes = await engine.dispatch({
  projectId: DST,
  sessionId: 'test-session',
  workflowKey: 'video-production',
  actionType: 'TARGETED_REVISE',
  reason: userFeedback,
  userPrompt: userFeedback,
  parameters: { target: 'shot_1', userFeedback, isMock: true },
});
const proposalId = dispatchRes.proposal.taskId;
console.log(`[视频验证] 提案 ${proposalId} 状态=${dispatchRes.proposal.status}`);

let final: any = dispatchRes.proposal;
const trace: string[] = [];
let lastSeen = '';
for (let i = 0; i < 300; i++) {
  const p = JSON.parse(fs.readFileSync(path.join(dstDir, 'tasks.json'), 'utf-8')).find(
    (x: any) => x.taskId === proposalId
  );
  if (p) final = p;
  const pr = final.progress || {};
  const snapshot = `${pr.percent ?? '-'}% (${pr.current ?? '-'}/${pr.total ?? '-'}) | ${
    (final.progress?.note || final.resultSummary) || '(无阶段文案)'
  }`;
  if (snapshot !== lastSeen) {
    trace.push(`[${((Date.now() - start) / 1000).toFixed(1)}s] ${final.status} ${snapshot}`);
    lastSeen = snapshot;
  }
  if (final.status && final.status !== 'running' && final.status !== 'pending') break;
  await new Promise((r) => setTimeout(r, 300));
}

console.log(`\n[视频验证] 终态=${final.status} 耗时=${((Date.now() - start) / 1000).toFixed(1)}s`);
console.log('[视频验证] 进度轨迹:');
trace.forEach((t) => console.log('[视频验证] 轨迹 ' + t));
console.log(`[视频验证] resultSummary=${final.resultSummary}`);

const after = store.getArtifact<any>(DST, 'video_production');
console.log(`[视频验证] 切片数=${after?.clips?.length} 首片=${after?.clips?.[0]?.clipId}`);
console.log(`[视频验证] videoUrl=${after?.clips?.[0]?.videoUrl}`);

process.exit(0);
