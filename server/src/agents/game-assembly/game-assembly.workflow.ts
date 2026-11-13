/**
 * agents/game-assembly/game-assembly.workflow.ts
 * 互动文游与分幕可玩切片生成工作流状态机 (Text Game Workflow SSOT)
 *
 * 核心架构：
 * 1. Mastra 官方微内核原生 Workflow 状态机链式编排 (Step -> Then -> Then...)；
 * 2. 母本提取（人 / 物 / 地）-> 母本出图 -> 分幕装配 -> 技术架构规划（模型）-> 按拓扑多轮编码（模型）-> 静态打包；
 * 3. 每一幕物理自包含为单独的 JSON 文件 (1:1 锚定未来的独立视频切片)；
 * 4. 阶段二只管「文字、场景、接线」三样，不生产任何画面——画面属阶段三的镜头活儿。
 */

import { Workflow } from '@mastra/core/workflows';
import { z } from 'zod';
import { ProjectStore } from '../../project-store/ProjectStore.js';
import {
  SingleSceneJsonSchema,
  StoryScriptSchema,
  GlobalEntitiesSchema,
  type GlobalEntities,
  type SingleSceneJson,
  type StoryScript,
  type TextGameArtifact,
  type TextGameChoice,
} from './schema.js';

import { techPlanStep } from './steps/tech-plan/index.js';
import { codegenStep } from './steps/codegen/index.js';
import {
  STAGE,
  TEXT_GAME_STEP,
  writeArtifactFile,
  renderArtifactMarkdown,
} from '../../project-store/artifact-fs.js';
import {
  attachWorkflowStepProgress,
  throwIfRunAborted,
  type ProgressReporter,
  type WorkflowStepProgressConfig,
} from '../../workflow-engine/index.js';

export const GameAssemblyPipelineInputSchema = z.object({
  projectId: z.string().describe('项目唯一标识'),
  title: z.string().optional(),
  prd: z.any().optional(),
  storyMarkdown: z.string().optional(),
  concurrency: z.number().default(4),
  filmSpec: z.any().optional(),
  lookdev: GlobalEntitiesSchema.optional(),
  scenes: z.array(SingleSceneJsonSchema).optional(),
  script: z.any().optional(),
});

export type GameAssemblyPipelineInput = z.infer<typeof GameAssemblyPipelineInputSchema>;

export const GameAssemblyPipelineOutputSchema = z.object({
  projectId: z.string(),
  scenes: z.array(SingleSceneJsonSchema),
  script: StoryScriptSchema,
  entities: GlobalEntitiesSchema,
  totalScenes: z.number(),
  renderedImages: z.number(),
  indexPath: z.string(),
  generatedFiles: z.array(z.string()),
});

export type GameAssemblyPipelineOutput = z.infer<typeof GameAssemblyPipelineOutputSchema>;

/**
 * Mastra 原生可编排 Workflow 无状态工厂 (阶段二唯一事实来源)
 * 每次执行创建独立 Workflow 实例，消除跨项目并发运行时的 #actor / #runId 状态覆盖问题。
 */
export function createGameAssemblyWorkflow() {
  return new Workflow({
    name: 'game-assembly-pipeline-workflow',
    triggerSchema: GameAssemblyPipelineInputSchema,
  })
    .step(techPlanStep)
    .then(codegenStep)
    .commit();
}

const GAME_ASSEMBLY_PROGRESS_STEPS: ReadonlyArray<WorkflowStepProgressConfig> = [
  {
    stepId: 'tech-plan-step',
    percent: 60,
    note: '正在规划运行时文件划分与依赖拓扑 (tech-plan)...',
  },
  {
    stepId: 'codegen-step',
    percent: 90,
    note: '正在按依赖拓扑逐文件编码互动影游运行时并生成可玩入口 (codegen)...',
  },
];

/**
 * 驱动 Mastra 原生阶段二工作流 (Workflow Run Driver)
 */
