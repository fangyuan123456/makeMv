import type {
  ProjectData,
  UniversalPrdSpec,
  PrdClipNode,
  PrdInteractionNode,
} from '../types/index.js';

/**
 * 统一从 ProjectData 的结构化剧本 (screenplayJson) 提取故事源
 */
export function resolveClientStorySource(
  projectData?: ProjectData | null,
  overrideScreenplayJson?: any
): UniversalPrdSpec | undefined {
  const screenplayJson =
    overrideScreenplayJson ||
    projectData?.screenplayJson ||
    projectData?.artifacts?.screenplay_json;

  if (!screenplayJson || !Array.isArray(screenplayJson.clips) || screenplayJson.clips.length === 0) {
    return undefined;
  }

  const clips = screenplayJson.clips as PrdClipNode[];
  const interactions: PrdInteractionNode[] = [];
  const wiring: any[] = [];

  for (let i = 0; i < clips.length; i++) {
    const c = clips[i] as any;
    const nextClipId = clips[i + 1]?.id;
    if (c.interaction) {
      const interId = c.interaction.id || `I_${c.id}`;
      interactions.push({
        id: interId,
        kind: c.interaction.kind,
        isBranching: c.interaction.isBranching,
        prompt: c.interaction.prompt,
        timeoutSec: c.interaction.timeoutSec ?? null,
        outcomes: (c.interaction.outcomes || []).map((o: any) => ({
          key: o.key,
          label: o.label,
          targetNodeId: o.targetNodeId || (o.targetType === 'CONTINUE_MAINLINE' ? nextClipId : undefined),
          targetEndingId: o.targetEndingId,
        })),
      });
      wiring.push({ from: c.id, onOutcome: 'onEnded', to: interId });
      for (const o of c.interaction.outcomes || []) {
        const to = o.targetEndingId || o.targetNodeId || (o.targetType === 'CONTINUE_MAINLINE' ? nextClipId : undefined);
        if (to) wiring.push({ from: interId, onOutcome: o.key, to });
      }
    } else if (nextClipId) {
      wiring.push({ from: c.id, onOutcome: 'onEnded', to: nextClipId });
    }
  }

  return {
    gameTitle: screenplayJson.title || '互动影游',
    genre: screenplayJson.genre || '互动影游',
    playerIdentity: screenplayJson.characters?.[0]?.name || '主角',
    premiseAndPerspective: screenplayJson.logline || '',
    outOfFlowSummary: '',
    gameplayAndVictorySummary: '',
    startNodeId: screenplayJson.storyGraph?.startNodeId || clips[0]?.id || 'c1',
    clips,
    interactions,
    endings: (screenplayJson.endings || []).map((e: any) => ({
      ...e,
      isVictory: e.isVictory ?? (e.endingType === 'HE' || e.endingType === 'TE'),
    })),
    wiring,
  };
}
