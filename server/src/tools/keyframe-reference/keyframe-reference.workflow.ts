/**
 * tools/keyframe-reference/keyframe-reference.workflow.ts
 * 关键帧首帧基准图微观子工作流 (Keyframe Reference Micro Sub-Workflow SSOT)
 * 
 * 核心架构特性：
 * 1. 细粒度断点恢复 (Resume & Skip)：自动检测已渲染落盘的关键帧图像，重跑时跳过已完成镜头，绝不重复生图烧卡；
 * 2. 镜头级靶向回退 (Single-Shot Rollback)：支持 targetShotId / targetShotIds 靶向重跑指定镜头，其余镜头资产严格保全；
 * 3. Mastra 原生 DAG 微工作流：状态机拆解为 审计核验 ➔ 并发渲染 ➔ 归并落盘 3 大原子 Step。
 */

import { createWorkflow, createStep } from '@mastra/core/workflows';
import { z } from 'zod';
import fs from 'fs';
import path from 'path';
import { ProjectStore } from '../../project-store/ProjectStore.js';
import { ProposalStore } from '../../project-store/ProposalStore.js';
import { LLMRegistry } from '../../llm/LLMRegistry.js';
import { KeyframeRenderer } from './keyframe.renderer.js';
import { asyncPoolSettled } from '../../utils/concurrency.js';
import { WorkflowStage } from '../../types/index.js';
import { KEYFRAME_REFERENCE_SYSTEM_PROMPT, buildKeyframeReferencePrompt } from './prompt.js';
import {
  KeyframeItemSchema,
  KeyframeReferenceArtifactSchema,
  KeyframeBatchOutputSchema,
  type KeyframeItem,
  type KeyframeReferenceArtifact,
  type KeyframeBatchOutput,
} from './schema.js';

// 子工作流输入契约
export const KeyframeSubWorkflowInputSchema = z.object({
  projectId: z.string().describe('项目唯一标识 ID'),
  sessionId: z.string().optional().describe('当前交互会话 ID'),
  targetShotId: z.string().optional().describe('指定微调单镜 ID (如 shot_1)'),
  targetShotIds: z.array(z.string()).optional().describe('指定批量微调镜头 ID 列表'),
  userFeedback: z.string().optional().describe('关键帧美学或特定镜头修改指令'),
  forceRegenerate: z.boolean().optional().describe('是否强制全量重跑（忽略断点缓存）'),
  proposalId: z.string().optional().describe('关联的人在回路提案 ID (细粒度进度反馈)'),
  isMock: z.boolean().optional().describe('是否为 Mock 模拟测试'),
});

export type KeyframeSubWorkflowInput = z.infer<typeof KeyframeSubWorkflowInputSchema>;

// 中间审计步骤上下文
const KeyframeAuditContextSchema = z.object({
  projectId: z.string(),
  sessionId: z.string().optional(),
  proposalId: z.string().optional(),
  targetShotId: z.string().optional(),
  targetShotIds: z.array(z.string()).optional(),
  userFeedback: z.string().optional(),
  isMock: z.boolean().optional(),
  style: z.string(),
  characterVisualSpecs: z.array(z.any()),
  cachedKeyframes: z.array(KeyframeItemSchema),
  pendingShots: z.array(z.any()),
  allShots: z.array(z.any()),
  existingCreatedAt: z.string().optional(),
});

