// 双轨分流验证：TARGETED_REVISE 是否真的走 manifest.modifier（delta patch）而不是全量 sub-workflow
// 隔离副本项目，不动真实项目数据
import fs from 'node:fs';
import path from 'node:path';

const { Workflow } = await import('../src/workflow-engine/index.js');
const { registerPipelineWorkflows } = await import('../src/agents/director/generator/register.js');
const { ProjectStore } = await import('../src/project-store/ProjectStore.js');

const SRC = 'proj_1794014246317_0cta';
const DST = 'proj_patchtest';
const root = path.resolve('data/projects');
const srcDir = path.join(root, SRC);
const dstDir = path.join(root, DST);

fs.rmSync(dstDir, { recursive: true, force: true });
fs.cpSync(srcDir, dstDir, { recursive: true });

// 重写项目 id，清空历史提案与会话，保留 narrative 产物
const pjPath = path.join(dstDir, 'project.json');
const pj = JSON.parse(fs.readFileSync(pjPath, 'utf-8'));
pj.projectId = DST;
pj.title = '微调轨验证副本';
fs.writeFileSync(pjPath, JSON.stringify(pj, null, 2), 'utf-8');
fs.rmSync(path.join(dstDir, 'chat'), { recursive: true, force: true });
fs.writeFileSync(path.join(dstDir, 'tasks.json'), '[]', 'utf-8');

const before = JSON.parse(fs.readFileSync(path.join(dstDir, 'narrative', 'story_bible.json'), 'utf-8'));

registerPipelineWorkflows();
const engine = Workflow.getInstance();
const store = ProjectStore.getInstance();

const userFeedback = '把女主角年龄从 28 岁改成 29 岁';
console.log(`\n[验证] 目标=${DST} 指令="${userFeedback}"`);

const start = Date.now();
const dispatchRes = await engine.dispatch({
  projectId: DST,
  sessionId: 'test-session',
  workflowKey: 'story-bible',
  actionType: 'TARGETED_REVISE',
  reason: userFeedback,
  userPrompt: userFeedback,
  parameters: { target: '李娜(女主角（记忆神偷）)', userFeedback },
});
const proposalId = dispatchRes.proposal.taskId;
console.log(`[验证] 提案 ${proposalId} 状态=${dispatchRes.proposal.status}（TARGETED_REVISE 应直通执行）`);

// 轮询到终态，同时记录进度轨迹（验证 step 化后进度条是否有真实阶段边界）
let final: any = dispatchRes.proposal;
const trace: string[] = [];
let lastSeen = '';
for (let i = 0; i < 120; i++) {
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

const elapsed = ((Date.now() - start) / 1000).toFixed(1);
console.log(`\n[验证] 终态=${final.status} 耗时=${elapsed}s`);
console.log('[验证] 进度轨迹:');
trace.forEach((t) => console.log('[验证] 轨迹 ' + t));
console.log(`[验证] resultSummary=${final.resultSummary}`);
console.log(`[验证] progress=${JSON.stringify(final.progress)} | lastMessage=${(final.progress?.note || final.resultSummary) || ''}`);

// 产物差异：只有 age 变 = delta patch 生效；大面积变化 = 全量重写
const afterPath = path.join(dstDir, 'narrative', 'story_bible.json');
const after = JSON.parse(fs.readFileSync(afterPath, 'utf-8'));
const diffPaths: string[] = [];
function walk(a: any, b: any, p = ''): void {
  if (typeof a !== typeof b || Array.isArray(a) !== Array.isArray(b)) {
    diffPaths.push(p || '(root)');
    return;
  }
  if (a && typeof a === 'object') {
    const keys = new Set([...Object.keys(a), ...Object.keys(b || {})]);
    for (const k of keys) walk(a[k], b?.[k], p ? `${p}.${k}` : k);
  } else if (a !== b) {
    diffPaths.push(`${p}: ${String(a).slice(0, 40)} → ${String(b).slice(0, 40)}`);
  }
}
walk(before, after);
console.log(`[验证] 字段差异数=${diffPaths.length}`);
diffPaths.slice(0, 12).forEach((d) => console.log('   · ' + d));
const heroBefore = before.characters?.[0];
const heroAfter = after.characters?.[0];
console.log(`[验证] 主角: ${heroBefore?.name}/${heroBefore?.age} → ${heroAfter?.name}/${heroAfter?.age} (gender ${heroBefore?.gender}→${heroAfter?.gender})`);
console.log(`[验证] 文件大小: ${fs.statSync(path.join(srcDir, 'narrative', 'story_bible.json')).size} → ${fs.statSync(afterPath).size}`);

process.exit(0);
