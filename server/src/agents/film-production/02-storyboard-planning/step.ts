/**
 * agents/film-production/02-storyboard-planning/step.ts
 * 分镜台本规划执行器与原子 Step (Step 2 of Film Production SSOT)
 */

import { createStep } from '@mastra/core/workflows';
import { Agent } from '@mastra/core/agent';
import { LLMProvider } from '../../../llm/index.js';
import { ProjectStore } from '../../../project-store/ProjectStore.js';
import { generateStructured } from '../../../utils/llm-diagnostics.js';
import { STAGE, FILM_STEP, writeArtifactFile, renderArtifactMarkdown } from '../../../project-store/artifact-fs.js';
import {
  StoryboardPlanningInputSchema,
  StoryboardPlanningOutputSchema,
  type StoryboardPlanningInput,
  type StoryboardPlanningOutput,
  FilmAdapterArtifactSchema,
} from './schema.js';
import {
  STORYBOARD_PLANNING_SYSTEM_PROMPT,
  buildStoryboardPlanningUserPrompt,
} from './prompt.js';

export function createStoryboardDirectorAgent(): Agent {
  return new Agent({
    name: 'storyboard_director_agent',
    instructions: STORYBOARD_PLANNING_SYSTEM_PROMPT,
    model: LLMProvider.getModel(),
  });
}

/**
 * 分镜台本规划执行器（纯文字 LLM 视听推演，不耗费生图与生视频物理算力）
 */
export async function executeStoryboardPlanningStep(
  input: StoryboardPlanningInput,
  agent: Agent = createStoryboardDirectorAgent()
): Promise<StoryboardPlanningOutput> {
  const store = ProjectStore.getInstance();
  const gdd = store.getArtifact<any>(input.projectId, 'gdd');
  const plannerPrd = store.getArtifact<any>(input.projectId, 'planner_prd');
  const prd = input.prd || plannerPrd?.prd || gdd?.prd;
  const title = input.title || gdd?.title || prd?.gameTitle || store.getProject(input.projectId).meta.title;
  const storyMarkdown = input.storyMarkdown || gdd?.storyMarkdown || '';

  if (!prd) {
    throw new Error(`[StoryboardPlanning] 项目 [${input.projectId}] 缺少策划案 PRD，无法规划分镜台本`);
  }

  const entities = input.entities || store.getArtifact<any>(input.projectId, 'lookdev_entities');

  const prompt = buildStoryboardPlanningUserPrompt({ title, prd, storyMarkdown, entities });
  const object = await generateStructured({
    agent,
    prompt,
    schema: FilmAdapterArtifactSchema,
    stage: STAGE.filmAdapter,
    step: FILM_STEP.compile,
    label: '剧本分镜台本规划',
  });

  if (!object || !object.clips?.length) {
    throw new Error(`[StoryboardPlanning] 项目 [${input.projectId}] 分镜台本规划失败，未生成有效分镜镜头列表`);
  }

  const filmSpec = {
    ...object,
    projectId: input.projectId,
    projectTitle: title,
  };

  // 100% 写入单一事实来源 ProjectStore (SSOT: film_spec)
  store.setArtifact(input.projectId, 'film_spec', filmSpec);

  // 落盘展示镜像
  try {
    const md = renderArtifactMarkdown(`《${title}》影视分镜镜头切片清单`, filmSpec);
    writeArtifactFile(input.projectId, 'debug', STAGE.filmAdapter, FILM_STEP.compile, 'film_spec.md', md);
    writeArtifactFile(input.projectId, 'delivery', STAGE.filmAdapter, FILM_STEP.compile, 'film_spec.md', md);
  } catch (err) {
    console.warn(`[StoryboardPlanning] 写入分镜清单文件失败:`, err);
  }

  return filmSpec;
}

export const storyboardPlanningStep = createStep({
  id: 'step_storyboard_planning',
  description: '将剧本正文与 PRD 拆解为全量分镜镜头切片清单 (纯文本推演，零物理算力)',
  inputSchema: StoryboardPlanningInputSchema,
  outputSchema: StoryboardPlanningOutputSchema,
  execute: async ({ context }) => {
    const ctx = context as any;
    const input = ctx.triggerData || ctx;
    return await executeStoryboardPlanningStep(input);
  },
});
