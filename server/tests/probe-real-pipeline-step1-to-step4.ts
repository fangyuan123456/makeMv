/**
 * tests/probe-real-pipeline-step1-to-step4.ts
 * 真实端到端大模型全链路推演探针 (Step 1 ➔ Step 2 ➔ Step 3 ➔ Step 4)
 *
 * 验证目标：
 * 1. Step 1: 黄金主干剧本生成
 * 2. Step 2: 互动切口与分幕拆分
 * 3. Step 3: 分支剧本推演 (包含 BE 死局与因果守恒)
 * 4. Step 4: 全案 PRD 汇总与 StoryGraph DAG 构建
 * 5. 将完整的工业级策划案落地为 Markdown 文档并输出统计
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  executePlannerSpineScript,
  executePlannerSliceInteractions,
  executePlannerDeriveBranches,
  executePlannerPrdSynthesis,
  formatClipsToMarkdown,
  formatBranchesToMarkdown,
  formatGddPrdToMarkdown,
} from '../src/agents/planner/index.js';

async function main() {
  console.log('=== [探针启动] 互动短剧策划子工作流全链路推演 (Step 1 -> Step 4) ===\n');

  const userPrompt = `
请创作一部民国悬疑谍战互动短剧《遗忘的火焰》：
【核心人设】：
男主林晚（表面为旧派照相馆的洗印师，实际为潜伏的地下交通员“火绒”）；
女主/搭档沈青竹（曾是林晚的未婚妻，如今是巡捕房特务处的档案员，立场不明）；
【主干核心危机】：
1938年深秋深夜，巡捕房特务封锁法租界，林晚必须在天亮搜查前，在老宅暗房与书房找到亡父遗留的微缩绝密名单，并在沈青竹的监视与周旋下破译暗语、销毁底片、安全送出情报。
【基调】：
高压心跳、暗室微光、电影质感、克制而深情的对白、严谨的因果推演。
`;

  // === STEP 1: 黄金主干剧本 ===
  console.log('>>> [Step 1] 正在推演纯文学黄金主干剧本 (HE 路线)...');
  const step1Output = await executePlannerSpineScript({ userPrompt });
  console.log(`[Step 1 完成] 剧本标题: 《${step1Output.title}》 | 正文字数: ${step1Output.spineScript.length} 字\n`);

  // === STEP 2: 互动切口与分幕拆分 ===
  console.log('>>> [Step 2] 正在拆分视听演播片段与互动切口 (纯结构化 clips)...');
  const step2Output = await executePlannerSliceInteractions({ spineScript: step1Output.spineScript });
  console.log(`[Step 2 完成] 切出视听片段数: ${step2Output.clips.length} 个`);
  const cutCount = step2Output.clips.filter((c) => c.interaction?.category === 'CHOICE').length;
  console.log(`[Step 2 完成] 互动分流切口数: ${cutCount} 个\n`);

  // === STEP 3: 分支剧本推演 (倒序优先队列算法) ===
  console.log('>>> [Step 3] 正在执行逆向拓扑分支剧本推演 (Max-n 优先队列)...');
  const step3Output = await executePlannerDeriveBranches({
    title: step1Output.title,
    clips: step2Output.clips,
  });
  console.log(`[Step 3 完成] 成功推演出分支数: ${step3Output.branches.length} 个`);
  for (const b of step3Output.branches) {
    const outcome = b.resolutionType === 'REJOIN'
      ? `殊途同归合流向 ${b.targetClipId} (${b.rejoinConsequence || '付出代价'})`
      : `达成终局【${b.endingType}：${b.endingTitle}】判词：“${b.verdict}” (回溯锚点: ${b.rewindTargetClipId})`;
    console.log(`  - 分支 [${b.cutId}] 《${b.branchTitle}》 ➔ ${outcome}`);
  }
  console.log('');

  // === STEP 4: 全案 PRD 汇总与 StoryGraph DAG 构建 ===
  console.log('>>> [Step 4] 正在汇聚生成全案策划案 (GDD PRD) 与 StoryGraph DAG...');
  const step4Output = await executePlannerPrdSynthesis({
    title: step1Output.title,
    spineScript: step1Output.spineScript,
    clips: step2Output.clips,
    branches: step3Output.branches,
  });
  console.log(`[Step 4 完成] 游戏一句话卖点: "${step4Output.prd.gameMeta.oneSentenceHook}"`);
  console.log(`[Step 4 完成] 拓扑 DAG 节点数: ${step4Output.graph.nodes.length} 个, 边数: ${step4Output.graph.edges.length} 条\n`);

  // === 确定性文档渲染与落盘 ===
  console.log('>>> 正在执行纯代码确定性 Markdown 渲染 (0 Token 浪费)...');
  const fullPrdMarkdown = formatGddPrdToMarkdown(
    step4Output.prd,
    step2Output.clips,
    step3Output.branches,
    step4Output.graph
  );

  const scriptParts = [
    fullPrdMarkdown,
    '\n---\n\n## 附录一：黄金主干剧本文学全篇 (Step 1)\n\n' + step1Output.spineScript,
    '\n---\n\n## 附录二：互动切口与分幕台本 (Step 2)\n\n' + formatClipsToMarkdown(step1Output.title, step2Output.clips),
    '\n---\n\n## 附录三：推演分支剧本与死局汇总 (Step 3)\n\n' + formatBranchesToMarkdown(step1Output.title, step3Output.branches),
  ].join('\n\n');

  // 落盘到 docs 和 artifacts
  const docsPath = path.resolve(process.cwd(), 'docs', 'game_design_prd_flame_of_oblivion.md');
  const artifactPath = path.resolve(
    'C:/Users/Administrator/.gemini/antigravity/brain/fb8a9197-4d95-483b-bd8b-7519cc0be27b',
    'game_design_prd_flame_of_oblivion.md'
  );

  fs.mkdirSync(path.dirname(docsPath), { recursive: true });
  fs.writeFileSync(docsPath, scriptParts, 'utf-8');
  fs.writeFileSync(artifactPath, scriptParts, 'utf-8');

  console.log(`✅ [全部完成] 完整全案策划案已生成！`);
  console.log(`   - 存储路径 1: ${docsPath}`);
  console.log(`   - 存储路径 2: ${artifactPath}`);
  console.log(`   - 文件总字符数: ${scriptParts.length} 字`);
}

main().catch((err) => {
  console.error('❌ [推演探针失败]', err);
  process.exit(1);
});
