import { BaseStep } from '../../../../agent-runtime/index.js';
import { LLMRegistry } from '../../../../llm/LLMRegistry.js';
import {
  CONTINUITY_AUDIT_SYSTEM_PROMPT,
  buildContinuityAuditUserPrompt,
} from './prompt.js';
import { ContinuityAuditOutputSchema, ContinuityAuditOutput } from './schema.js';
import type { StoryboardArtifact, StoryboardShot, ContinuityAuditInput } from '../../types.js';

export class ContinuityAuditStep extends BaseStep<ContinuityAuditInput, StoryboardArtifact> {
  public readonly name = 'continuity-audit';
  public readonly stepIndex = 'continuity_audit';

  constructor(projectId?: string) {
    super('STORYBOARD', projectId);
  }

  public async run(input: ContinuityAuditInput): Promise<StoryboardArtifact> {
    const rawShots: StoryboardShot[] = input.rawShots || [];
    if (rawShots.length === 0) {
      return { shots: [], totalDuration: 0 };
    }

    const userPrompt = buildContinuityAuditUserPrompt(rawShots);
    const llm = LLMRegistry.get();
    const auditResult = await llm.generateObject<ContinuityAuditOutput>(
      userPrompt,
      ContinuityAuditOutputSchema,
      CONTINUITY_AUDIT_SYSTEM_PROMPT,
      {
        stage: 'continuity_audit',
        abortSignal: input.abortSignal,
      }
    );

    if (auditResult.patches && auditResult.patches.length > 0) {
      for (const patch of auditResult.patches) {
        const target = rawShots[patch.shot_number - 1];
        if (target && patch.content) {
          target.visualContent = patch.content;
        }
      }
    }

    let totalDuration = 0;
    const shots = rawShots.map((shot, idx) => {
      const dur = shot.duration || 4;
      totalDuration += dur;
      const baseShotId = shot.shotId || `S00${idx + 1}`;
      const prefix = shot.sceneId || shot.unitId || '';
      const uniqueShotId = prefix && !baseShotId.startsWith(prefix) ? `${prefix}_${baseShotId}` : baseShotId;

      return {
        ...shot,
        shotId: uniqueShotId,
        unitId: shot.unitId || prefix || `U0${idx + 1}`,
        duration: dur,
      };
    });

    const epNumber = input.episodeNumber || 1;
    const epTitle = input.title || `第 ${epNumber} 集`;
    const sceneMap: Record<string, any> = {};
    const segList: any[] = [];

    shots.forEach((s, idx) => {
      const segKey = s.sceneId || s.unitId || 'seg_1';
      if (!sceneMap[segKey]) {
        let loc = '场景区域';
        let chars = s.charactersInShot || [];
        const matchedScene = (input.scenes || []).find((scene: any) => scene.sceneId === segKey);
        if (matchedScene) {
          loc = matchedScene.location || matchedScene.title || loc;
          if (matchedScene.characters?.length) chars = matchedScene.characters;
        }

        sceneMap[segKey] = {
          segment_id: segKey,
          segment_number: segList.length + 1,
          episode_number: epNumber,
          location: loc,
          characters: chars,
          total_duration: 0,
          shots: [],
        };
        segList.push(sceneMap[segKey]);
      }

      sceneMap[segKey].total_duration += s.duration;
      sceneMap[segKey].shots.push({
        shot_number: idx + 1,
        shot_type: s.shotType,
        duration: s.duration,
        content: `${s.visualContent} (${s.dialogueOrAction}) [${s.cameraAngle} · ${s.cameraMovement}]`,
      });
    });

    const artifact: StoryboardArtifact = {
      episodeNumber: epNumber,
      shots,
      totalDuration,
      episodes: [
        {
          episode_number: epNumber,
          episode_title: epTitle,
          segments: segList,
        },
      ],
    };

    return artifact;
  }
}