// Step 1: 关键帧状态审计与断点恢复计算
export const auditKeyframesStep = createStep({
  id: 'step-audit-keyframes',
  description: '核验物理关键帧图片与已有资产，计算断点复用关键帧与需要执行/回退的待渲染分镜',
  inputSchema: KeyframeSubWorkflowInputSchema,
  outputSchema: KeyframeAuditContextSchema,
  execute: async ({ inputData }) => {
    const {
      projectId,
      sessionId,
      targetShotId,
      targetShotIds,
      userFeedback,
      forceRegenerate,
      proposalId,
      isMock,
    } = inputData;

    const store = ProjectStore.getInstance();
    const project = store.getProject(projectId);
    const projectDir = store.getProjectDir(projectId);

    // 1. 获取前置视听分镜资产
    const storyboardArtifact = store.getArtifact<any>(projectId, WorkflowStage.STORYBOARD);
    const shots = storyboardArtifact?.shots || [];

    if (!shots || shots.length === 0) {
      throw new Error('[KeyframeSubWorkflow] 缺少前序视听分镜数据，请先执行前置工序【视听分镜切分】');
    }

    const charArtifact = store.getArtifact<any>(projectId, WorkflowStage.CHARACTER_DESIGN);
    const characterVisualSpecs = charArtifact?.characters || [];
    const style = storyboardArtifact.style || project?.meta?.style || '电影质感，写实光影';

    // 2. 检查既有关键帧资产与本地物理磁盘文件 (Resume & Skip 核心判据)
    const existingArtifact = store.getArtifact<KeyframeReferenceArtifact>(projectId, WorkflowStage.KEYFRAME_REFERENCE);
    const existingShots = Array.isArray(existingArtifact?.shots) ? existingArtifact.shots : [];

    const rollbackSet = new Set<string>([
      ...(targetShotIds || []),
      ...(targetShotId ? [targetShotId] : []),
    ]);

    const cachedKeyframes: KeyframeItem[] = [];
    const pendingShots: any[] = [];

    for (const shot of shots) {
      const isTargetRollback = rollbackSet.has(shot.shotId);
      const existingShot = existingShots.find((s) => s.shotId === shot.shotId);

      let isPhysicalFileValid = false;
      if (existingShot?.imageUrl) {
        if (isMock) {
          isPhysicalFileValid = true;
        } else if (existingShot.imageUrl.startsWith(`/media/${projectId}/`)) {
          const relPath = existingShot.imageUrl.replace(`/media/${projectId}/`, '');
          const absPath = path.join(projectDir, relPath);
          isPhysicalFileValid = fs.existsSync(absPath) && fs.statSync(absPath).size > 0;
        } else {
          isPhysicalFileValid = true;
        }
      }

      // 未指定回退、未强制重跑、且物理图像有效 ➔ 毫秒级断点复用
      if (!forceRegenerate && !isTargetRollback && existingShot && isPhysicalFileValid) {
        cachedKeyframes.push(existingShot);
      } else {
        pendingShots.push({
          ...shot,
          _existing: existingShot,
          _isRollback: isTargetRollback,
        });
      }
    }

    return {
      projectId,
      sessionId,
      proposalId,
      targetShotId,
      targetShotIds,
      userFeedback,
      isMock,
      style,
      characterVisualSpecs,
      cachedKeyframes,
      pendingShots,
      allShots: shots,
      existingCreatedAt: existingArtifact?.createdAt,
    };
  },
});

