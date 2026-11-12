/**
 * scripts/smoke-planner-real.ts
 * 真实模型策划工序冒烟：调用 plan-gdd 完整工序（含 prd.md / story.md 落盘）
 *
 * 用途：验证 planner 三件套改造后的真实生成质量与题材自适应性。
 * 交付产物：server/data/projects/<projectId>/01-planner/04-prd-synthesis/{prd.md,story.md}
 * 全量中间产物：server/data/projects/<projectId>/.debug/01-planner/<工序>/*.md
 */

import { executePlanGddStep } from '../src/workflows/steps/plan-gdd.step.js';
import { validateGddTopology } from '../src/agents/planner/steps/topology-validation/validator.js';

const projectId = `proj_planner_real_${Date.now()}`;

// 故意选择与旧提示词锚定示例（悬疑/测谎/时空循环）完全无关的家庭情感题材，
// 用于检验"读题先行、机制从题材生长"是否真正生效
const userPrompt = `我想做一个关于阿尔茨海默病的家庭题材互动游戏。
玩家扮演女儿，回到老宅照顾患病的母亲。
母亲残留的记忆碎片散落在老宅各处（旧照片、腌菜坛子、一只1978年的搪瓷缸）。
玩家通过整理这些碎片拼凑出母亲当年刻意遗忘的一段往事，
最终要决定：是让母亲彻底遗忘安度晚年，还是唤醒她的记忆面对真相。`;

async function main() {
  console.log(`[Smoke] 项目ID: ${projectId}`);
  console.log(`[Smoke] 开始真实模型策划推演...\n`);

  const start = Date.now();
  const { gdd } = await executePlanGddStep({ projectId, userPrompt });
  const elapsed = Math.round((Date.now() - start) / 1000);

  const validation = validateGddTopology(gdd);

  console.log(`\n[Smoke] 推演完成，耗时 ${elapsed}s`);
  console.log(`  标题: 《${gdd.title}》`);
  console.log(`  题材: ${gdd.genre}`);
  console.log(`  核心循环: ${gdd.coreLoop}`);
  console.log(`  玩家定位: ${gdd.playerRole}`);
  console.log(`  节拍数: ${gdd.beatOutline.length}`);
  console.log(`  玩法任务: ${gdd.beatOutline.map((b) => b.gameplayTask ? '✓' : '✗').join(' ')}`);
  console.log(`  真分叉节拍数: ${gdd.beatOutline.filter((b) => !b.isEnding && (b.branchExpectations?.length ?? 0) >= 2).length}`);
  console.log(`  数值变量: ${Object.keys(gdd.globalStateMachine?.variables || {}).join(', ') || '(空)'}`);
  console.log(`  门禁旗标: ${Object.keys(gdd.globalStateMachine?.flags || {}).join(', ') || '(空)'}`);
  console.log(`  初始物品: ${(gdd.globalStateMachine?.inventory || []).join(', ') || '(空)'}`);
  console.log(`  拓扑校验: ${validation.valid ? '✅ 通过' : '❌ 失败\n' + validation.errors.join('\n')}`);
  if (validation.warnings.length > 0) {
    console.log(`  互动性警告:\n${validation.warnings.map((w) => `    - ${w}`).join('\n')}`);
  }
  console.log(`\n[Smoke] 游戏 PRD: server/data/projects/${projectId}/01-planner/04-prd-synthesis/prd.md`);
  console.log(`[Smoke] 按幕剧本: server/data/projects/${projectId}/01-planner/04-prd-synthesis/story.md`);
  console.log(`[Smoke] 全量中间产物: server/data/projects/${projectId}/.debug/01-planner/`);
}

main().catch((err) => {
  console.error('[Smoke] 失败:', err);
  process.exit(1);
});
