/**
 * server/tests/unit/test-generalized-shot-prompt.ts
 * 验证通用零硬编码规则下的提示词自动推演效果
 */
import { ProjectStore } from '../../src/project-store/ProjectStore.js';
import { shotPromptStep } from '../../src/tools/film-production/shot-prompt-tool/steps/01-prompt/step.js';

async function main() {
  const projectId = 'proj_1795483074481_bprz';
  const clipId = 'c1';
  const shotId = 'c1-02';

  console.log(`[GeneralizedPrompt] 正在使用纯通用规则对镜头 [${shotId}] 执行视听推演...`);

  const store = ProjectStore.getInstance();
  const entities = store.getArtifact(projectId, 'lookdev_entities');

  const result = await (shotPromptStep.execute as any)({
    context: {
      projectId,
      clipId,
      shotId,
      entities,
    },
  });

  console.log('\n================ 【通用规则自动推演产出】 ================');
  console.log('镜头 ID:', result.shotId);
  console.log('\n【首帧生图提示词 (firstFramePrompt)】:');
  console.log(result.firstFramePrompt);
  console.log('\n【动态运镜词 (videoPrompt)】:');
  console.log(result.videoPrompt);
}

main().catch((err) => {
  console.error('[GeneralizedPrompt] 运行失败:', err);
  process.exit(1);
});
