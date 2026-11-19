import { storyboardPlanningStep } from '../src/tools/film-production/storyboard-planning-tool/steps/01-plan/step.js';

async function main() {
  const projectId = 'proj_1794797707117_z776';
  console.log(`[Test] 开始执行全剧分镜高精推演, projectId=${projectId}...`);

  try {
    const res = await (storyboardPlanningStep as any).execute({
      context: {
        triggerData: {
          projectId,
        },
      },
    });

    console.log('[Test] 全剧分镜推演完成！各幕镜头统计:');
    res.filmSpec.clips.forEach((clip: any) => {
      console.log(`- 分幕 [${clip.clipId}]: 镜头数: ${clip.shots.length}, 时长: ${clip.targetDurationSec}s`);
      if (clip.shots.length > 0) {
        const s1 = clip.shots[0];
        console.log(`    首镜(${s1.shotId}): [${s1.shotType}] 背景图: ${s1.backgroundImageUrl || '无'} | 角色图: ${s1.characterReferenceImageUrls?.join(', ') || '无'}`);
      }
    });
  } catch (err) {
    console.error('[Test] 执行出错:', err);
  }
}

main();
