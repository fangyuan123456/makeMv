/**
 * agents/planner/steps/prd-synthesis/step.ts
 * 全案策划案汇总与 100% 通用 PRD 汇聚工序 (prdSynthesisStep)
 */

import { createStep } from '@mastra/core/workflows';
import { ProjectStore } from '../../../../project-store/ProjectStore.js';
import { Agent } from '@mastra/core/agent';
import { LLMProvider } from '../../../../llm/index.js';
import { runTaskRecordedStep } from '../../../../workflow-engine/TaskStore.js';
import {
  PrdSynthesisInputSchema,
  PrdSynthesisOutputSchema,
  PrdEnhancementOutputSchema,
  type PrdSynthesisInput,
  type PrdSynthesisOutput,
  type PrdEnhancementOutput,
} from './schema.js';
import {
  buildPrdSynthesisSystemPrompt,
  buildPrdSynthesisUserPrompt,
} from './prompt.js';
import {
  buildBaseUniversalPrdSpec,
  applyPrdEnhancement,
  buildStoryGraph,
} from './graph-builder.js';
import {
  formatGddPrdToMarkdown,
  formatStoryScenesToMarkdown,
} from './markdown-renderer.js';
import { validateUniversalPrdTopology } from '../topology-validation/validator.js';
import { generateStructured } from '../../../../utils/llm-diagnostics.js';
import { STAGE, PLANNER_STEP } from '../../../../project-store/artifact-fs.js';

/**
 * 创建专职游戏主策划 Agent
 */
export function createGameDesignerAgent(): Agent {
  return new Agent({
    name: 'game-designer-agent',
    instructions: buildPrdSynthesisSystemPrompt(),
    model: LLMProvider.getModel(),
  });
}

/**
 * 执行全案策划案汇总与通用 PRD 装配
 */
export async function executePrdSynthesisStep(
  input: PrdSynthesisInput,
  agent: Agent = createGameDesignerAgent()
): Promise<PrdSynthesisOutput> {
  // 1. 纯代码确定性搭建底图：clips + interactions 骨架 + endings 骨架 + wiring
  const baseSpec = buildBaseUniversalPrdSpec({
    title: input.title,
    clips: input.clips,
    branches: input.branches,
  });

  // 2. 调用轻量 AI 仅对基础骨架做“全局增补”
  const prompt = buildPrdSynthesisUserPrompt(input, baseSpec);
  const enhancement = await generateStructured({
    agent,
    prompt,
    schema: PrdEnhancementOutputSchema,
    stage: STAGE.planner,
    step: PLANNER_STEP.prd,
    label: 'PRD 全案增补',
  });

  let lastEnhancement: PrdEnhancementOutput | undefined = enhancement;
  let prd = lastEnhancement ? applyPrdEnhancement(baseSpec, lastEnhancement) : baseSpec;

  // 2.5 本地确定性门禁自检：若存在变量未声明或条件不可达，携带上轮草稿 JSON 与精确误差回退重试（最多 2 次）
  const storyMd = formatStoryScenesToMarkdown(input.clips, input.branches);
  const validateCandidate = (candidatePrd: typeof prd) =>
    validateUniversalPrdTopology({
      prd: candidatePrd,
      prdMarkdown: formatGddPrdToMarkdown(candidatePrd, input.clips, input.branches),
      storyMarkdown: storyMd,
    });

  let check = validateCandidate(prd);
  const MAX_REPAIR_RETRIES = 2;
  for (let attempt = 1; attempt <= MAX_REPAIR_RETRIES && !check.valid; attempt++) {
    console.warn(
      `[PrdSynthesis] 第 ${attempt} 次静态校验未通过，携带上轮草稿触发自愈重试: ${check.errors.join('; ')}`
    );
    try {
      const prevDraftBlock: string = lastEnhancement
        ? `\n\n【你上一轮输出的待修正草稿 JSON（请直接在此基础上修正问题，避免重头再算错）】：\n${JSON.stringify(
            lastEnhancement,
            null,
            2
          )}`
        : '';
      const repairPrompt: string = `${prompt}${prevDraftBlock}\n\n---\n\n【上轮草稿未通过静态图论/可达性门禁校验，请严格参照提示里的可达区间修正后重新完整输出 JSON】：\n${check.errors
        .map((e, i) => `${i + 1}. ${e}`)
        .join('\n')}`;
      const retriedEnhancement: PrdEnhancementOutput = await generateStructured({
        agent,
        prompt: repairPrompt,
        schema: PrdEnhancementOutputSchema,
        stage: STAGE.planner,
        step: PLANNER_STEP.prd,
        label: `PRD 全案增补（第 ${attempt} 次自愈重试）`,
      });
      {
        const retriedPrd = applyPrdEnhancement(baseSpec, retriedEnhancement);
        const recheck = validateCandidate(retriedPrd);
        if (recheck.valid || recheck.errors.length <= check.errors.length) {
          lastEnhancement = retriedEnhancement;
          prd = retriedPrd;
          check = recheck;
        }
      }
    } catch (err) {
      console.warn(`[PrdSynthesis] 第 ${attempt} 次自愈重试异常:`, err);
      break;
    }
  }

  // 3. 纯算法确定性构建状态机拓扑有向无环图 (StoryGraph DAG)
  const graph = buildStoryGraph(input.clips, input.branches);

  return {
    title: input.title,
    prd,
    graph,
  };
}

/**
 * Mastra 原生 Step 实例：全案策划案汇总工序
 */
export const prdSynthesisStep = createStep({
  id: 'prd-synthesis-step',
  inputSchema: PrdSynthesisInputSchema,
  outputSchema: PrdSynthesisOutputSchema,
  execute: async ({ context }) => {
    return await runTaskRecordedStep('prd-synthesis-step', async () => {
      const ctx = (context as any) || {};
      const trigger = ctx.triggerData || ctx;
      const projectId = ctx.projectId || ctx.triggerData?.projectId;
      const store = ProjectStore.getInstance();
      const spineOutput = projectId ? store.getArtifact<any>(projectId, 'planner_spine') : null;
      const sliceOutput = projectId ? store.getArtifact<any>(projectId, 'planner_clips') : null;
      const branchOutput = projectId ? store.getArtifact<any>(projectId, 'planner_branches') : null;

      const title =
        ctx.title ||
        branchOutput?.title ||
        sliceOutput?.title ||
        spineOutput?.title ||
        trigger.title ||
        '未命名短剧';
      const spineScript =
        ctx.spineScript ||
        spineOutput?.spineScript ||
        trigger.spineScript ||
        '';
      const clips =
        ctx.clips ||
        branchOutput?.clips ||
        sliceOutput?.clips ||
        trigger.clips ||
        [];
      const branches =
        ctx.branches ||
        branchOutput?.branches ||
        trigger.branches ||
        [];
      const userToneOrPreference =
        ctx.userToneOrPreference ||
        trigger.userToneOrPreference;

      const result = await executePrdSynthesisStep({
        title,
        spineScript,
        clips,
        branches,
        userToneOrPreference,
      });
      if (projectId) store.setArtifact(projectId, 'planner_prd', result);
      return result;
    });
  },
});
