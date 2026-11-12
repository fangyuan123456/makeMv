/**
 * tests/probe-real-pipeline-step1-to-step3.ts
 * 真实商业模型端到端实测：Step 1 ➔ Step 2 ➔ Step 3
 * 检验从故事灵感，到纯主干剧本，到结构化切片 clips，再到反向拓扑单切口分支推演全闭环！
 */

import {
  executePlannerSpineScript,
  executePlannerSliceInteractions,
  executePlannerDeriveBranches,
} from '../src/agents/planner/planner.workflow.js';
import { formatClipsToMarkdown } from '../src/agents/planner/steps/interaction-slicing/schema.js';
import { formatBranchesToMarkdown } from '../src/agents/planner/steps/branch-derivation/schema.js';

async function main() {
  console.log('🎬 ====================【开始执行 Step 1 ➔ Step 2 ➔ Step 3 全链路实测】====================\n');

  const userPrompt = `家庭伦理 / 情感悬疑 / 记忆追溯
核心高概念：女儿回到老宅照顾患有阿尔茨海默症的母亲，在翻找老物件时，意外揭开母亲为了保护她而刻意遗忘的一段往事——是一起伪装成意外的火灾真相，还是纯粹的母爱执念？
核心矛盾：女儿在母亲反复错乱的记忆碎语与老物件线索中追溯真相，平衡母亲的情绪波动与自己的愧疚感，并在终局抉择中面对残酷的真相。`;

  // ----------------------------------------------------
  // Step 1: 黄金主干剧本 (spine-script)
  // ----------------------------------------------------
  console.log('🚀 【Step 1 启动】：专职编剧 Agent 创作黄金主干剧本...');
  const t1 = Date.now();
  const step1Output = await executePlannerSpineScript({ userPrompt });
  console.log(`✨ Step 1 完成！标题：《${step1Output.title}》，字数: ${step1Output.spineScript.length} 字 (耗时: ${((Date.now() - t1) / 1000).toFixed(1)}s)\n`);

  // ----------------------------------------------------
  // Step 2: 视听切片与切口发射 (interaction-slicing)
  // ----------------------------------------------------
  console.log('🚀 【Step 2 启动】：专职交互导演 Agent 进行纯结构化切片与切口挂载 (clips)...');
  const t2 = Date.now();
  const step2Output = await executePlannerSliceInteractions({
    spineScript: step1Output.spineScript,
  });
  console.log(`✨ Step 2 完成！切出 ${step2Output.clips.length} 个视听片段 (耗时: ${((Date.now() - t2) / 1000).toFixed(1)}s)`);
  for (const c of step2Output.clips) {
    const tag =
      c.interaction?.category === 'CHOICE'
        ? `➔ 分支切口: ${c.interaction.branchChoice}`
        : c.interaction?.category === 'ACTION'
        ? `➔ 单线互动: ${c.interaction.actionType}`
        : '(终局收口)';
    console.log(`   - [${c.clipId}] (层级 n=${c.level}) ${c.title} ${tag}`);
  }
  console.log('');

  // ----------------------------------------------------
  // Step 3: 反向拓扑层级优先分支推演 (branch-derivation)
  // ----------------------------------------------------
  console.log('🚀 【Step 3 启动】：反向拓扑调度引擎运行 (Max-n 优先队列，单切口 100% 聚焦推演)...');
  const t3 = Date.now();
  const step3Output = await executePlannerDeriveBranches({
    title: step2Output.title,
    clips: step2Output.clips,
  });
  console.log(`✨ Step 3 完成！闭环推演 ${step3Output.branches.length} 个分支 (耗时: ${((Date.now() - t3) / 1000).toFixed(1)}s)`);
  for (const b of step3Output.branches) {
    console.log(`   - 🔀 [切口 ${b.cutId}] 归宿: ${b.resolutionType === 'REJOIN' ? `【殊途同归 ➔ 接回 ${b.targetClipId}】` : `【独立终局 · ${b.endingType} · ${b.endingTitle}】`}`);
  }
  console.log('');

  // ----------------------------------------------------
  // 人类展示层：纯代码渲染 0 token Markdown 工作台本
  // ----------------------------------------------------
  console.log('====================【人类展示层：纯代码 0 token 拼装 Markdown】====================');
  const finalScriptMd = formatClipsToMarkdown(step2Output.title, step2Output.clips);
  const finalBranchesMd = formatBranchesToMarkdown(step3Output.title, step3Output.branches);
  console.log('\n---【分幕台本】---');
  console.log(finalScriptMd);
  console.log('\n---【分支剧本集】---');
  console.log(finalBranchesMd);
  console.log('===================================================================================');
}

main().catch((err) => {
  console.error('全链路实测异常:', err);
  process.exit(1);
});
