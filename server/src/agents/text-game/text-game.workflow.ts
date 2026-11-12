/**
 * agents/text-game/text-game.workflow.ts
 * 互动文游与分幕可玩切片生成工作流状态机 (Text Game Workflow SSOT)
 *
 * 核心架构：
 * 1. Mastra 官方微内核原生 Workflow 状态机链式编排 (Step -> Then -> Then...)；
 * 2. 实体提取 -> 分幕打包 -> 并发资产生图 -> 技术架构规划 -> 代码生成 -> 静态打包；
 * 3. 每一幕物理自包含为单独的 JSON 文件 (1:1 锚定未来的独立视频切片)；
 * 4. 彻底消灭冗余的 scene_manifest.json 与过程式执行函数，全生命周期统一收敛至 textGameWorkflow。
 */

import { Workflow } from '@mastra/core/workflows';
import { z } from 'zod';
import {
  SingleSceneJsonSchema,
  GlobalEntitiesSchema,
  type GlobalEntities,
  type SingleSceneJson,
  type TextGameArtifact,
} from './schema.js';
import { UniversalPrdSpecSchema, type UniversalPrdSpec } from '../planner/steps/prd-synthesis/schema.js';

import { entityExtractStep } from './steps/entity-extract/index.js';
import { scenePackagingStep } from './steps/scene-packaging/index.js';
import { imageGenPoolStep } from './steps/image-gen-pool/index.js';
import { techPlanStep } from './steps/tech-plan/index.js';
import { codegenStep } from './steps/codegen/index.js';
import { bundlerStep } from './steps/bundler/index.js';
import { persistTextGameArtifacts } from './artifact-writer.js';
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
  forceSceneIds: z
    .array(z.string())
    .optional()
    .describe('玩家替换角色/道具母本图后，只强制重生成指定幕'),
});

export type TextGamePipelineInput = z.infer<typeof TextGamePipelineInputSchema>;

export const TextGamePipelineOutputSchema = z.object({
  projectId: z.string(),
  scenes: z.array(SingleSceneJsonSchema),
  entities: GlobalEntitiesSchema,
  totalScenes: z.number(),
  renderedImages: z.number(),
  bundlePath: z.string(),
  indexPath: z.string(),
  generatedFiles: z.array(z.string()),
});

export type TextGamePipelineOutput = z.infer<typeof TextGamePipelineOutputSchema>;

/**
 * Mastra 原生可编排 Workflow 无状态工厂 (阶段二唯一事实来源)
 * 每次执行创建独立 Workflow 实例，消除跨项目并发运行时的 #actor / #runId 状态覆盖问题。
 */
export function createTextGameWorkflow() {
  return new Workflow({
    name: 'text-game-pipeline-workflow',
    triggerSchema: TextGamePipelineInputSchema,
  })
    .step(entityExtractStep)
    .then(scenePackagingStep)
    .then(imageGenPoolStep)
    .then(techPlanStep)
    .then(codegenStep)
    .then(bundlerStep)
    .commit();
}

