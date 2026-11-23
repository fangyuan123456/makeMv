import { ProjectStore } from '../../project-store/ProjectStore.js';
import { getProjectStorySections } from '../../project-store/story-sections.js';
import { buildBranchContext } from '../../project-store/story-context.js';
import { getTaskHealthSnapshot } from '../runtime/task-health.js';

export function resolveShotContinuity(shots: any[], targetShotId?: string) {
  if (!Array.isArray(shots) || !targetShotId) {
    return { previousShot: undefined, previousShotMotion: undefined };
  }
  const currentIndex = shots.findIndex((s: any) => s.shotId === targetShotId);
  if (currentIndex <= 0) {
    return { previousShot: undefined, previousShotMotion: undefined };
  }
  const prev = shots[currentIndex - 1];
  return {
    previousShot: {
      shotId: prev.shotId,
      title: prev.title,
      sceneSubject: prev.sceneSubject,
      firstFramePrompt: prev.firstFramePrompt || '',
    },
    previousShotMotion: {
      shotId: prev.shotId,
      title: prev.title,
      motionDirective: prev.motionDirective?.promptClause || prev.cameraMovement || '',
      videoPrompt: prev.videoPrompt,
    },
  };
}

export function getStoryboardContext(projectId: string, clipId: string, targetShotId?: string) {
  const store = ProjectStore.getInstance();
  const project = store.getProject(projectId) as any;
  const prd = (store.getArtifact(projectId, 'prd') as any) || project?.prd || {};
  const storyboards = (store.getArtifact(projectId, 'storyboards') as any[]) || project?.storyboards || [];
  const storySections = getProjectStorySections(projectId);

  const allClips: any[] = Array.isArray(prd?.clips) ? prd.clips : [];
  const currentClipIndex = allClips.findIndex((clip: any) => clip.id === clipId);
  const currentPrdClip = currentClipIndex >= 0 ? allClips[currentClipIndex] : {};

  const currentSection = clipId ? storySections[clipId] : undefined;
  const currentStoryboardClip = storyboards.find((board: any) => board.clipId === clipId);
  const shots: any[] = Array.isArray(currentStoryboardClip?.shots) ? currentStoryboardClip.shots : [];
  const unupscaledFirstShots = shots.filter(
    (shot) => Boolean(shot.firstFrameImageUrl) && !shot.firstFrameUpscale
  );
  const unupscaledLastShots = shots.filter(
    (shot) => Boolean(shot.lastFrameImageUrl) && !shot.lastFrameUpscale
  );

  const storyOverview = prd?.premiseAndPerspective || prd?.gameTitle || '全剧主线推演';
  const { previousClipSummary, nextClipSummary } = buildBranchContext({
    clips: allClips,
    interactions: prd.interactions || [],
    wiring: prd.wiring || [],
    startNodeId: prd.startNodeId,
  }, clipId, storySections);

  const continuity = resolveShotContinuity(shots, targetShotId);
  const taskHealth = getTaskHealthSnapshot(projectId, 'film.');

  return {
    storyOverview,
    previousClipSummary,
    nextClipSummary,
    previousShot: continuity.previousShot,
    previousShotMotion: continuity.previousShotMotion,
    taskHealth,
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
      const hasFirst = Boolean(shot.firstFrameImageUrl);
      const hasLast = Boolean(shot.lastFrameImageUrl);
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
      const firstPrompt = (shot.firstFramePrompt || '').trim();
      const promptSnippet = firstPrompt ? `\n    首帧画面原词: "${firstPrompt}"` : ' (首帧尚未编写提示词)';
      return `  - 镜号 ${index + 1} (${shot.shotId}): [${shot.shotType || 'MEDIUM_SHOT'}] 运镜: ${shot.cameraMovement || 'locked-off'} | 角色: ${chars} | 时长: ${shot.durationSec || 4}s | 画面状态: ${mediaStatus}${promptSnippet}`;
    }).join('\n'),
  };
}
