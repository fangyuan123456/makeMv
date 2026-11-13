/**
 * 一次性诊断：用失败项目已落盘的上游产物重放 derive-branches，
 * 打印被 workflow 吞掉的模型原始响应与 Zod 校验错误。
 * 只读，不写产物、不启动流水线。
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tasks = JSON.parse(
  fs.readFileSync(
    path.join(serverDir, 'data/projects/proj_mwd7ssc9_g3kn/tasks.json'),
    'utf-8'
  )
);
const steps = tasks[0].result.completedSteps;
const title: string = steps['write-spine-script'].title;
const spineScript: string = steps['write-spine-script'].spineScript;
const clips: any[] = steps['slice-interactions'].clips;

const { stripNullFieldsFromJsonText } = await import('../src/mastra-compat/jsonHealing.js');

// 零模型断言：用上次失败时抓到的原始响应形态验证 null 归一化确实生效
const sample = JSON.stringify({
  branchTitle: '锈门之后',
  narrativeText: '正文',
  resolutionType: 'REJOIN',
  targetClipId: 'S8',
  rejoinConsequence: '代价',
  endingType: null,
  endingTitle: null,
  verdict: null,
  rewindTargetClipId: null,
});
const cleanedSample = stripNullFieldsFromJsonText(sample);
console.log(
  `[Diag] null 归一化: changed=${cleanedSample.changed}, 剩余字段=${Object.keys(
    JSON.parse(cleanedSample.text!)
  ).join(',')}`
);

const { createBranchDramatistAgent } = await import(
  '../src/agents/planner/steps/branch-derivation/step.js'
);
const { runTopologyBranchDerivation } = await import(
  '../src/agents/planner/steps/branch-derivation/topology-runner.js'
);

console.log(
  `[Diag] 输入: title=${title}, clips=${clips.length}, CHOICE切口=${clips.filter((c) => c.interaction?.category === 'CHOICE').length}`
);

const t0 = Date.now();
try {
  const branches = await runTopologyBranchDerivation(
    title,
    clips,
    createBranchDramatistAgent(),
    spineScript
  );
  console.log(`[Diag] 成功: ${branches.length} 条分支, 耗时 ${Date.now() - t0}ms`);
} catch (e: any) {
  console.log(`[Diag] 失败, 耗时 ${Date.now() - t0}ms`);
  console.log('name =', e?.name);
  console.log('message =', e?.message);
  console.log('text =', e?.text);
  console.log(
    'cause =',
    e?.cause?.issues ? JSON.stringify(e.cause.issues, null, 2) : e?.cause?.message || String(e?.cause)
  );
  console.log('finishReason =', e?.finishReason);
  console.log('keys =', Object.keys(e || {}));
}
