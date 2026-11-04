/**
 * mastra/workflows/steps/stage-steps.ts
 * 基于 Mastra createStep 的 8 大视听工序标准 Step 微内核 (SSOT)
 * 
 * 核心特性：
 * 1. 强类型 Zod 契约约束；
 * 2. 纯数据进出，无越权直接写状态；
 * 3. 产物落盘 ProjectStore SSOT；
 * 4. 原生集成 Mastra suspend/resume 人在回路裁决。
 */

import { createStep } from '@mastra/core/workflows';
import { z } from 'zod';
import {
  storyBibleTool,
  sceneScriptTool,
  storyboardTool,
  criticReviewTool,
  fmvPackagingTool,
} from '../../../../tools/index.js';
import { characterPortraitSubWorkflow } from '../../../../tools/character-portrait/index.js';
import { keyframeReferenceSubWorkflow } from '../../../../tools/keyframe-reference/index.js';
import { videoProductionSubWorkflow } from '../../../../tools/video-production/index.js';
import { ProjectStore } from '../../../../project-store/ProjectStore.js';
import { WorkflowStage } from '../../../../types/index.js';

// 通用工作流数据载体 Schema
export const WorkflowContextSchema = z.object({
  projectId: z.string(),
  sessionId: z.string().optional(),
  activeStage: z.string().optional(),
  feedback: z.string().optional(),
  payload: z.record(z.any()).optional(),
  overrideParams: z.record(z.any()).optional(),
  criticGateStatus: z.string().optional(),
  lastSummary: z.string().optional(),
  toolResult: z.any().optional(),
});

export type WorkflowContext = z.infer<typeof WorkflowContextSchema>;

// Step 1: 故事世界观圣经推演
export const storyBibleStep = createStep({
  id: 'step-story-bible',
  description: '推演网状剧情世界观、黄金三幕主干、DAG互动拓扑图与全剧角色小传档案',
  inputSchema: WorkflowContextSchema,
  outputSchema: WorkflowContextSchema,
  execute: async ({ inputData }) => {
    const { projectId, feedback } = inputData;
    const store = ProjectStore.getInstance();
    const project = store.getProject(projectId);

    const rawParams = {
      ...(inputData.payload || {}),
      ...(inputData.overrideParams || {}),
    };

    const idea = rawParams.idea || rawParams.initialPrompt || project?.meta?.idea;
    const style = rawParams.style || project?.meta?.style;
    const userFeedback = feedback || rawParams.userFeedback;
    const sessionId = rawParams.sessionId || inputData.sessionId;

    const toolResult: any = await (storyBibleTool.execute as any)({
      projectId,
      ...(idea ? { idea } : {}),
      ...(style ? { style } : {}),
      ...(userFeedback ? { userFeedback } : {}),
      ...(sessionId ? { sessionId } : {}),
    });

    if (!toolResult?.success) {
      throw new Error(`[storyBibleStep] 执行失败: ${toolResult?.error || '未知异常'}`);
    }

    const summary = toolResult.summary || '故事圣经生成落盘完成';

    return {
      projectId,
      activeStage: WorkflowStage.NARRATIVE_DESIGN,
      lastSummary: summary,
      criticGateStatus: 'NONE',
      toolResult,
    };
  },
});

