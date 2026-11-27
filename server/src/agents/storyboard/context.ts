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

export type StoryboardPhase =
  | 'STAGE_0_PENDING' // 视听演绎剧本待生成 (需升级故事剧本为视听演绎剧本)
  | 'STAGE_1_PENDING' // 分镜台本待细化拆解 (已有演绎剧本，待细化拆出镜头)
  | 'STAGE_2_PENDING' // 镜头视听推演与关键帧生图 (已有镜头，待推演或生图)
  | 'STAGE_COMPLETED'; // 全幕制作就绪

export function evaluateStoryboardPhase(params: {
  hasShootingScript: boolean;
  shotsCount: number;
  unrenderedShotsCount: number;
  unrenderedVideosCount: number;
}): { phase: StoryboardPhase; description: string; currentMission: string } {
  const { hasShootingScript, shotsCount, unrenderedShotsCount, unrenderedVideosCount } = params;

  if (!hasShootingScript) {
    return {
      phase: 'STAGE_0_PENDING',
      description: '阶段 0/3: 故事剧本升级为视听演绎剧本 (待推进)',
      currentMission: '当前分幕尚未生成视听演绎剧本。首要任务是提炼场景时空环境锁，将文学剧情升级为场面调度与对白表演流，杜绝直接盲目出粗糙分镜。',
    };
  }

  if (shotsCount === 0) {
    return {
      phase: 'STAGE_1_PENDING',
      description: '阶段 1/3: 工业级分镜台本细化切片 (待拆解)',
      currentMission: '视听演绎剧本已就绪。首要任务是依据演绎剧本的场面与对白，细化切分出单镜头动作明确、对白精准绑定的镜头台本序列 (shots)。',
    };
  }

  if (unrenderedShotsCount > 0 || unrenderedVideosCount > 0) {
    return {
      phase: 'STAGE_2_PENDING',
      description: '阶段 2/3: 镜头视听推演与物理生图/视频渲染 (进行中)',
      currentMission: `当前已排布 ${shotsCount} 个镜头。首要任务是针对具体镜头执行首帧生图词与同相运镜词推演、关键帧生图出图或动态视频渲染。`,
    };
  }

  return {
    phase: 'STAGE_COMPLETED',
    description: '阶段 3/3: 当前分幕全流程视听制作收官',
    currentMission: '本幕所有分镜镜头均已完成视听推演与渲染制作，当前分幕已处于高质量交付状态。',
  };
}

export function getStoryboardContext(projectId: string, clipId: string, targetShotId?: string) {
  const store = ProjectStore.getInstance();
  const project = store.getProject(projectId) as any;
  const prd = (store.getArtifact(projectId, 'prd') as any) || project?.prd || {};
  const filmSpec = (store.getArtifact(projectId, 'film_spec') as any) || {};
  const storyboards = (store.getArtifact(projectId, 'storyboards') as any[]) || project?.storyboards || [];
  const storySections = getProjectStorySections(projectId);

  const allClips: any[] = Array.isArray(prd?.clips) ? prd.clips : [];
  const currentClipIndex = allClips.findIndex((clip: any) => clip.id === clipId);
  const currentPrdClip = currentClipIndex >= 0 ? allClips[currentClipIndex] : {};

  const currentSection = clipId ? storySections[clipId] : undefined;
  const currentStoryboardClip = storyboards.find((board: any) => board.clipId === clipId);
  const currentFilmClip = (filmSpec.clips || []).find((c: any) => c.clipId === clipId);

  const shootingScript = currentStoryboardClip?.shootingScript || currentFilmClip?.shootingScript;
  const hasShootingScript = Boolean(shootingScript && Array.isArray(shootingScript.actionBeats) && shootingScript.actionBeats.length > 0);

  const shots: any[] = Array.isArray(currentStoryboardClip?.shots) ? currentStoryboardClip.shots : [];
  const unupscaledFirstShots = shots.filter(
    (shot) => Boolean(shot.firstFrameImageUrl) && !shot.firstFrameUpscale
  );
  const unupscaledLastShots = shots.filter(
    (shot) => Boolean(shot.lastFrameImageUrl) && !shot.lastFrameUpscale
  );
  const unrenderedShotsCount = shots.filter((s) => !s.firstFrameImageUrl).length;
  const unrenderedVideosCount = shots.filter((s) => !s.videoUrl).length;

  const phaseEvaluation = evaluateStoryboardPhase({
    hasShootingScript,
    shotsCount: shots.length,
    unrenderedShotsCount,
    unrenderedVideosCount,
  });

  const storyOverview = prd?.premiseAndPerspective || prd?.gameTitle || '全剧主线推演';
  const { previousClipSummary, nextClipSummary } = buildBranchContext({
    clips: allClips,
    interactions: prd.interactions || [],
    wiring: prd.wiring || [],
    startNodeId: prd.startNodeId,
  }, clipId, storySections);

  const continuity = resolveShotContinuity(shots, targetShotId);
  const taskHealth = getTaskHealthSnapshot(projectId, 'film.');

  // 格式化视听演绎剧本摘要看板
  let shootingScriptSummary = '  (当前幕尚未生成视听演绎剧本)';
  if (hasShootingScript && shootingScript) {
    const env = shootingScript.environmentLock;
    const envLines = [
      `时段: ${env?.timeOfDay || '未指定'}`,
      `天气约束: ${env?.weatherDirective?.label || '无'} (${env?.weatherDirective?.instruction || ''})`,
      `影调光照: ${env?.lightingDirective?.label || '无'} (${env?.lightingDirective?.instruction || ''})`,
      `色彩倾向: ${env?.colorTone?.label || '无'}`,
    ];
    const beatsLines = (shootingScript.actionBeats || []).map((b: any, bIdx: number) => {
      return `    ${bIdx + 1}. [${b.beatTitle}] (${b.estimatedSeconds || 3}s): ${b.actionDescription}`;
    });
    shootingScriptSummary = `  - 场景时空与光影环境锁：\n    ${envLines.join(' | ')}\n  - 场面调度与对白表演流 (${shootingScript.actionBeats.length} 个场面情境):\n${beatsLines.join('\n')}`;
  }

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
    hasShootingScript,
    shootingScript,
    shootingScriptSummary,
    phaseEvaluation,
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
      return `  - 镜号 ${index + 1} (${shot.shotId}): [${shot.cameraDirective?.label || shot.shotType || '中景'}] 运镜: ${shot.cameraMovement || '推进'} | 角色: ${chars} | 时长: ${shot.durationSec || 4}s | 状态: ${mediaStatus}${promptSnippet}`;
    }).join('\n'),
  };
}
