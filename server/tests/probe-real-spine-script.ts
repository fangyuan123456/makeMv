/**
 * tests/probe-real-spine-script.ts
 * 真实商业模型实测：运行黄金主干剧本工序 (spine-script) 并检验生成效果
 */

import { executePlannerSpineScript } from '../src/agents/planner/planner.workflow.js';

async function main() {
  console.log('🎬 正在唤醒专职编剧 Agent，调度大模型进行真实影视创作...\n');

  const testPrompt = `家庭伦理 / 情感悬疑 / 记忆追溯
核心高概念：女儿回到老宅照顾患有阿尔茨海默症的母亲，在翻找老物件时，意外揭开母亲为了保护她而刻意遗忘的一段往事——是一起伪装成意外的火灾真相，还是纯粹的母爱执念？
核心矛盾：女儿在母亲反复错乱的记忆碎语与老物件线索中追溯真相，平衡母亲的情绪波动与自己的愧疚感，并在终局抉择中面对残酷的真相。`;

  const startTime = Date.now();
  const result = await executePlannerSpineScript({
    userPrompt: testPrompt,
  });
  const duration = ((Date.now() - startTime) / 1000).toFixed(2);

  console.log(`✨ 黄金主干剧本生成完毕！(耗时: ${duration}s)\n`);
  console.log(`====================【短剧标题】====================`);
  console.log(`《${result.title}》\n`);
  console.log(`====================【正文内容】====================`);
  console.log(result.spineScript);
  console.log(`\n====================================================`);

  // 严格自检
  const hasScene1 = result.spineScript.includes('场景一') || result.spineScript.includes('Scene 1');
  const hasScene2 = result.spineScript.includes('场景二') || result.spineScript.includes('Scene 2');
  console.log('\n🔍 规范自检结果:');
  console.log(`- 是否避免了生硬分场标记 (场景一/二): ${!hasScene1 && !hasScene2 ? '✅ 是 (完全合规)' : '❌ 否'}`);
  console.log(`- 剧本文学字数: ${result.spineScript.length} 字`);
}

main().catch((err) => {
  console.error('实测运行异常:', err);
  process.exit(1);
});
