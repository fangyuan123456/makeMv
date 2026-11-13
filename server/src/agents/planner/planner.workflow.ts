/**
 * agents/planner/planner.workflow.ts
 * 策划子工作流状态机 (Planner Sub-Workflow SSOT) - 基于 Mastra 官方微内核原生 Workflow
 *
 * 核心架构：
 * 1. 采用“倒推流水线”原子工序编排；
 * 2. 纯粹认知解耦：Steps 专注认知计算，不被基础设施 ID 污染；
 * 3. 顺向串接工序：
 *    - Step 1: 黄金主干剧本工序 (writeSpineScriptStep)
 *    - Step 2: 互动切口与剧幕拆分工序 (sliceInteractionsStep)
 *    - Step 3: 分支剧本推演工序 (deriveBranchesStep)
 *    - Step 4: 全案策划案汇总与状态机拓扑汇聚工序 (prdSynthesisStep)
 * 4. 驱动函数 runPlannerWorkflow 统一调度工作流，并无缝写入 ProjectStore 资产黑板。
 */

import { Workflow } from '@mastra/core/workflows';
import { z } from 'zod';
import { ProjectStore } from '../../project-store/ProjectStore.js';
import {
  attachWorkflowStepProgress,
  throwIfRunAborted,
  type ProgressReporter,
  type WorkflowStepProgressConfig,
} from '../../workflow-engine/index.js';
import {
  STAGE,
  PLANNER_STEP,
  writeArtifactFile,
  renderArtifactMarkdown,
} from '../../project-store/artifact-fs.js';

import { SpineScriptInputSchema } from './steps/spine-script/schema.js';
import { writeSpineScriptStep } from './steps/spine-script/step.js';
import {
  sliceInteractionsStep,
  SlicedClipNodeSchema,
  type SlicedClipNode,
} from './steps/interaction-slicing/index.js';
import {
  deriveBranchesStep,
  DerivedBranchNodeSchema,
  type DerivedBranchNode,
} from './steps/branch-derivation/index.js';
import {
  prdSynthesisStep,
  formatGddPrdToMarkdown,
  formatStoryScenesToMarkdown,
  formatPlannerTraceMarkdown,
  resolveBranchTarget,
  resolveClipId,
  UniversalPrdSpecSchema,
  StoryGraphSchema,
  type UniversalPrdSpec,
  type StoryGraph,
} from './steps/prd-synthesis/index.js';
import {
  validateTopologyStep,
  validatePipelineInputTopology,
  TopologyValidationOutputSchema,
  type TopologyValidationOutput,
} from './steps/topology-validation/index.js';
import {
  GDDSchema,
  type GDDArtifact,
  type NarrativeBeat,
  type BranchExpectation,
} from './schema.js';

export const PlannerPipelineInputSchema = z.object({
  projectId: z.string().describe('项目唯一标识'),
  userPrompt: z.string().describe('创作者输入的创意灵感或故事需求'),
  userToneOrPreference: z.string().optional().describe('创作者指定的风格偏好或补充要求'),
});

export type PlannerPipelineInput = z.infer<typeof PlannerPipelineInputSchema>;

export const PlannerPipelineOutputSchema = z.object({
  projectId: z.string(),
  title: z.string(),
  spineScript: z.string(),
  clips: z.array(SlicedClipNodeSchema),
  branches: z.array(DerivedBranchNodeSchema),
  prd: UniversalPrdSpecSchema,
  graph: StoryGraphSchema,
  gdd: GDDSchema,
  validation: TopologyValidationOutputSchema.optional(),
});

export type PlannerPipelineOutput = z.infer<typeof PlannerPipelineOutputSchema>;

/**
 * Mastra 原生 Planner 子工作流无状态工厂 (阶段一流水线唯一事实来源)
 * 每次运行按需实例化独立 Workflow，避免 @mastra/core@0.2.0 在共享实例字段上
 * 覆盖 #actor / #runId，确保多项目并发执行 Stage 1 彻底隔离。
 * 顺向串接 5 大原子工序：主干剧本 ➔ 互动切口 ➔ 分支推演 ➔ 全案 PRD ➔ 图论拓扑门禁校验
 */
export function createPlannerWorkflow() {
  return new Workflow({
    name: 'planner-sub-workflow',
    triggerSchema: SpineScriptInputSchema,
  })
    .step(writeSpineScriptStep)
    .then(sliceInteractionsStep)
    .then(deriveBranchesStep)
    .then(prdSynthesisStep)
    .then(validateTopologyStep)
    .commit();
}

/**
 * 将 4 大原子工序产物融合组装为下游通用的标准策划案 GDDArtifact
 */
