// 标准轨回归：确认底座新增的「执行中」上报没有破坏原有三步进度广播
import fs from 'node:fs';
import path from 'node:path';

const { Workflow } = await import('../src/workflow-engine/index.js');
const { registerPipelineWorkflows } = await import('../src/agents/director/orchestration/register.js');

const SRC = 'proj_1794014246317_0cta';
const DST = 'proj_standard_test';
const root = path.resolve('data/projects');
const srcDir = path.join(root, SRC);
const dstDir = path.join(root, DST);

fs.rmSync(dstDir, { recursive: true, force: true });
fs.cpSync(srcDir, dstDir, { recursive: true });
const pjPath = path.join(dstDir, 'project.json');
const pj = JSON.parse(fs.readFileSync(pjPath, 'utf-8'));
pj.projectId = DST;
pj.title = '标准轨进度回归副本';
fs.writeFileSync(pjPath, JSON.stringify(pj, null, 2), 'utf-8');
fs.rmSync(path.join(dstDir, 'chat'), { recursive: true, force: true });
fs.writeFileSync(path.join(dstDir, 'tasks.json'), '[]', 'utf-8');

registerPipelineWorkflows();
const engine = Workflow.getInstance();

console.log('[回归] 启动标准轨全量推演 (story-bible PROCEED_STAGE)');
const start = Date.now();
const { proposal } = await engine.dispatch({
  projectId: DST,
  sessionId: 'test-session',
  workflowKey: 'story-bible',
  actionType: 'PROCEED_STAGE',
  reason: '标准轨进度回归',
  requireConfirmation: false,
});

const trace: string[] = [];
let lastSeen = '';
let final: any = proposal;
for (let i = 0; i < 400; i++) {
  const p = JSON.parse(fs.readFileSync(path.join(dstDir, 'tasks.json'), 'utf-8')).find(
    (x: any) => x.taskId === proposal.taskId
  );
  if (p) final = p;
  const pr = final.progress || {};
  const snap = `${pr.current ?? '-'}/${pr.total ?? '-'} ${pr.percent ?? '-'}% | ${(final.progress?.note || final.resultSummary) || '(无)'}`;
  if (snap !== lastSeen) {
    trace.push(`[${((Date.now() - start) / 1000).toFixed(1)}s] ${final.status} ${snap}`);
    lastSeen = snap;
  }
  if (final.status && final.status !== 'running' && final.status !== 'pending') break;
  await new Promise((r) => setTimeout(r, 400));
}

console.log(`[回归] 终态=${final.status} 耗时=${((Date.now() - start) / 1000).toFixed(1)}s`);
trace.forEach((t) => console.log('[回归] 轨迹 ' + t));
process.exit(0);
