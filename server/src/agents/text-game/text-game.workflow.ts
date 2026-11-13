/**
 * agents/text-game/text-game.workflow.ts
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
import { UniversalPrdSpecSchema, type UniversalPrdSpec } from '../planner/steps/prd-synthesis/schema.js';

import {
  lookdevExtractStep,
  LookdevExtractInputSchema,
  type LookdevExtractInput,
} from './steps/lookdev-extract/index.js';
import { lookdevRenderStep, type LookdevRenderOutput } from './steps/lookdev-render/index.js';
import { sceneAssemblyStep } from './steps/scene-assembly/index.js';
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

export const TextGamePipelineInputSchema = z.object({
  projectId: z.string().describe('项目唯一标识'),
  title: z.string().describe('短剧标题'),
  prd: UniversalPrdSpecSchema.describe('Step 4 唯一事实来源通用策划案 PRD'),
  storyMarkdown: z.string().describe('Step 4 交付的按幕剧本全文 story.md（与 prd.clips[].id 1:1 对齐）'),
  concurrency: z.number().default(4).describe('图片生成并发池大小'),
});

export type TextGamePipelineInput = z.infer<typeof TextGamePipelineInputSchema>;

export const TextGamePipelineOutputSchema = z.object({
  projectId: z.string(),
  scenes: z.array(SingleSceneJsonSchema),
  script: StoryScriptSchema,
  entities: GlobalEntitiesSchema,
  totalScenes: z.number(),
  renderedImages: z.number(),
  indexPath: z.string(),
  generatedFiles: z.array(z.string()),
});

export type TextGamePipelineOutput = z.infer<typeof TextGamePipelineOutputSchema>;

/** 定妆段（工作流整体触发）输入：提取所需字段 + 出图的两个旋钮 */
export const LookdevWorkflowInputSchema = LookdevExtractInputSchema.extend({
  concurrency: z.number().default(4).describe('母本图并发池大小'),
  force: z.boolean().default(false).describe('强制重绘全部母本'),
});

export type LookdevWorkflowInput = z.infer<typeof LookdevWorkflowInputSchema>;

/**
 * Mastra 原生可编排 Workflow 无状态工厂 (阶段二唯一事实来源)
 * 每次执行创建独立 Workflow 实例，消除跨项目并发运行时的 #actor / #runId 状态覆盖问题。
 */
export function createTextGameWorkflow() {
  return new Workflow({
    name: 'text-game-pipeline-workflow',
    triggerSchema: TextGamePipelineInputSchema,
  })
    .step(lookdevExtractStep)
    .then(lookdevRenderStep)
    .then(sceneAssemblyStep)
    .then(techPlanStep)
    .then(codegenStep)
    .commit();
}

const TEXT_GAME_PROGRESS_STEPS: ReadonlyArray<WorkflowStepProgressConfig> = [
  {
    stepId: 'lookdev-extract-step',
    percent: 14,
    note: '正在提取角色 / 道具 / 场景与剧幕归属，撰写母本说明书 (lookdev-extract)...',
  },
  {
    stepId: 'lookdev-render-step',
    percent: 26,
    note: '正在绘制全部母本图 (lookdev-render)...',
  },
  {
    stepId: 'scene-assembly-step',
    percent: 38,
    note: '正在按场景母本与剧幕编号装配分幕 JSON (scene-assembly)...',
  },
  {
    stepId: 'tech-plan-step',
    percent: 58,
    note: '正在规划运行时文件划分与依赖拓扑 (tech-plan)...',
  },
  {
    stepId: 'codegen-step',
    percent: 88,
    note: '正在按依赖拓扑逐文件编码互动影游运行时并生成可玩入口 (codegen)...',
  },
];

/**
 * 驱动 Mastra 原生阶段二工作流 (Workflow Run Driver)
 */