const TEXT_GAME_PROGRESS_STEPS: ReadonlyArray<WorkflowStepProgressConfig> = [
  {
    stepId: 'entity-extract-step',
    percent: 12,
    note: '正在提取全剧角色一致性与道具字典 (entity-extract)...',
  },
  {
    stepId: 'scene-packaging-step',
    percent: 28,
    note: '正在基于 Step 4 PRD 与剧本装配分幕独立切片 JSON (scene-packaging)...',
  },
  {
    stepId: 'image-gen-pool-step',
    percent: 48,
    note: '正在并发绘制角色定妆照与关键帧剧照 (image-gen-pool)...',
  },
  {
    stepId: 'tech-plan-step',
    percent: 70,
    note: '正在规划互动文游运行时模块结构与状态映射 (tech-plan)...',
  },
  {
    stepId: 'codegen-step',
    percent: 82,
    note: '正在生成面向对象自驱动座舱与分支引擎 (codegen)...',
  },
  {
    stepId: 'bundler-step',
    percent: 92,
    note: '正在编译打包独立可玩入口 index.html (bundler)...',
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
  let res: Awaited<ReturnType<typeof run.start>>;
  try {
    res = await run.start({ triggerData: input });
  } finally {
    stopWatch();
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

  const imageGenResult = (res.results['image-gen-pool-step'] as any)?.output;
  // 优先取生图工序回填过母本图 URL 的实体字典，保证下游拿到的是落盘后的版本
  const entities =
    (imageGenResult?.entities as GlobalEntities) ||
    ((res.results['entity-extract-step'] as any)?.output as GlobalEntities);
  const codegenResult = (res.results['codegen-step'] as any)?.output;
  const bundlerResult = (res.results['bundler-step'] as any)?.output;

  console.log(
    `[TextGameWorkflow] <<< 阶段二流水线完成！共生成 ${imageGenResult?.totalScenes ?? 0} 幕切片，可玩入口: ${bundlerResult?.indexPath}`
  );

  return {
    projectId,
    scenes: imageGenResult?.scenes || [],
    entities: entities || { artStyle: '', characters: [], items: [] },
    totalScenes: imageGenResult?.totalScenes || 0,
    renderedImages: imageGenResult?.renderedCount || 0,
    bundlePath: bundlerResult?.bundlePath || 'text-game/bundle.js',
    indexPath: bundlerResult?.indexPath || 'text-game/index.html',
    generatedFiles: codegenResult?.generatedFiles || [],
  };
}

/**
 * 将分幕 SingleSceneJson 集合投影为 TextGameArtifact（100% 透传 PRD initialState 与 stateChange）
 */
export function convertScenesToTextGameArtifact(
  title: string,
  scenes: SingleSceneJson[],
  prd?: UniversalPrdSpec,
  entities?: GlobalEntities
): TextGameArtifact {
  const startNode = prd?.startNodeId || scenes[0]?.sceneId || 'S1';
  const entityNameMap = new Map<string, string>();
  for (const c of entities?.characters || []) entityNameMap.set(c.characterId, c.name);
  for (const it of entities?.items || []) entityNameMap.set(it.itemId, it.name);

  return {
    schemaVersion: '2.0.0',
    title,
    startNodeId: startNode,
    initialState: prd?.initialState || {},
    nodes: scenes.map((s) => ({
      id: s.sceneId,
      title: s.title,
      narrativeText:
        s.screenplay.dialogues.map((d) => `【${d.speaker}】${d.line}`).join('\n') ||
        s.screenplay.storyContext,
      visual: {
        scenePrompt: s.visualAnchor.endFrameMoment || s.visualAnchor.promptZh,
        characterPrompt: '',
        composition: s.visualAnchor.cameraAngle,
        imagePromptEn: s.visualAnchor.promptEn,
        imageUrl: s.visualAnchor.sceneImageUrl || s.visualAnchor.sceneImagePath,
        entityNames: (s.entityIds || []).map((id) => entityNameMap.get(id) || id),
      },
      choices: s.interaction.choices.map((c) => {
        const variables: Record<string, number> = { ...(c.stateChange?.add || {}) };
        const setVariables: Record<string, number> = {};
        const flags: Record<string, boolean> = {};
        if (c.stateChange?.set) {
          for (const [k, v] of Object.entries(c.stateChange.set)) {
            if (typeof v === 'boolean') flags[k] = v;
            else if (typeof v === 'number') setVariables[k] = v;
          }
        }
        return {
          id: c.choiceId,
          text: c.text,
          ...(c.condition !== undefined ? { condition: c.condition } : {}),
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
          targetNodeId: c.nextSceneJson.replace(/\.json$/, ''),
        };
      }),
      isEnding: s.interaction.isEnding,
      endingType: (s.interaction.endingType as any) || undefined,
    })),
  };
}
