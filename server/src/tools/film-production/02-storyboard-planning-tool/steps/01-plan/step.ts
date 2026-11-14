/**
 * tools/film-production/02-storyboard-planning-tool/steps/01-plan/step.ts
 * 分镜台本规划工序执行器 (storyboardPlanningStep)
 */

import { createStep } from '@mastra/core/workflows';
import { Agent } from '@mastra/core/agent';
import { LLMProvider } from '../../../../../llm/index.js';
import { generateStructured } from '../../../../../utils/llm-diagnostics.js';
import { ProjectStore } from '../../../../../project-store/ProjectStore.js';
import { FilmAdapterArtifactSchema, type FilmAdapterArtifact } from '../../../../../project-store/contracts/film-production/film-spec.js';
import type { GlobalEntities } from '../../../../../project-store/contracts/film-production/lookdev.js';
import {
  StoryboardPlanningStepInputSchema,
  StoryboardPlanningOutputSchema,
  type StoryboardPlanningStepInput,
  type StoryboardPlanningOutput,
} from './schema.js';
import {
  STORYBOARD_PLANNING_SYSTEM_PROMPT,
  buildStoryboardPlanningUserPrompt,
} from './prompt.js';

export const storyboardPlanningStep = createStep({
  id: 'plan-storyboard-spec',
  description: '将剧本与 PRD 拆解为专业的各幕电影分镜台本与镜头制作订单 (纯文本拆解)',
  inputSchema: StoryboardPlanningStepInputSchema,
  outputSchema: StoryboardPlanningOutputSchema,
  execute: async ({ context }) => {
    const ctx = context as any;
    const input = (ctx?.triggerData || ctx?.inputData || ctx || {}) as StoryboardPlanningStepInput;

    const store = ProjectStore.getInstance();
    const effectivePrd = (input.prd || store.getArtifact(input.projectId, 'universal_prd')) || undefined;
    if (!effectivePrd && !input.storyMarkdown) {
      throw new Error(`[StoryboardPlanningTool] 项目 [${input.projectId}] 缺少前序策划案 PRD 或剧本正文，无法进行分镜台本规划`);
    }

    const effectiveEntities = (input.entities || store.getArtifact<GlobalEntities>(input.projectId, 'lookdev_entities')) || undefined;
    const effectiveInput = {
      ...input,
      prd: effectivePrd,
      entities: effectiveEntities,
    };

    const agent = new Agent({
      name: 'storyboard-director-agent',
      instructions: STORYBOARD_PLANNING_SYSTEM_PROMPT,
      model: LLMProvider.getModel(),
    });

    const prompt = buildStoryboardPlanningUserPrompt(effectiveInput);

    const filmSpec = (await generateStructured({
      agent,
      prompt,
      schema: FilmAdapterArtifactSchema,
      stage: 'film-tool',
      step: 'storyboard-plan',
      label: '剧本分镜台本规划',
    })) as FilmAdapterArtifact;

    if (input.projectId && filmSpec) {
      store.setArtifact(input.projectId, 'film_spec', filmSpec);
    }

    const output: StoryboardPlanningOutput = {
      projectId: input.projectId,
      filmSpec,
    };

    return output;
  },
});