// Step 2: 角色定妆照视觉概念渲染 (直驱 characterPortraitSubWorkflow 微观子工作流)
export const characterPortraitStep = createStep({
  id: 'step-character-portrait',
  description: '角色概念立绘、定妆照视觉概念渲染与人设锚定',
  inputSchema: WorkflowContextSchema,
  outputSchema: WorkflowContextSchema,
  execute: async ({ inputData }) => {
    const { projectId } = inputData;

    const run = await characterPortraitSubWorkflow.createRun();
    const runResult = await run.start({
      inputData: {
        projectId,
        ...(inputData.payload || {}),
        ...(inputData.overrideParams || {}),
      },
    });

    const stepOutput =
      (runResult as any).result ||
      (runResult as any).steps?.['step-aggregate-portrait-artifact']?.output;

    if (!stepOutput || stepOutput.success === false || runResult.status !== 'success') {
      const errorMsg =
        (runResult as any).error ||
        stepOutput?.error ||
        `角色定妆微观子工作流执行失败 (status: ${runResult.status})`;
      throw new Error(`[characterPortraitStep] 执行失败: ${errorMsg}`);
    }

    return {
      projectId,
      activeStage: WorkflowStage.CHARACTER_DESIGN,
      lastSummary: stepOutput.summary || '角色定妆照渲染落盘完成',
      criticGateStatus: 'NONE',
      toolResult: stepOutput,
    };
  },
});

// Step 3: 分场文学剧本拆解
export const sceneScriptStep = createStep({
  id: 'step-scene-script',
  description: '场景文学剧本拆解、动作与对白细节编写',
  inputSchema: WorkflowContextSchema,
  outputSchema: WorkflowContextSchema,
  execute: async ({ inputData }) => {
    const { projectId } = inputData;

    const toolResult: any = await (sceneScriptTool.execute as any)({
      projectId,
      ...(inputData.payload || {}),
      ...(inputData.overrideParams || {}),
    });

    if (!toolResult?.success) {
      throw new Error(`[sceneScriptStep] 执行失败: ${toolResult?.error || '未知异常'}`);
    }

    return {
      projectId,
      activeStage: WorkflowStage.SCENE_SCRIPT,
      lastSummary: toolResult.summary || '分场剧本拆解完成',
      criticGateStatus: 'NONE',
      toolResult,
    };
  },
});

// Step 4: 导演镜头机位与视听分镜规划
export const storyboardStep = createStep({
  id: 'step-storyboard',
  description: '专业影视工业级镜头分镜设计（景别、运镜、构图、音效）',
  inputSchema: WorkflowContextSchema,
  outputSchema: WorkflowContextSchema,
  execute: async ({ inputData }) => {
    const { projectId } = inputData;

    const toolResult: any = await (storyboardTool.execute as any)({
      projectId,
      ...(inputData.payload || {}),
      ...(inputData.overrideParams || {}),
    });

    if (!toolResult?.success) {
      throw new Error(`[storyboardStep] 执行失败: ${toolResult?.error || '未知异常'}`);
    }

    return {
      projectId,
      activeStage: WorkflowStage.STORYBOARD,
      lastSummary: toolResult.summary || '视听镜头分镜设计完成',
      criticGateStatus: 'NONE',
      toolResult,
    };
  },
});

// Step 5: 关键帧参考图生成 (直驱 keyframeReferenceSubWorkflow 微观子工作流)
export const keyframeReferenceStep = createStep({
  id: 'step-keyframe-reference',
  description: '分镜镜头关键帧参考图与首帧画面生成',
  inputSchema: WorkflowContextSchema,
  outputSchema: WorkflowContextSchema,
  execute: async ({ inputData }) => {
    const { projectId } = inputData;

    const run = await keyframeReferenceSubWorkflow.createRun();
    const runResult = await run.start({
      inputData: {
        projectId,
        ...(inputData.payload || {}),
        ...(inputData.overrideParams || {}),
      },
    });

    const stepOutput =
      (runResult as any).result ||
      (runResult as any).steps?.['step-aggregate-keyframe-artifact']?.output;

    if (!stepOutput || stepOutput.success === false || runResult.status !== 'success') {
      const errorMsg =
        (runResult as any).error ||
        stepOutput?.error ||
        `关键帧微观子工作流执行失败 (status: ${runResult.status})`;
      throw new Error(`[keyframeReferenceStep] 执行失败: ${errorMsg}`);
    }

    return {
      projectId,
      activeStage: WorkflowStage.KEYFRAME_REFERENCE,
      lastSummary: stepOutput.summary || '关键帧参考图生成完成',
      criticGateStatus: 'NONE',
      toolResult: stepOutput,
    };
  },
});