export function convertPlannerOutputToGdd(params: {
  title: string;
  clips: SlicedClipNode[];
  branches: DerivedBranchNode[];
  prd: UniversalPrdSpec;
  graph?: StoryGraph;
  spineScript?: string;
}): GDDArtifact {
  const { title, clips, branches, prd, graph, spineScript } = params;

  const normalizedBranches: DerivedBranchNode[] = branches.map((b) => ({
    ...b,
    targetClipId:
      b.resolutionType === 'REJOIN' ? resolveBranchTarget(clips, b) : b.targetClipId,
    rewindTargetClipId: b.rewindTargetClipId
      ? resolveClipId(clips, b.rewindTargetClipId, b.sourceClipId) || b.rewindTargetClipId
      : undefined,
  }));

  const validClipIds = new Set(clips.map((c) => c.clipId));
  const heTitle = graph?.nodes?.find(
    (n) => n.nodeType === 'ENDING' && n.endingType === 'HE'
  )?.title;

  // 1. 构建节拍大纲 beatOutline：如实写入主线顺延边、支线合流边与支线终局
  const beatOutline: NarrativeBeat[] = clips.map((clip, index) => {
    const nextClipId = clips[index + 1]?.clipId;
    const matchedBranches = normalizedBranches.filter((b) => b.sourceClipId === clip.clipId);
    const branchExpectations: BranchExpectation[] = [];

    const inter = clip.interaction;

    if (nextClipId && !clip.isEnding) {
      branchExpectations.push({
        intent:
          (inter?.category === 'CHOICE' ? inter.mainlineChoice : inter?.prompt) ||
          '沿主线继续推进',
        targetBeatId: nextClipId,
        isLoopBack: false,
      });
    }

    for (const b of matchedBranches) {
      if (b.resolutionType === 'ENDING') {
        branchExpectations.push({
          intent: b.choiceText || b.branchTitle,
          targetBeatId: `beat_ending_${b.cutId}`,
          isLoopBack: Boolean(b.rewindTargetClipId),
        });
        continue;
      }
      const target = resolveBranchTarget(clips, b);
      if (target && validClipIds.has(target)) {
        branchExpectations.push({
          intent: b.choiceText || b.branchTitle,
          targetBeatId: target,
          isLoopBack: false,
        });
      }
    }

    return {
      beatId: clip.clipId,
      act: `第 ${clip.level} 幕`,
      title: clip.title,
      dramaticGoal: clip.narrativeText.slice(0, 100),
      gameplayTask:
        inter?.category === 'ACTION'
          ? inter.prompt || '体感探索交互'
          : inter?.category === 'CHOICE'
          ? `抉择：${inter.conflictSummary || clip.title}`
          : '沉浸观赏与交互',
      keyConflicts:
        (inter?.category === 'CHOICE' ? inter.conflictSummary : inter?.prompt) ||
        '剧情推进核心冲突',
      branchExpectations,
      isEnding: clip.isEnding,
      endingTheme: clip.isEnding ? (heTitle || '主线收束 (HE)') : undefined,
    };
  });

  for (const b of normalizedBranches) {
    if (b.resolutionType !== 'ENDING') continue;
    const beatId = `beat_ending_${b.cutId}`;
    if (beatOutline.some((x) => x.beatId === beatId)) continue;
    const rewind = resolveClipId(clips, b.rewindTargetClipId, b.sourceClipId);
    beatOutline.push({
      beatId,
      act: '支线终局',
      title: b.endingTitle || b.branchTitle,
      dramaticGoal: b.verdict || b.narrativeText.slice(0, 100),
      gameplayTask: '终局结算与回溯抉择',
      keyConflicts: b.branchTitle,
      branchExpectations:
        rewind && validClipIds.has(rewind)
          ? [{ intent: '回溯重选', targetBeatId: rewind, isLoopBack: true }]
          : [],
      isEnding: true,
      endingTheme: `${b.endingType || 'BE'}｜${b.endingTitle || b.branchTitle}`,
    });
  }

  if (beatOutline.length === 1) {
    beatOutline[0].branchExpectations.push({
      intent: '沿主线进入终局',
      targetBeatId: 'beat_final_closure',
      isLoopBack: false,
    });
    beatOutline.push({
      beatId: 'beat_final_closure',
      act: '终章·命运收口',
      title: '终局收束',
      dramaticGoal: '所有线索与危机收口',
      gameplayTask: '终局回味与结局图鉴结算',
      keyConflicts: '命运最终审判',
      branchExpectations: [],
      isEnding: true,
      endingTheme: '终局收口',
    });
  }

  const characters = [
    {
      characterId: 'char_protagonist',
      name: '玩家',
      role: prd.playerIdentity || '第一视角亲历者',
      appearance: '',
      personality: '',
    },
  ];

  // 2. 将 prd.initialState 映射回全局状态机（不再写死为空 {}）
  const variables: Record<string, { name: string; initial: number; min: number; max: number }> = {};
  const flags: Record<string, { name: string; initial: boolean }> = {};
  const inventory: string[] = [];

  for (const [key, val] of Object.entries(prd.initialState || {})) {
    if (typeof val === 'number') {
      variables[key] = {
        name: key,
        initial: val,
        min: Math.min(0, val),
        max: Math.max(100, Math.abs(val) * 2),
      };
    } else if (typeof val === 'boolean') {
      flags[key] = { name: key, initial: val };
    } else if (Array.isArray(val)) {
      inventory.push(...val.map(String));
    }
  }

  const markdown = formatGddPrdToMarkdown(prd, clips, normalizedBranches, graph);
  const storyMarkdown = formatStoryScenesToMarkdown(clips, normalizedBranches);
  const storySections: Record<string, { title: string; narrativeText: string }> = {};
  for (const clip of clips) {
    storySections[clip.clipId] = {
      title: clip.title,
      narrativeText: clip.narrativeText || '',
    };
  }
  for (const b of normalizedBranches) {
    storySections[b.cutId] = {
      title: b.branchTitle,
      narrativeText: b.narrativeText || '',
    };
  }

  return {
    schemaVersion: '4.0.0',
    title: prd.gameTitle || title,
    genre: prd.genre || '互动影游',
    hook: prd.premiseAndPerspective || '基于既有视频的互动抉择体验',
    playerRole: prd.playerIdentity || '第一视角亲历者',
    coreLoop: prd.gameplayAndVictorySummary || '观看片段 ➔ 播完互动 ➔ 分支结局',
    markdown,
    storyMarkdown,
    spineScript: spineScript || '',
    prd,
    storySections,
    globalStateMachine: {
      philosophy: prd.outOfFlowSummary,
      variables,
      flags,
      inventory,
    },
    characters,
    beatOutline,
  };
}