export async function runTextGameWorkflow(
  input: TextGamePipelineInput,
  options?: { onProgress?: ProgressReporter }
): Promise<TextGamePipelineOutput> {
  const { projectId, title } = input;
  throwIfRunAborted('TextGameWorkflow');
  console.log(`[TextGameWorkflow] >>> 启动阶段二微内核工作流: 项目 [${projectId}] - 《${title}》`);

  const workflow = createTextGameWorkflow();
  const run = workflow.createRun();
  const stopWatch = attachWorkflowStepProgress(
    workflow,
    run.runId,
    TEXT_GAME_PROGRESS_STEPS,
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
      persistTextGameArtifacts(projectId, title, stepResults);
    } catch (err) {
      console.warn(`[TextGameWorkflow] 工序 [${newlyDone.join(',')}] 增量落盘失败:`, err);
    }
  });

  let res: Awaited<ReturnType<typeof run.start>>;
  try {
    res = await run.start({ triggerData: input });
  } finally {
    stopWatch();
    stopPersist();
  }

  throwIfRunAborted('TextGameWorkflow');

  // 严格检查每个工序的执行状态
  for (const [stepId, result] of Object.entries(res.results)) {
    if (result.status === 'failed') {
      throw new Error(
        `[TextGameWorkflow] 步骤 [${stepId}] 执行失败: ${(result as any).error || '未知错误'}`
      );
    }
  }

  // 各工序产物按「阶段/工序」编号落盘：.debug 全量 md，外层只放每幕剧本交付文档
  try {
    persistTextGameArtifacts(projectId, title, res.results as Record<string, any>);
  } catch (err) {
    console.warn(`[TextGameWorkflow] 写入阶段二产物文件失败:`, err);
  }

  const assemblyResult = (res.results['scene-assembly-step'] as any)?.output;
  const scenes: SingleSceneJson[] = assemblyResult?.scenes || [];
  const script: StoryScript = assemblyResult?.script || {
    startSceneId: scenes[0]?.sceneId || 'S1',
    initialState: {},
    scenes: [],
  };
  const entities =
    ((res.results['lookdev-render-step'] as any)?.output?.entities as GlobalEntities) ||
    ((res.results['lookdev-extract-step'] as any)?.output?.entities as GlobalEntities) ||
    ({ artStyle: '', characters: [], items: [], locations: [] } as GlobalEntities);
  const codegenResult = (res.results['codegen-step'] as any)?.output;

  console.log(
    `[TextGameWorkflow] <<< 阶段二流水线完成！共装配 ${scenes.length} 幕切片，可玩入口: ${codegenResult?.indexPath}`
  );

  return {
    projectId,
    scenes,
    script,
    entities,
    totalScenes: scenes.length,
    renderedImages: (res.results['lookdev-render-step'] as any)?.output?.renderedCount || 0,
    indexPath: codegenResult?.indexPath || 'text-game/index.html',
    generatedFiles: codegenResult?.generatedFiles || [],
  };
}

/**
 * 定妆段独立执行：提取 → 出图，产完即挂起等创作者确认。
 *
 * 为什么单独开一个工作流：确认门禁必须在装配前停下，而 Mastra 0.2 的 step 不能中途挂起。
 * 所以拆成「定妆 → 确认 → 装配」两段执行：
 * - 本函数 = 定妆段（提取 + 出图两个工序）；
 * - 确认后由 runTextGameWorkflow 续跑，靠 runTaskRecordedStep 的缓存命中跳过定妆段，
 *   直接从分幕装配开始，不会重复调模型、也不会重画母本图。
 */
export function createLookdevWorkflow() {
  return new Workflow({
    name: 'lookdev-workflow',
    triggerSchema: LookdevWorkflowInputSchema,
  })
    .step(lookdevExtractStep)
    .then(lookdevRenderStep)
    .commit();
}

