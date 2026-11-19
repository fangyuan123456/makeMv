import { ProjectStore } from '../../project-store/ProjectStore.js';
import { getProjectStorySections } from '../../project-store/story-sections.js';

export function getStoryboardContext(projectId: string, clipId: string) {
  const store = ProjectStore.getInstance();
  const project = store.getProject(projectId) as any;
  const prd = (store.getArtifact(projectId, 'universal_prd') as any) ||
    (store.getArtifact(projectId, 'prd') as any) || project?.prd || {};
  const storyboards = (store.getArtifact(projectId, 'storyboards') as any[]) || project?.storyboards || [];
  const storySections = getProjectStorySections(projectId);
  const currentPrdClip = (prd?.clips || []).find((clip: any) => clip.id === clipId) || {};
  const currentSection = clipId ? storySections[clipId] : undefined;
  const currentStoryboardClip = storyboards.find((board: any) =>
    board.clipId === clipId || board.sourceNodeId === clipId
  );
  const shots: any[] = Array.isArray(currentStoryboardClip?.shots) ? currentStoryboardClip.shots : [];
  const unupscaledFirstShots = shots.filter(
    (shot) => Boolean(shot.firstFrameImageUrl || shot.keyframeUrl || shot.imageUrl) && !shot.firstFrameUpscale
  );
  const unupscaledLastShots = shots.filter(
    (shot) => Boolean(shot.lastFrameImageUrl || shot.lastFrameUrl) && !shot.lastFrameUpscale
  );
  return {
    clipTitle: currentPrdClip.title || currentSection?.title || clipId || '当前分幕',
    narrativeText: currentPrdClip.narrativeText || currentSection?.narrativeText || '暂无剧本正文',
    targetDurationSec: currentStoryboardClip?.targetDurationSec || 0,
    shots,
    unupscaledFirstShots,
    unupscaledLastShots,
    shotsSummary: shots.map((shot, index) => {
      const chars = Array.isArray(shot.characters) && shot.characters.length > 0
        ? shot.characters.join(',')
        : '无(空镜)';
      const hasFirst = Boolean(shot.firstFrameImageUrl || shot.keyframeUrl || shot.imageUrl);
      const hasLast = Boolean(shot.lastFrameImageUrl || shot.lastFrameUrl);
      const firstStatus = hasFirst
        ? shot.firstFrameUpscale
          ? `首帧已生成(已超分${shot.firstFrameUpscale.multiplier}×)`
          : '首帧已生成(未超分)'
        : '首帧未生成';
      const lastStatus = hasLast
        ? shot.lastFrameUpscale
          ? `/末帧已生成(已超分${shot.lastFrameUpscale.multiplier}×)`
          : '/末帧已生成(未超分)'
        : '';
      const mediaStatus = `${firstStatus}${lastStatus}`;
      return `  - 镜号 ${index + 1} (${shot.shotId}): [${shot.shotType || 'MEDIUM_SHOT'}] 运镜: ${shot.cameraMovement || 'locked-off'} | 角色: ${chars} | 时长: ${shot.durationSec || 4}s | 画面状态: ${mediaStatus} | 首帧画面: ${shot.firstFramePrompt?.slice(0, 80) || ''}...`;
    }).join('\n'),
  };
}
