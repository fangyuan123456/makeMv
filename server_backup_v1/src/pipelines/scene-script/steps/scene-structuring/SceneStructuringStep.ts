import { BaseStep } from '../../../../agent-runtime/index.js';
import { LLMRegistry } from '../../../../llm/LLMRegistry.js';
import {
  SCENE_STRUCTURING_SYSTEM_PROMPT,
  buildSceneStructuringUserPrompt,
} from './prompt.js';
import { SceneStructuringSchema, SceneStructuringOutput } from './schema.js';
import type { SceneStructuringInput, SceneScriptArtifact } from '../../types.js';

export class SceneStructuringStep extends BaseStep<SceneStructuringInput, SceneScriptArtifact> {
  public readonly name = 'scene-structuring';
  public readonly stepIndex = 'scene_structuring';

  constructor(projectId?: string) {
    super('SCENE_SCRIPT', projectId);
  }

  public async run(input: SceneStructuringInput): Promise<SceneScriptArtifact> {
    const expansion = input.expansion;
    const screenplayMarkdown = expansion.screenplayMarkdown || '';

    const userPrompt = buildSceneStructuringUserPrompt({
      screenplayMarkdown,
      storyGraph: input.storyGraph,
    });

    const llm = LLMRegistry.get();
    const result = await llm.generateObject<SceneStructuringOutput>(
      userPrompt,
      SceneStructuringSchema,
      SCENE_STRUCTURING_SYSTEM_PROMPT,
      {
        stage: 'scene_structuring',
        abortSignal: input.abortSignal,
      }
    );

    const artifact: SceneScriptArtifact = {
      title: input.title,
      theme: input.theme,
      style: input.style,
      episodes: [
        {
          episodeNumber: expansion.episodeNumber || 1,
          title: expansion.title,
          logline: expansion.logline,
          cliffhanger: expansion.cliffhanger,
          status: 'completed',
          content: screenplayMarkdown,
          scenes: result.scenes || [],
        },
      ],
      characterNames: input.characterNames,
      locations: result.locations || [],
      scriptText: screenplayMarkdown,
      activeEpisodeNumber: expansion.episodeNumber || 1,
      isLocked: false,
    };

    return artifact;
  }
}
