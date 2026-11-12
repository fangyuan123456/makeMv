/**
 * scripts/probe-stage2.ts
 * 阶段二单点计时探针：定位 API 测试"试玩挂起"超时的慢环节
 */
import { LLMProvider, MockLanguageModel } from '../src/llm/index.js';
import { ProjectStore } from '../src/project-store/ProjectStore.js';
import { planGDDWithAgent } from '../src/agents/planner/planner.agent.js';
import { executeBuildTextGameStep } from '../src/workflows/steps/build-text-game.step.js';

async function main() {
  LLMProvider.setMockModel(new MockLanguageModel());
  const store = ProjectStore.getInstance();
  const pid = `proj_probe_stage2_${Date.now()}`;

  const t0 = Date.now();
  const gdd = await planGDDWithAgent('做一个潜伏特工题材的互动游戏');
  console.log(`[Probe] 阶段一(planGDD) 耗时 ${Math.round((Date.now() - t0) / 1000)}s`);
  store.setArtifact(pid, 'gdd', gdd);

  const t1 = Date.now();
  console.log('[Probe] 阶段二开始...');
  try {
    const out = await executeBuildTextGameStep({ projectId: pid });
    console.log(
      `[Probe] 阶段二完成，耗时 ${Math.round((Date.now() - t1) / 1000)}s, 节点数: ${out.textGame.nodes.length}`
    );
  } catch (err) {
    console.error(`[Probe] 阶段二抛错 (耗时 ${Math.round((Date.now() - t1) / 1000)}s):`, err);
  }
  try {
    store.deleteProject(pid);
  } catch {}
  process.exit(0);
}

main().catch((err) => {
  console.error('[Probe] 失败:', err);
  process.exit(1);
});