// Step 2: 并发渲染待生成的首帧关键帧
export const renderPendingKeyframesStep = createStep({
  id: 'step-render-pending-keyframes',
  description: '对未完成或指定回退重做的分镜，执行中文提示词融合推演并并发渲染首帧剧照',
  inputSchema: KeyframeAuditContextSchema,
  outputSchema: z.object({
    projectId: z.string(),
    sessionId: z.string().optional(),
    proposalId: z.string().optional(),
    targetShotId: z.string().optional(),
    targetShotIds: z.array(z.string()).optional(),
    userFeedback: z.string().optional(),
    isMock: z.boolean().optional(),
    style: z.string(),
    cachedKeyframes: z.array(KeyframeItemSchema),
    renderedKeyframes: z.array(KeyframeItemSchema),
    allShots: z.array(z.any()),
    existingCreatedAt: z.string().optional(),
  }),
  execute: async ({ inputData }) => {
    const {
      projectId,
      sessionId,
      proposalId,
      targetShotId,
      targetShotIds,
      userFeedback,
      isMock,
      style,
      characterVisualSpecs,
      cachedKeyframes,
      pendingShots,
      allShots,
      existingCreatedAt,
    } = inputData;

    if (pendingShots.length === 0) {
      // 细粒度断点全命中，跳过任何生图计算
      return {
        projectId,
        sessionId,
        proposalId,
        targetShotId,
        targetShotIds,
        userFeedback,
        isMock,
        style,
        cachedKeyframes,
        renderedKeyframes: [],
        allShots,
        existingCreatedAt,
      };
    }

    const proposalStore = ProposalStore.getInstance();
    const llm = LLMRegistry.get();

    // 1. 批量推演/融合提示词
    const promptMetaMap = new Map<string, { prompt: string; subjectAppearance?: string; sceneEnvironment?: string }>();

    // 提取新镜头进行批量大模型提示词推演
    const shotsNeedingBatchLLM = pendingShots.filter((s) => !s._isRollback || !s._existing);
    if (shotsNeedingBatchLLM.length > 0) {
      try {
        const anchorsSummary = characterVisualSpecs
          .map((c: any) => `角色【${c.name}】(${c.role}): 定妆视觉规范: ${c.visualPrompt}`)
          .join('\n');

        const batchPrompt = buildKeyframeReferencePrompt(style, anchorsSummary, shotsNeedingBatchLLM, userFeedback);
        const batchResult = await llm.generateObject<KeyframeBatchOutput>(
          batchPrompt,
          KeyframeBatchOutputSchema,
          KEYFRAME_REFERENCE_SYSTEM_PROMPT,
          { stage: 'keyframe_prompt_generation', temperature: 0.3 }
        );

        for (const k of batchResult.keyframes || []) {
          promptMetaMap.set(k.shotId, {
            prompt: k.prompt,
            subjectAppearance: k.subjectAppearance,
            sceneEnvironment: k.sceneEnvironment,
          });
        }
      } catch (err) {
        console.warn('[KeyframeSubWorkflow] 批量推演关键帧提示词异常，使用兜底提示词:', err);
      }
    }

    // 2. 并发渲染关键帧首帧图 (限制并发度为 3)
    let completedCount = 0;
    const totalCount = pendingShots.length;

    const renderResults = await asyncPoolSettled<any, KeyframeItem>(
      3,
      pendingShots,
      async (shot: any) => {
        if (proposalId) {
          proposalStore.updateProposalStatus(projectId, proposalId, 'running', {
            lastMessage: `⚡ [${completedCount}/${totalCount}] 正在渲染分镜 (${shot.shotId}) 关键帧...`,
          });
        }

        let meta = promptMetaMap.get(shot.shotId);
        let finalPrompt = meta?.prompt;

        // 如果是回退镜头且有既有数据，融入微调指令
        if (shot._isRollback && shot._existing) {
          const currentPrompt = shot._existing.prompt || shot.visualComposition || shot.shotId;
          finalPrompt = userFeedback ? `${currentPrompt}，${userFeedback}` : currentPrompt;
          meta = {
            prompt: finalPrompt || '',
            subjectAppearance: shot._existing.subjectAppearance,
            sceneEnvironment: shot._existing.sceneEnvironment || shot.visualComposition,
          };
        }

        if (!finalPrompt) {
          finalPrompt = `${shot.visualComposition || shot.actionDescription || shot.shotId}，${style}`;
        }

        const renderRes = await KeyframeRenderer.renderKeyframeImage(
          projectId,
          shot.shotId,
          '16:9',
          finalPrompt,
          { isMock }
        );

        completedCount++;
        if (proposalId) {
          proposalStore.updateProposalStatus(projectId, proposalId, 'running', {
            lastMessage: `⚡ [${completedCount}/${totalCount}] 分镜 (${shot.shotId}) 关键帧已就绪`,
          });
        }

        return {
          shotId: shot.shotId,
          shotNumber: typeof shot.shotNumber === 'number' ? shot.shotNumber : 1,
          subjectAppearance: meta?.subjectAppearance,
          sceneEnvironment: meta?.sceneEnvironment || shot.visualComposition,
          prompt: finalPrompt,
          imageUrl: renderRes.url,
          aspectRatio: '16:9',
          status: 'ready' as const,
          isDegraded: renderRes.isDegraded,
          degradedReason: renderRes.degradedReason,
        };
      }
    );

    const renderedKeyframes: KeyframeItem[] = [];
    for (const r of renderResults) {
      if (r.status === 'fulfilled' && r.value) {
        renderedKeyframes.push(r.value);
      } else {
        console.error('[KeyframeSubWorkflow] 渲染关键帧失败:', r.reason);
      }
    }

    return {
      projectId,
      sessionId,
      proposalId,
      targetShotId,
      targetShotIds,
      userFeedback,
      isMock,
      style,
      cachedKeyframes,
      renderedKeyframes,
      allShots,
      existingCreatedAt,
    };
  },
});

