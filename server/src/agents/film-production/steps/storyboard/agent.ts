import { Agent } from '@mastra/core/agent';
import type { LanguageModelV1 } from 'ai';
import type { GlobalEntities } from '../../../../project-store/contracts/film-production/lookdev.js';
import type { UniversalPrdSpec } from '../../../../project-store/contracts/planner/index.js';
import { LLMProvider } from '../../../../llm/index.js';
import { generateStructured } from '../../../../utils/llm-diagnostics.js';
import { STAGE, FILM_STEP } from '../../../../project-store/artifact-fs.js';
import { FilmAdapterArtifactSchema, type FilmAdapterArtifact } from './schema.js';
import { FILM_ADAPTER_SYSTEM_PROMPT, buildFilmAdapterUserPrompt } from './prompt.js';

export function createStoryboardAgent(model?: LanguageModelV1): Agent {
  return new Agent({ name: 'film-storyboard-agent', instructions: FILM_ADAPTER_SYSTEM_PROMPT, model: model || LLMProvider.getModel() });
}

export const storyboardAgent = createStoryboardAgent();

export async function generateStoryboard(
  input: { title: string; prd: UniversalPrdSpec; storyMarkdown: string; entities?: GlobalEntities },
  agent: Agent = storyboardAgent,
): Promise<FilmAdapterArtifact> {
  return (await generateStructured({
    agent,
    prompt: buildFilmAdapterUserPrompt(input),
    schema: FilmAdapterArtifactSchema,
    stage: STAGE.filmAdapter,
    step: FILM_STEP.compile,
    label: '分镜规划',
  })) as FilmAdapterArtifact;
}