export async function runGameAssemblyWorkflow(
  projectId: string,
  options?: { onProgress?: ProgressReporter }
): Promise<GameAssemblyPipelineOutput> {
  const store = ProjectStore.getInstance();
  const project = store.getProject(projectId);
  const title = project.meta.title || '互动影游';
  const normalizedInput = {
    projectId,
    title,
    concurrency: 4,
    filmSpec: store.getArtifact<any>(projectId, 'film_spec'),
  };
  throwIfRunAborted('GameAssemblyWorkflow');
  console.log(`[GameAssemblyWorkflow] >>> 启动阶段二微内核工作流: 项目 [${projectId}] - 《${title}》`);

  const workflow = createGameAssemblyWorkflow();
  const run = workflow.createRun();
  const stopWatch = attachWorkflowStepProgress(
    workflow,
    run.runId,
    GAME_ASSEMBLY_PROGRESS_STEPS,
    options?.onProgress
  );

  // 工序级增量落盘：任一步成功即写该步 .debug 镜像。
  // 若只在流水线末尾统一落盘，中途失败（如 lookdev 模型超时）会让整个阶段一个产物都不留。
  const persistedSteps = new Set<string>();
  const stopPersist = workflow.watch((state: any) => {
    if (state?.runId && state.runId !== run.runId) return;
    const stepResults: Record<string, any> = state?.context?.steps || {};
    const newlyDone = Object.keys(stepResults).filter(
      (id) => stepResults[id]?.status === 'success' && !persistedSteps.has(id)
    );
    if (newlyDone.length === 0) return;
    for (const id of newlyDone) persistedSteps.add(id);
    try {
      persistGameAssemblyArtifacts(projectId, title, stepResults);
    } catch (err) {
      console.warn(`[GameAssemblyWorkflow] 工序 [${newlyDone.join(',')}] 增量落盘失败:`, err);
    }
  });

  let res: Awaited<ReturnType<typeof run.start>>;
  try {
    res = await run.start({ triggerData: normalizedInput });
  } finally {
    stopWatch();
    stopPersist();
  }

  throwIfRunAborted('GameAssemblyWorkflow');

  // 严格检查每个工序的执行状态
  for (const [stepId, result] of Object.entries(res.results)) {
    if (result.status === 'failed') {
      throw new Error(
        `[GameAssemblyWorkflow] 步骤 [${stepId}] 执行失败: ${(result as any).error || '未知错误'}`
      );
    }
  }

  // 各工序产物按「阶段/工序」编号落盘：.debug 全量 md，外层只放每幕剧本交付文档
  try {
    persistGameAssemblyArtifacts(projectId, title, res.results as Record<string, any>);
  } catch (err) {
    console.warn(`[GameAssemblyWorkflow] 写入阶段二产物文件失败:`, err);
  }

  const scenes: SingleSceneJson[] = [];
  const script: StoryScript = {
    startSceneId: scenes[0]?.sceneId || 'S1',
    initialState: {},
    scenes: [],
  };
  const entities =
    store.getArtifact<any>(projectId, 'lookdev_draft')?.entities ||
    ({ artStyle: '', characters: [], items: [], locations: [] } as GlobalEntities);
  const codegenResult = (res.results['codegen-step'] as any)?.output;

  console.log(
    `[GameAssemblyWorkflow] <<< 阶段二流水线完成！共装配 ${scenes.length} 幕切片，可玩入口: ${codegenResult?.indexPath}`
  );

  return {
    projectId,
    scenes,
    script,
    entities,
    totalScenes: scenes.length,
    renderedImages: 0,
    indexPath: codegenResult?.indexPath || 'game-assembly/index.html',
    generatedFiles: codegenResult?.generatedFiles || [],
  };
}

/**
 * 把一幕切片渲染成可直接拿去生图 / 生成视频的剧本文档。
 *
 * 这是本阶段独有的业务渲染（scene 对象 → 人读的剧本），不是通用 dump，
 * 所以留在 workflow 内，不下沉到 project-store 的通用渲染器里。
 */
function renderSceneMarkdown(scene: any, logic?: any): string {
  const s = scene || {};
  const l = logic || {};

  const lines: string[] = [
    `# ${s.sceneId || '?'} · ${s.title || '未命名'}`,
    '',
    `> 背景图：${s.background || '（无）'}`,
    '',
    '## 正文',
    '',
    s.text || '（无）',
    '',
    '## 播放逻辑',
    '',
  ];

  if (l.interaction) {
    lines.push(`- **介入点**（${l.interaction.kind || 'CLICK'}）：${l.interaction.prompt || '-'}`);
    if (l.interaction.feedback) lines.push(`  - 反馈：${l.interaction.feedback}`);
  }
  if (Array.isArray(l.choices) && l.choices.length > 0) {
    for (const c of l.choices) lines.push(`- **选项**：${c.text} → \`${c.to}\``);
  }
  if (l.next) lines.push(`- **播完去**：\`${l.next}\``);
  if (l.ending) {
    lines.push(
      `- **终局**：${l.ending.type || '-'}《${l.ending.title || '-'}》`,
      `  - 判词：${l.ending.verdict || '-'}`
    );
    if (l.ending.rewindTo) lines.push(`  - 可回溯到：\`${l.ending.rewindTo}\``);
  }
  if (!l.interaction && !l.next && !l.ending && !(l.choices || []).length) {
    lines.push('（本幕没有记录逻辑）');
  }

  return `${lines.join('\n')}\n`;
}

