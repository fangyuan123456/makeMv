/**
 * server/tests/unit/real-render-test.ts
 * 真实运行 ComfyUI 关键帧出图验证
 */
import { ProjectStore } from '../../src/project-store/ProjectStore.js';
import { shotKeyframeStep } from '../../src/tools/film-production/shot-keyframe-tool/steps/01-render/step.js';

async function main() {
  const projectId = 'proj_1795483074481_bprz';
  const clipId = 'c1';
  const shotId = 'c1-01';

  console.log(`[RealRender] 正在为项目 [${projectId}] 分幕 [${clipId}] 镜头 [${shotId}] 启动真实 ComfyUI 关键帧生图...`);

  const startTime = Date.now();
  const result = await shotKeyframeStep.execute({
    context: {
      projectId,
      clipId,
      shotId,
      force: true, // 强制重新生成真实图片
    },
  });

  const durationSec = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`[RealRender] 关键帧生图完毕！耗时: ${durationSec}s`);
  console.log('[RealRender] 执行结果:', JSON.stringify(result, null, 2));

  // 检查镜头最新帧
  const store = ProjectStore.getInstance();
  const filmSpec = store.getArtifact<any>(projectId, 'film_spec');
  const targetShot = filmSpec.clips?.[0]?.shots?.find((s: any) => s.shotId === shotId);
  console.log('[RealRender] 镜头首帧图片 URL:', targetShot?.firstFrameImageUrl);
  console.log('[RealRender] 镜头版本历史 (frameVersions):', JSON.stringify(targetShot?.frameVersions, null, 2));
}

main().catch((err) => {
  console.error('[RealRender] 运行失败:', err);
  process.exit(1);
});
