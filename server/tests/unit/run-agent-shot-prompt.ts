/**
 * server/tests/unit/run-agent-shot-prompt.ts
 * 运行分镜导演单镜视听推演 (Shot Prompt) 并展示编译效果
 */

import { ProjectStore } from '../../src/project-store/ProjectStore.js';
import { shotPromptStep } from '../../src/tools/film-production/shot-prompt-tool/steps/01-prompt/step.js';
import { compileMediaPrompt } from '../../src/media/compiler/media-semantic-compiler.js';

async function main() {
  const projectId = 'proj_1795483074481_bprz';
  const clipId = 'c1';
  const shotId = 'c1-02';

  console.log(`[ShotPromptAgent] 正在为镜头 [${shotId}] 执行单镜视听一体化推演...`);

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

  console.log('\n================ 【镜头视听一体化推演产出】 ================');
  console.log(`镜头编号: ${result.shotId}`);
  console.log('\n【首帧生图提示词 (firstFramePrompt)】:');
  console.log(result.firstFramePrompt);
  console.log('\n【动态运镜表演词 (videoPrompt)】:');
  console.log(result.videoPrompt);

  console.log('\n================ 【底层编译器映射预览 (流入 ComfyUI)】 ================');
  const compiled = compileMediaPrompt({
    text: result.firstFramePrompt,
    entities: entities as any,
  });
  console.log(compiled.compiledPrompt);
  console.log('\n参考图队列数量:', compiled.referenceImageUrls.length);
  console.log('推断生图模式:', compiled.mode);
}

main().catch((err) => {
  console.error('[ShotPromptAgent] 运行失败:', err);
  process.exit(1);
});
