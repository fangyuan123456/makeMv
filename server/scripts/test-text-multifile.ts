// 文本轨跨文件验证：三份文本产物同时在场时，一次改名能否同步落地、下游会不会被误删
import fs from 'node:fs';
import path from 'node:path';

const { Workflow } = await import('../src/workflow-engine/index.js');
const { registerPipelineWorkflows } = await import('../src/agents/director/orchestration/register.js');

const SRC = 'proj_1794014246317_0cta';
const DST = 'proj_texmulti';
const root = path.resolve('data/projects');
const srcDir = path.join(root, SRC);
const dstDir = path.join(root, DST);

fs.rmSync(dstDir, { recursive: true, force: true });
fs.cpSync(srcDir, dstDir, { recursive: true });

const pjPath = path.join(dstDir, 'project.json');
const pj = JSON.parse(fs.readFileSync(pjPath, 'utf-8'));
pj.projectId = DST;
pj.title = '文本三件套验证副本';
fs.rmSync(path.join(dstDir, 'chat'), { recursive: true, force: true });
fs.writeFileSync(path.join(dstDir, 'tasks.json'), '[]', 'utf-8');

const now = new Date().toISOString();

// 合成一份分场剧本与一份分镜，内容里明确引用女主角，用于验证跨文件同步
const scriptArt = {
  title: pj.title,
  totalScenes: 1,
  createdAt: now,
  scenes: [
    {
      nodeId: 'node_1',
      act: 1,
      sceneTitle: '雨夜巷口',
      location: '老城巷口',
      timeOfDay: '雨夜',
      actionSummary: '李娜独自走进巷口，雨水打湿了她的外套，她回头看了一眼。',
      interactionMoment: '李娜决定是否继续深入',
      dialogues: [
        { speaker: '李娜', line: '谁在那儿？', parenthetical: '压低声音' },
      ],
    },
  ],
};
const sbArt = {
  title: pj.title,
  totalShots: 1,
  estimatedTotalDurationSec: 4,
  createdAt: now,
  shots: [
    {
      shotId: 'shot_1',
      nodeId: 'node_1',
      shotScale: '中景',
      cameraMovement: '缓慢推进',
      durationSec: 4,
      visualComposition: '雨夜巷口，李娜站在昏黄路灯下回头，雨水在光柱中可见。',
    },
  ],
};

fs.mkdirSync(path.join(dstDir, 'script'), { recursive: true });
fs.mkdirSync(path.join(dstDir, 'storyboard'), { recursive: true });
fs.writeFileSync(path.join(dstDir, 'script', 'scene_scripts.json'), JSON.stringify(scriptArt, null, 2), 'utf-8');
fs.writeFileSync(path.join(dstDir, 'storyboard', 'storyboard.json'), JSON.stringify(sbArt, null, 2), 'utf-8');

pj.stageArtifacts = pj.stageArtifacts || {};
pj.stageArtifacts['scene_script'] = scriptArt;
pj.stageArtifacts['storyboard'] = sbArt;
fs.writeFileSync(pjPath, JSON.stringify(pj, null, 2), 'utf-8');

registerPipelineWorkflows();
const engine = Workflow.getInstance();

const userFeedback = '把女主角「李娜」整体改名为「林晚」，三份产物里对她的称呼必须保持同步一致';
console.log(`\n[验证] 目标=${DST} 指令="${userFeedback}"`);

const start = Date.now();
const dispatchRes = await engine.dispatch({
  projectId: DST,
  sessionId: 'test-session',
  workflowKey: 'story-bible',
  actionType: 'TARGETED_REVISE',
  reason: userFeedback,
  userPrompt: userFeedback,
  parameters: { target: '李娜', userFeedback },
});
const proposalId = dispatchRes.proposal.taskId;

let final: any = dispatchRes.proposal;
for (let i = 0; i < 200; i++) {
  const p = JSON.parse(fs.readFileSync(path.join(dstDir, 'tasks.json'), 'utf-8')).find(
    (x: any) => x.taskId === proposalId
  );
  if (p) final = p;
  if (final.status && final.status !== 'running' && final.status !== 'pending') break;
  await new Promise((r) => setTimeout(r, 300));
}

console.log(`\n[验证] 终态=${final.status} 耗时=${((Date.now() - start) / 1000).toFixed(1)}s`);
console.log(`[验证] resultSummary=${final.resultSummary}`);
if (final.error) console.log(`[验证] error=${final.error}`);

const bible = fs.readFileSync(path.join(dstDir, 'narrative', 'story_bible.json'), 'utf-8');
const script = fs.readFileSync(path.join(dstDir, 'script', 'scene_scripts.json'), 'utf-8');
const sb = fs.readFileSync(path.join(dstDir, 'storyboard', 'storyboard.json'), 'utf-8');
const afterPj = JSON.parse(fs.readFileSync(pjPath, 'utf-8'));
const keys = Object.keys(afterPj.stageArtifacts || {});

let pass = 0;
let fail = 0;
function check(label: string, cond: boolean, extra?: string) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${label}`);
  } else {
    fail++;
    console.log(`  ✗ ${label}${extra ? ' → ' + extra : ''}`);
  }
}

console.log('\n[验证] 断言');
check('执行成功', final.status === 'succeeded', final.status);
check('故事圣经已改名', bible.includes('林晚') && !bible.includes('李娜'));
check('分场剧本已同步改名', script.includes('林晚') && !script.includes('李娜'));
check('分镜已同步改名', sb.includes('林晚') && !sb.includes('李娜'));
check('下游产物未被误删(分镜仍在)', keys.includes('storyboard'), keys.join(','));
check('下游剧本产物仍在', keys.includes('scene_script'), keys.join(','));
check('剧本 JSON 合法', (() => { try { JSON.parse(script); return true; } catch { return false; } })());
check('分镜 JSON 合法', (() => { try { JSON.parse(sb); return true; } catch { return false; } })());

console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