const PLANNER_PROGRESS_STEPS: ReadonlyArray<WorkflowStepProgressConfig> = [
  {
    stepId: 'write-spine-script',
    percent: 15,
    note: '正在构思黄金主干剧情与核心戏剧冲突 (write-spine-script)...',
  },
  {
    stepId: 'slice-interactions',
    percent: 35,
    note: '正在将主干剧本切分为高保真视听切片与互动切口 (slice-interactions)...',
  },
  {
    stepId: 'derive-branches',
    percent: 55,
    note: '正在执行逆向拓扑分支推演与结局图鉴收敛 (derive-branches)...',
  },
  {
    stepId: 'prd-synthesis-step',
    percent: 75,
    note: '正在装配全案 GDD PRD 与 StoryGraph 状态机拓扑 (prd-synthesis)...',
  },
  {
    stepId: 'validate-topology-step',
    percent: 92,
    note: '正在执行三幕关卡与分支网络的图论静态拓扑门禁校验 (validate-topology)...',
  },
];

/**
 * 驱动 Mastra 原生策划阶段微内核工作流 (Planner Workflow Run Driver)
 */
export async function runPlannerWorkflow(
  input: PlannerPipelineInput,
  options?: { onProgress?: ProgressReporter }
): Promise<PlannerPipelineOutput> {
  const { projectId, userPrompt, userToneOrPreference } = input;
  throwIfRunAborted('PlannerWorkflow');
  console.log(`[PlannerWorkflow] >>> 启动阶段一微内核工作流: 项目 [${projectId}]`);

  const workflow = createPlannerWorkflow();
  const run = workflow.createRun();
  const stopWatch = attachWorkflowStepProgress(
    workflow,
    run.runId,
    PLANNER_PROGRESS_STEPS,
    options?.onProgress
  );
  let res: Awaited<ReturnType<typeof run.start>>;
  try {
    res = await run.start({ triggerData: { userPrompt, userToneOrPreference } });
  } finally {
    stopWatch();
  }

  throwIfRunAborted('PlannerWorkflow');

  // 严格检查每个工序的执行状态
  for (const [stepId, result] of Object.entries(res.results)) {
    if (result.status === 'failed') {
      throw new Error(
        `[PlannerWorkflow] 步骤 [${stepId}] 执行失败: ${(result as any).error || '未知错误'}`
      );
    }
  }

  const spineResult = (res.results['write-spine-script'] as any)?.output as {
    title: string;
    spineScript: string;
  };
  const sliceResult = (res.results['slice-interactions'] as any)?.output as {
    title: string;
    clips: SlicedClipNode[];
  };
  const branchResult = (res.results['derive-branches'] as any)?.output as {
    title: string;
    branches: DerivedBranchNode[];
  };
  const prdResult = (res.results['prd-synthesis-step'] as any)?.output as {
    title: string;
    prd: UniversalPrdSpec;
    graph: StoryGraph;
  };

  const title = prdResult?.title || sliceResult?.title || spineResult?.title || '未命名短剧';
  const spineScript = spineResult?.spineScript || userPrompt;
  const clips = sliceResult?.clips || [];
  const branches = branchResult?.branches || [];
  const prd = prdResult?.prd;
  const graph = prdResult?.graph;

  const gdd = convertPlannerOutputToGdd({
    title,
    clips,
    branches,
    prd,
    graph,
    spineScript,
  });

  // 门禁校验真正交付出去的 PRD、story.md 与 GDD 一致性
  const realCheck = validatePipelineInputTopology({
    title,
    clips,
    branches,
    prd,
    prdMarkdown: gdd.markdown,
    storyMarkdown: gdd.storyMarkdown,
    gdd,
  });
  const finalValidation: TopologyValidationOutput = {
    valid: realCheck.valid,
    errors: realCheck.errors,
    warnings: realCheck.warnings,
    metrics: realCheck.metrics,
    title,
    clips,
    branches,
  };

  // 运行时黑板：接口不变，但产物正文不再写进 project.json
  const store = ProjectStore.getInstance();
  store.setArtifact(projectId, 'planner_spine', spineResult);
  store.setArtifact(projectId, 'planner_clips', sliceResult);
  store.setArtifact(projectId, 'planner_branches', branchResult);
  store.setArtifact(projectId, 'planner_prd', prdResult);
  store.setArtifact(projectId, 'planner_validation', finalValidation);
  store.setArtifact(projectId, 'gdd', gdd);

  // 阶段二从 meta.title 取剧名，这里回填，否则下游文档标题还是占位名
  const projectData = store.getProject(projectId);
  projectData.meta.title = title;
  store.saveProject(projectData);

  // 按「阶段/工序」编号落盘：.debug 全量 md 展示，外层只放 04 的两份交付文档
  try {
    const writeDebug = (step: string, file: string, heading: string, value: unknown) =>
      writeArtifactFile(
        projectId,
        'debug',
        STAGE.planner,
        step,
        file,
        renderArtifactMarkdown(heading, value)
      );

    const normalizedSpine = (spineResult?.spineScript || '').replace(/^\s*#\s+[^\r\n]+[\r\n]+/, '');
    writeDebug(PLANNER_STEP.spine, 'planner_spine.md', `《${title}》黄金主干剧本`, normalizedSpine);
    writeArtifactFile(
      projectId, 'debug', STAGE.planner, PLANNER_STEP.slices, 'planner_clips.md',
      formatPlannerTraceMarkdown(title, clips, [], 'slices')
    );
    // 03 是 02 的扩写：同一份切片 + 按幕长出的支线，保留原始目标 ID 便于排查
    writeArtifactFile(
      projectId, 'debug', STAGE.planner, PLANNER_STEP.branches, 'planner_branches.md',
      formatPlannerTraceMarkdown(title, clips, branches, 'branches')
    );
    writeDebug(PLANNER_STEP.validation, 'topology_validation.md', '拓扑门禁报告', {
      valid: finalValidation.valid,
      errors: finalValidation.errors,
      warnings: finalValidation.warnings,
      metrics: finalValidation.metrics,
    });

    for (const scope of ['debug', 'delivery'] as const) {
      writeArtifactFile(projectId, scope, STAGE.planner, PLANNER_STEP.prd, 'prd.md', gdd.markdown || '');
      writeArtifactFile(projectId, scope, STAGE.planner, PLANNER_STEP.prd, 'story.md', gdd.storyMarkdown || '');
    }
  } catch (err) {
    console.warn(`[PlannerWorkflow] 写入本地产物文件失败:`, err);
  }

  const gateLabel = finalValidation.valid
    ? 'PASSED ✅'
    : `FAILED ❌ (${finalValidation.errors.length} 项)`;
  console.log(
    `[PlannerWorkflow] <<< 阶段一流水线推演完成！生成主干剧本、${clips.length} 幕切片、${branches.length} 条分支与完整 PRD，最终 GDD 图论门禁: ${gateLabel}`
  );
  if (!finalValidation.valid) {
    console.error(
      `[PlannerWorkflow] 最终交付的 GDD 拓扑不合规:\n${finalValidation.errors.join('\n')}`
    );
  }

  return {
    projectId,
    title,
    spineScript,
    clips,
    branches,
    prd,
    graph,
    gdd,
    validation: finalValidation,
  };
}
