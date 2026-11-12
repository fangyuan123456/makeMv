/**
 * tests/run-real-project-to-data-store.ts
 * 运行一个全新的真实项目，全链路跑完 Step 1 -> Step 4，并通过 ProjectStore 完整持久化到 server/data/projects/<projectId>
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { ProjectStore } from '../src/project-store/ProjectStore.js';
import {
  executePlannerSpineScript,
  executePlannerSliceInteractions,
  executePlannerDeriveBranches,
  executePlannerPrdSynthesis,
  formatClipsToMarkdown,
  formatBranchesToMarkdown,
  formatGddPrdToMarkdown,
} from '../src/agents/planner/index.js';

async function runRealProject() {
  const projectId = `proj_interactive_${Date.now()}`;
  console.log(`=== [启动新项目] Project ID: ${projectId} ===`);

  const store = ProjectStore.getInstance();
  const project = store.getProject(projectId);
  project.meta.title = '雾港博弈：最后的引渡人';
  project.meta.genre = '赛博朋克 / 谍战博弈 / 竖屏互动短剧';
  store.saveProject(project);

  const userPrompt = `
请创作一部赛博朋克风格的谍战博弈短剧《雾港博弈：最后的引渡人》：
【核心人设】：
男主林烬（表面是旧霓虹街区的机械维修工，实际是反抗军代号“引渡人”的地下交通员，肺部植入了残次义体需要定期注射滤液）；
女主薇拉（公司治安局特别调查官，同时也是林烬三年前以为死于空难的同门师妹，手持神经扫描仪，敌友莫辨）；
【主干核心危机】：
新九龙雨夜，公司戒严。林烬必须在黎明前破译植入在自己机械肺叶内的微缩神经密钥，并避开薇拉的层层盘查与扫描，将密钥安全上传至地下引渡站。
【基调】：
霓虹雨夜、机油与铁锈味、高压心跳博弈、绝望中的人性的微光、严密的因果闭环。
`;

  // === STEP 1: 黄金主干剧本 ===
  console.log('>>> [Step 1] 正在推演黄金主干剧本 (HE 黄金通关路线)...');
  const step1 = await executePlannerSpineScript({ userPrompt });
  console.log(`[Step 1 完成] 《${step1.title}》 | 正文 ${step1.spineScript.length} 字`);

  // === STEP 2: 互动切口与分幕拆分 ===
  console.log('>>> [Step 2] 正在拆分纯结构化视听片段与互动切口 (Clips)...');
  const step2 = await executePlannerSliceInteractions({ spineScript: step1.spineScript });
  console.log(`[Step 2 完成] 拆分为 ${step2.clips.length} 个视听演播片段`);

  // === STEP 3: 分支剧本推演 (Max-n 拓扑优先队列) ===
  console.log('>>> [Step 3] 正在执行逆向拓扑分支推演 (落实因果守恒与 BE 绝命死局)...');
  const step3 = await executePlannerDeriveBranches({
    title: step1.title,
    clips: step2.clips,
  });
  console.log(`[Step 3 完成] 成功推演出 ${step3.branches.length} 个高张力分支`);

  // === STEP 4: 全案策划汇总与 StoryGraph DAG 构建 ===
  console.log('>>> [Step 4] 正在汇聚生成全案策划案 (GDD PRD) 与 StoryGraph DAG...');
  const step4 = await executePlannerPrdSynthesis({
    title: step1.title,
    spineScript: step1.spineScript,
    clips: step2.clips,
    branches: step3.branches,
  });
  console.log(`[Step 4 完成] 卖点: "${step4.prd.gameMeta.oneSentenceHook}"`);
  console.log(`[Step 4 完成] 拓扑 DAG: ${step4.graph.nodes.length} 节点, ${step4.graph.edges.length} 条边`);

  // === 写入 ProjectStore (SSOT) ===
  console.log('>>> 正在通过 ProjectStore 写入 project.json 并落盘 artifacts 目录...');
  
  // 1. 保存结构化数据到 project.artifacts
  store.setArtifact(projectId, 'planner_spine', step1);
  store.setArtifact(projectId, 'planner_clips', step2);
  store.setArtifact(projectId, 'planner_branches', step3);
  store.setArtifact(projectId, 'planner_prd', step4.prd);
  store.setArtifact(projectId, 'story_graph', step4.graph);

  // 2. 将人类易读的 Markdown 和 DAG 写入项目下的 artifacts 目录
  const projectDir = store.getProjectDir(projectId);
  const artifactsDir = path.join(projectDir, 'artifacts');
  if (!fs.existsSync(artifactsDir)) {
    fs.mkdirSync(artifactsDir, { recursive: true });
  }

  const step1Md = `# 《${step1.title}》黄金主干剧本 (Step 1)\n\n${step1.spineScript}`;
  const step2Md = formatClipsToMarkdown(step1.title, step2.clips);
  const step3Md = formatBranchesToMarkdown(step1.title, step3.branches);
  const step4Md = formatGddPrdToMarkdown(step4.prd, step2.clips, step3.branches, step4.graph);

  fs.writeFileSync(path.join(artifactsDir, 'step1_spine_script.md'), step1Md, 'utf-8');
  fs.writeFileSync(path.join(artifactsDir, 'step2_interaction_slicing.md'), step2Md, 'utf-8');
  fs.writeFileSync(path.join(artifactsDir, 'step3_branch_derivation.md'), step3Md, 'utf-8');
  fs.writeFileSync(path.join(artifactsDir, 'step4_game_design_prd.md'), step4Md, 'utf-8');
  fs.writeFileSync(path.join(artifactsDir, 'story_graph.json'), JSON.stringify(step4.graph, null, 2), 'utf-8');

  // 同时合成一份综合全案
  const fullBundleMd = [
    step4Md,
    '\n---\n\n## 附录一：黄金主干剧本文学全篇 (Step 1)\n\n' + step1.spineScript,
    '\n---\n\n## 附录二：互动分幕台本 (Step 2)\n\n' + step2Md,
    '\n---\n\n## 附录三：分支剧本与死局汇总 (Step 3)\n\n' + step3Md,
  ].join('\n\n');
  fs.writeFileSync(path.join(artifactsDir, 'game_design_prd_full.md'), fullBundleMd, 'utf-8');

  console.log(`\n🎉 [落地成功] 项目已完整持久化至: ${projectDir}`);
  console.log(`   - project.json: 包含 meta 和所有强类型结构化产物`);
  console.log(`   - artifacts/step1_spine_script.md`);
  console.log(`   - artifacts/step2_interaction_slicing.md`);
  console.log(`   - artifacts/step3_branch_derivation.md`);
  console.log(`   - artifacts/step4_game_design_prd.md`);
  console.log(`   - artifacts/story_graph.json`);
  console.log(`   - artifacts/game_design_prd_full.md`);
}

runRealProject().catch((err) => {
  console.error('❌ 项目生成失败:', err);
  process.exit(1);
});