// Step 6: 动态视频切片生成与视听渲染 (直驱 videoProductionSubWorkflow 微观子工作流)
export const videoProductionStep = createStep({
  id: 'step-video-production',
  description: '动态视频切片生成与成片视听渲染',
  inputSchema: WorkflowContextSchema,
  outputSchema: WorkflowContextSchema,
  execute: async ({ inputData }) => {
    const { projectId } = inputData;

    const run = await videoProductionSubWorkflow.createRun();
    const runResult = await run.start({
      inputData: {
        projectId,
        ...(inputData.payload || {}),
        ...(inputData.overrideParams || {}),
      },
    });

    const stepOutput =
      (runResult as any).result ||
      (runResult as any).steps?.['step-aggregate-video-artifact']?.output;

    if (!stepOutput || stepOutput.success === false || runResult.status !== 'success') {
      const errorMsg =
        (runResult as any).error ||
        stepOutput?.error ||
        `动态视频微观子工作流执行失败 (status: ${runResult.status})`;
      throw new Error(`[videoProductionStep] 执行失败: ${errorMsg}`);
    }

    return {
      projectId,
      activeStage: WorkflowStage.VIDEO_PRODUCTION,
      lastSummary: stepOutput.summary || '动态视频切片渲染完成',
      criticGateStatus: 'NONE',
      toolResult: stepOutput,
    };
  },
});

// Step 7: 独立影视审查官多维刚性质检 (阶段隔离)
export const criticReviewStep = createStep({
  id: 'step-critic-review',
  description: '独立影视审查官挑刺质检与放行门禁',
  inputSchema: WorkflowContextSchema,
  outputSchema: WorkflowContextSchema,
  execute: async ({ inputData }) => {
    const { projectId, activeStage } = inputData;
    const stageToReview = inputData.payload?.targetStage || inputData.payload?.stage || activeStage || WorkflowStage.NARRATIVE_DESIGN;

    const toolResult: any = await (criticReviewTool.execute as any)({
      projectId,
      targetStage: stageToReview,
      userFeedback: inputData.feedback || inputData.payload?.userFeedback,
      ...(inputData.overrideParams || {}),
    });

    if (!toolResult?.success) {
      throw new Error(`[criticReviewStep] 审查官执行异常: ${toolResult?.error || '未知错误'}`);
    }

    const report = toolResult.report;
    const gateStatus = report?.gateStatus || 'WARN';

    return {
      projectId,
      activeStage: stageToReview,
      lastSummary: `质检完成，门禁状态: ${gateStatus} (综合评分: ${report?.scores?.overallScore ?? 'N/A'})`,
      criticGateStatus: gateStatus,
      toolResult,
    };
  },
});

// Step 8: 互动影游全网拓扑与母带打包
export const fmvPackagingStep = createStep({
  id: 'step-fmv-packaging',
  description: '全网互动节点拓扑路由、分支决策点与视频切片母带打包编译',
  inputSchema: WorkflowContextSchema,
  outputSchema: WorkflowContextSchema,
  execute: async ({ inputData }) => {
    const { projectId } = inputData;

    const toolResult: any = await (fmvPackagingTool.execute as any)({
      projectId,
      ...(inputData.payload || {}),
      ...(inputData.overrideParams || {}),
    });

    if (!toolResult?.success) {
      throw new Error(`[fmvPackagingStep] 打包失败: ${toolResult?.error || '未知异常'}`);
    }

    return {
      projectId,
      activeStage: WorkflowStage.COMPLETED,
      lastSummary: toolResult.summary || '🎉 互动影游母带打包编译完成！',
      criticGateStatus: 'PASS',
      toolResult,
    };
  },
});