export async function runLookdevWorkflow(
  input: LookdevWorkflowInput,
  options?: { onProgress?: ProgressReporter }
): Promise<LookdevRenderOutput> {
  throwIfRunAborted('LookdevWorkflow');
  const { title } = input;
  console.log(`[LookdevWorkflow] >>> 启动定妆段（提取 → 出图）: 《${title}》`);

  const workflow = createLookdevWorkflow();
  const run = workflow.createRun();
  const stopWatch = attachWorkflowStepProgress(
    workflow,
    run.runId,
    [
      {
        stepId: 'lookdev-extract-step',
        percent: 25,
        note: '正在提取角色 / 道具 / 场景与剧幕归属，撰写母本说明书 (lookdev-extract)...',
      },
      {
        stepId: 'lookdev-render-step',
        percent: 60,
        note: '正在绘制全部母本图 (lookdev-render)...',
      },
    ],
    options?.onProgress
  );

  let res: Awaited<ReturnType<typeof run.start>>;
  try {
    res = await run.start({ triggerData: input });
  } finally {
    stopWatch();
  }

  throwIfRunAborted('LookdevWorkflow');

  for (const stepId of ['lookdev-extract-step', 'lookdev-render-step']) {
    const result = res.results[stepId] as any;
    if (result?.status === 'failed') {
      throw new Error(
        `[LookdevWorkflow] 步骤 [${stepId}] 执行失败: ${result.error || '未知错误'}`
      );
    }
  }

  const output = (res.results['lookdev-render-step'] as any)?.output as LookdevRenderOutput;
  if (!output?.entities) {
    throw new Error('[LookdevWorkflow] 未产出实体字典');
  }

  try {
    persistTextGameArtifacts(input.projectId, title, res.results as Record<string, any>);
  } catch (err) {
    console.warn('[LookdevWorkflow] 工序落盘失败:', err);
  }

  console.log(
    `[LookdevWorkflow] <<< 定妆完成：${output.entities.characters.length} 角色 / ${output.entities.items.length} 道具 / ` +
      `${output.entities.locations?.length ?? 0} 场景，母本图 新绘 ${output.renderedCount} / 复用 ${output.reusedCount} / 失败 ${output.failedCount}，等待确认`
  );
  return output;
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
 * 运行时数据（scenes/*.json、text-game/*、assets/*）由各工序自己按原路径写出，
 * 它们被 SceneLoader / 前端 iframe / 媒体 URL 硬引用，不在归档范围内。
 *
 * 幂等且支持增量调用：只写「已完成工序」的镜像，未执行到的工序不产空文件，
 * 因此可以在运行过程中被 watch 逐步调用（中途失败也留痕），末尾再整体兜底一次。
 *
 * @internal 不对外导出（index.ts 未转发），只为 scripts/diag-artifact-incremental.ts 提供回归入口
 */
export function persistTextGameArtifacts(
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

  const extracted = out('lookdev-extract-step');
  const rendered = out('lookdev-render-step');
  const assembly = out('scene-assembly-step');
  const scenes: any[] = assembly?.scenes || [];

  // 01 母本说明书：人 / 物 / 地各自长什么样、生图提示词、每幕归属哪个空间
  if (isDone('lookdev-extract-step') && extracted?.entities) {
    writeDebug(TEXT_GAME_STEP.lookdevExtract, 'lookdev.md', `《${title}》母本说明书（人 / 物 / 地）`, {
      artStyle: extracted.entities.artStyle || '',
      characters: (extracted.entities.characters || []).map((c: any) => ({
        name: c.name || c.characterId,
        id: c.characterId,
        identity: c.identity,
        appearanceSummary: c.appearanceSummary,
        promptZh: c.promptZh,
      })),
      items: (extracted.entities.items || []).map((i: any) => ({
        name: i.name || i.itemId,
        id: i.itemId,
        description: i.description,
        appearanceSummary: i.appearanceSummary,
        promptZh: i.promptZh,
      })),
      locations: (extracted.entities.locations || []).map((l: any) => ({
        name: l.name || l.locationId,
        id: l.locationId,
        atmosphere: l.atmosphere,
        appearanceSummary: l.appearanceSummary,
        promptZh: l.promptZh,
        sceneIds: (l.sceneIds || []).join('、'),
      })),
    });
  }

  // 02 母本图清单：这一轮画出来的资产与图链接，确认时看的就是这一份
  if (isDone('lookdev-render-step') && rendered?.entities) {
    writeDebug(TEXT_GAME_STEP.lookdevRender, 'lookdev.md', `《${title}》母本图清单`, {
      summary: `新绘 ${rendered.renderedCount ?? 0} 张 / 复用 ${rendered.reusedCount ?? 0} 张 / 失败 ${rendered.failedCount ?? 0} 张`,
      characters: (rendered.entities.characters || []).map((c: any) => ({
        name: c.name || c.characterId,
        id: c.characterId,
        image: c.referenceImageUrl || '（未生成）',
      })),
      items: (rendered.entities.items || []).map((i: any) => ({
        name: i.name || i.itemId,
        id: i.itemId,
        image: i.referenceImageUrl || '（未生成）',
      })),
      locations: (rendered.entities.locations || []).map((l: any) => ({
        name: l.name || l.locationId,
        id: l.locationId,
        sceneIds: (l.sceneIds || []).join('、'),
        image: l.referenceImageUrl || '（未生成）',
      })),
    });
  }

  if (isDone('scene-assembly-step')) {
    // 工序级索引：正文已按幕拆成 S1.md / S1.1.md 等，这里只留清单，不重复铺一遍剧本
    writeDebug(TEXT_GAME_STEP.scenes, 'scenes.md', `《${title}》分幕装配`, {
      summary: assembly?.summary || '',
      totalScenes: scenes.length,
      scenes: scenes.map((s: any) => {
        const logic = (assembly?.script?.scenes || []).find((x: any) => x.sceneId === s.sceneId);
        return {
          sceneId: s.sceneId,
          title: s.title,
          background: s.background ? '有' : '缺',
          interaction: logic?.interaction?.kind || '-',
          choices: (logic?.choices || []).length,
          next: logic?.next || '-',
          ending: logic?.ending?.type || '-',
        };
      }),
    });

    // 每幕剧本文档是给下阶段做视频用的交付物：.debug 留镜像，外层留真实形态
    const logicByScene = new Map(
      ((assembly?.script?.scenes || []) as any[]).map((x: any) => [x.sceneId, x])
    );
    for (const scene of scenes) {
      if (!scene?.sceneId) continue;
      const filename = `${scene.sceneId}.md`;
      const content = renderSceneMarkdown(scene, logicByScene.get(scene.sceneId));
      writeArtifactFile(projectId, 'debug', STAGE.textGame, TEXT_GAME_STEP.scenes, filename, content);
      writeArtifactFile(
        projectId,
        'delivery',
        STAGE.textGame,
        TEXT_GAME_STEP.scenes,
        filename,
        content
      );
    }
  }

  if (isDone('tech-plan-step')) {
    writeDebug(TEXT_GAME_STEP.techPlan, 'tech_plan.md', `《${title}》技术架构方案`, out('tech-plan-step') || {});
  }
  if (isDone('codegen-step')) {
    writeDebug(TEXT_GAME_STEP.codegen, 'generated_files.md', `《${title}》源码生成清单`, out('codegen-step') || {});
  }
  if (isDone('codegen-step') && scenes.length > 0) {
    const entitiesForManifest =
      rendered?.entities || extracted?.entities || { artStyle: '', characters: [], items: [], locations: [] };
    writeDebug(TEXT_GAME_STEP.codegen, 'text_game_manifest.md', `《${title}》可玩产物清单`, {
      playableIndex: out('codegen-step')?.indexPath || 'text-game/index.html',
      totalScenes: scenes.length,
      scenes: scenes.map((s: any) => ({
        sceneId: s.sceneId,
        title: s.title,
        jsonFile: `scenes/${s.sceneId}.json`,
      })),
      entities: {
        artStyle: entitiesForManifest.artStyle || '',
        characters: (entitiesForManifest.characters || []).length,
        items: (entitiesForManifest.items || []).length,
        locations: (entitiesForManifest.locations || []).length,
      },
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

export function convertScenesToTextGameArtifact(
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