/**
 * 各工序产物按「阶段/工序」编号落盘：.debug 留全量 md，外层只放每幕剧本交付文档。
 *
 * 运行时数据（scenes/*.json、game-assembly/*、assets/*）由各工序自己按原路径写出，
 * 它们被 SceneLoader / 前端 iframe / 媒体 URL 硬引用，不在归档范围内。
 *
 * 幂等且支持增量调用：只写「已完成工序」的镜像，未执行到的工序不产空文件，
 * 因此可以在运行过程中被 watch 逐步调用（中途失败也留痕），末尾再整体兜底一次。
 *
 * @internal 不对外导出（index.ts 未转发），只为 scripts/diag-artifact-incremental.ts 提供回归入口
 */
export function persistGameAssemblyArtifacts(
  projectId: string,
  title: string,
  results: Record<string, any>
): void {
  const writeDebug = (step: string, file: string, heading: string, value: unknown) =>
    writeArtifactFile(
      projectId,
      'debug',
      STAGE.textGame,
      step,
      file,
      renderArtifactMarkdown(heading, value)
    );

  const out = (stepId: string) => (results[stepId] as any)?.output;
  // 工序是否真的跑过：末尾整体调用时 results 带 status，增量调用时直接是产出对象
  const isDone = (stepId: string) => {
    const r = results[stepId];
    if (!r) return false;
    if (typeof (r as any).status === 'string') return (r as any).status === 'success';
    return (r as any).output !== undefined;
  };

  if (isDone('tech-plan-step')) {
    writeDebug(TEXT_GAME_STEP.techPlan, 'tech_plan.md', `《${title}》技术架构方案`, out('tech-plan-step') || {});
  }
  if (isDone('codegen-step')) {
    writeDebug(TEXT_GAME_STEP.codegen, 'generated_files.md', `《${title}》源码生成清单`, out('codegen-step') || {});
  }
  if (isDone('codegen-step')) {
    writeDebug(TEXT_GAME_STEP.codegen, 'text_game_manifest.md', `《${title}》可玩产物清单`, {
      playableIndex: out('codegen-step')?.indexPath || 'game-assembly/index.html',
    });
  }
}


/**
 * 把「素材（scenes）+ 播放表（script）」投影成前端与拓扑图用的文游视图
 *
 * 素材文件里已经没有玩法，所以选项与结局只能从 script 取；
 * 没有选项但有 next 的幕补一条「继续」边，保证故事图谱仍然连通。
 */
function toLegacyChoice(
  id: string,
  text: string,
  to: string,
  change?: { add?: Record<string, number>; set?: Record<string, unknown> }
): TextGameChoice {
  const variables: Record<string, number> = { ...(change?.add || {}) };
  const setVariables: Record<string, number> = {};
  const flags: Record<string, boolean> = {};
  if (change?.set) {
    for (const [k, v] of Object.entries(change.set)) {
      if (typeof v === 'boolean') flags[k] = v;
      else if (typeof v === 'number') setVariables[k] = v;
    }
  }
  return {
    id,
    text,
    requiredFlags: [],
    requiredItems: [],
    requiredVariables: {},
    stateMutation: {
      variables,
      setVariables,
      flags,
      inventoryAdd: [],
      inventoryRemove: [],
    },
    targetNodeId: to,
  };
}

export function convertScenesToGameAssemblyArtifact(
  title: string,
  scenes: SingleSceneJson[],
  script: StoryScript
): TextGameArtifact {
  const logicByScene = new Map((script?.scenes || []).map((s) => [s.sceneId, s]));

  return {
    schemaVersion: '2.0.0',
    title,
    startNodeId: script?.startSceneId || scenes[0]?.sceneId || 'S1',
    initialState: (script?.initialState || {}) as TextGameArtifact['initialState'],
    nodes: scenes.map((s) => {
      const logic = logicByScene.get(s.sceneId);
      const choices = logic?.choices?.length
        ? logic.choices.map((c, idx) =>
            toLegacyChoice(`${s.sceneId}_c${idx + 1}`, c.text, c.to, c.stateChange)
          )
        : logic?.next
          ? [toLegacyChoice(`${s.sceneId}_next`, '继续', logic.next)]
          : [];

      return {
        id: s.sceneId,
        title: s.title,
        narrativeText: s.text,
        visual: {
          scenePrompt: '',
          characterPrompt: '',
          composition: '',
          imagePromptEn: '',
          ...(s.background ? { imageUrl: s.background } : {}),
          entityNames: [],
        },
        choices,
        isEnding: Boolean(logic?.ending),
        ...(logic?.ending?.type ? { endingType: logic.ending.type } : {}),
      };
    }),
  };
}