// Step 3: 归并关键帧切片并安全落盘 (SSOT + 本地磁盘)
export const aggregateKeyframeArtifactStep = createStep({
  id: 'step-aggregate-keyframe-artifact',
  description: '将断点复用关键帧与新渲染关键帧按分镜顺序归并，落盘 ProjectStore SSOT 与物理磁盘',
  inputSchema: z.object({
    projectId: z.string(),
    sessionId: z.string().optional(),
    proposalId: z.string().optional(),
    targetShotId: z.string().optional(),
    targetShotIds: z.array(z.string()).optional(),
    userFeedback: z.string().optional(),
    isMock: z.boolean().optional(),
    style: z.string(),
    cachedKeyframes: z.array(KeyframeItemSchema),
    renderedKeyframes: z.array(KeyframeItemSchema),
    allShots: z.array(z.any()),
    existingCreatedAt: z.string().optional(),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    data: KeyframeReferenceArtifactSchema,
    summary: z.string(),
    cachedCount: z.number(),
    renderedCount: z.number(),
  }),
  execute: async ({ inputData }) => {
    const {
      projectId,
      targetShotId,
      targetShotIds,
      cachedKeyframes,
      renderedKeyframes,
      allShots,
      existingCreatedAt,
    } = inputData;

    const store = ProjectStore.getInstance();
    const allMap = new Map<string, KeyframeItem>();

    for (const k of cachedKeyframes) {
      allMap.set(k.shotId, k);
    }
    for (const k of renderedKeyframes) {
      allMap.set(k.shotId, k);
    }

    // 严格按照原分镜头顺序排列
    const orderedShots: KeyframeItem[] = [];
    for (const raw of allShots) {
      const item = allMap.get(raw.shotId);
      if (item) {
        orderedShots.push(item);
      }
    }

    const isRefinement = Boolean(targetShotId || (targetShotIds && targetShotIds.length > 0));
    const effectiveTargetShot = targetShotId || (targetShotIds && targetShotIds.length > 0 ? targetShotIds.join(',') : undefined);

    const artifact: KeyframeReferenceArtifact = {
      shots: orderedShots,
      totalKeyframes: allShots.length,
      completedKeyframes: orderedShots.length,
      isRefinement,
      targetShotId: effectiveTargetShot,
      createdAt: existingCreatedAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    // 1. SSOT 黑板落盘
    store.setArtifact(projectId, WorkflowStage.KEYFRAME_REFERENCE, artifact);

    // 2. 本地物理磁盘保存 keyframes/keyframe_references.json
    exportToLocalDisk(projectId, artifact);

    const cachedCount = cachedKeyframes.length;
    const renderedCount = renderedKeyframes.length;

    let summary = '';
    if (isRefinement) {
      summary = `✨ 关键帧【${effectiveTargetShot}】单镜重绘完成！(复用 ${cachedCount} 个，重绘 ${renderedCount} 个)`;
    } else if (cachedCount > 0 && renderedCount === 0) {
      summary = `⚡ 断点恢复：全片 ${cachedCount} 个分镜关键帧参考图均完整，已毫秒级全部复用！`;
    } else if (cachedCount > 0) {
      summary = `🖼️ 关键帧生成完成！(断点秒级复用 ${cachedCount} 个，增量渲染 ${renderedCount} 个)`;
    } else {
      summary = `🖼️ 全片 ${orderedShots.length} 个分镜的高清首帧关键帧参考图生成完成并落盘！`;
    }

    return {
      success: true,
      data: artifact,
      summary,
      cachedCount,
      renderedCount,
    };
  },
});

function exportToLocalDisk(projectId: string, artifact: KeyframeReferenceArtifact) {
  try {
    const store = ProjectStore.getInstance();
    const projectDir = store.getProjectDir(projectId);
    const kfDir = path.join(projectDir, 'keyframes');
    if (!fs.existsSync(kfDir)) {
      fs.mkdirSync(kfDir, { recursive: true });
    }
    fs.writeFileSync(
      path.join(kfDir, 'keyframe_references.json'),
      JSON.stringify(artifact, null, 2),
      'utf-8'
    );
  } catch (e) {
    console.warn('[KeyframeSubWorkflow] 本地磁盘落盘异常 (非致命):', e);
  }
}

// 导出纯粹的 Mastra 微观子工作流实例 (SSOT)
export const keyframeReferenceSubWorkflow = createWorkflow({
  id: 'subwf-keyframe-reference',
  description: '关键帧首帧基准图微观生产子工作流：具备细粒度断点恢复 (Resume & Skip) 与单镜头靶向回退 (Single-Shot Rollback) 能力',
  inputSchema: KeyframeSubWorkflowInputSchema,
  outputSchema: z.object({
    success: z.boolean(),
    data: KeyframeReferenceArtifactSchema,
    summary: z.string(),
    cachedCount: z.number(),
    renderedCount: z.number(),
  }),
})
  .then(auditKeyframesStep)
  .then(renderPendingKeyframesStep)
  .then(aggregateKeyframeArtifactStep)
  .commit();
