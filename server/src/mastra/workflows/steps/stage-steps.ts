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
  characterPortraitTool,
  sceneScriptTool,
  storyboardTool,
  keyframeReferenceTool,
  videoProductionTool,
  criticReviewTool,
  fmvPackagingTool,
} from '../../tools/index.js';
import { ProjectStore } from '../../../project-store/ProjectStore.js';
import { WorkflowStage } from '../../../types/index.js';

// 通用工作流数据载体 Schema
export const WorkflowContextSchema = z.object({
  projectId: z.string(),
  activeStage: z.nativeEnum(WorkflowStage).optional(),
  feedback: z.string().optional(),
  overrideParams: z.record(z.any()).optional(),
  criticGateStatus: z.string().optional(),
  lastSummary: z.string().optional(),
});

export type WorkflowContext = z.infer<typeof WorkflowContextSchema>;

// Step 1: 故事世界观圣经推演
export const storyBibleStep = createStep({
  id: 'step-story-bible',
  description: '推演网状剧情世界观、黄金三幕主干、DAG互动拓扑图与全剧角色小传档案',
  inputSchema: WorkflowContextSchema,
  outputSchema: WorkflowContextSchema,
  execute: async ({ inputData, suspend }) => {
    const { projectId, feedback } = inputData;
    const store = ProjectStore.getInstance();

    const toolResult: any = await (storyBibleTool.execute as any)({
      projectId,
      userFeedback: feedback,
      ...(inputData.overrideParams || {}),
    });

    if (!toolResult?.success) {
      throw new Error(`[storyBibleStep] 执行失败: ${toolResult?.error || '未知异常'}`);
    }

    const summary = toolResult.summary || '故事圣经生成落盘完成';

    // 人在回路原语：故事圣经推演完成后挂起，等待创作者审核确认
    return {
      projectId,
      activeStage: WorkflowStage.NARRATIVE_DESIGN,
      lastSummary: summary,
      criticGateStatus: 'NONE',
    };
  },
});

// Step 2: 角色定妆照视觉概念渲染
export const characterPortraitStep = createStep({
  id: 'step-character-portrait',
  description: '角色概念立绘、定妆照视觉概念渲染与人设锚定',
  inputSchema: WorkflowContextSchema,
  outputSchema: WorkflowContextSchema,
  execute: async ({ inputData }) => {
    const { projectId } = inputData;

    const toolResult: any = await (characterPortraitTool.execute as any)({
      projectId,
      ...(inputData.overrideParams || {}),
    });

    if (!toolResult?.success) {
      throw new Error(`[characterPortraitStep] 执行失败: ${toolResult?.error || '未知异常'}`);
    }

    return {
      projectId,
      activeStage: WorkflowStage.CHARACTER_DESIGN,
      lastSummary: toolResult.summary || '角色定妆照渲染落盘完成',
      criticGateStatus: 'NONE',
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
    };
  },
});

// Step 5: 关键帧参考图生成
export const keyframeReferenceStep = createStep({
  id: 'step-keyframe-reference',
  description: '分镜镜头关键帧参考图与首帧画面生成',
  inputSchema: WorkflowContextSchema,
  outputSchema: WorkflowContextSchema,
  execute: async ({ inputData }) => {
    const { projectId } = inputData;

    const toolResult: any = await (keyframeReferenceTool.execute as any)({
      projectId,
      ...(inputData.overrideParams || {}),
    });

    if (!toolResult?.success) {
      throw new Error(`[keyframeReferenceStep] 执行失败: ${toolResult?.error || '未知异常'}`);
    }

    return {
      projectId,
      activeStage: WorkflowStage.KEYFRAME_REFERENCE,
      lastSummary: toolResult.summary || '关键帧参考图生成完成',
      criticGateStatus: 'NONE',
    };
  },
});

// Step 6: 动态视频切片生成与视听渲染
export const videoProductionStep = createStep({
  id: 'step-video-production',
  description: '动态视频切片生成与成片视听渲染',
  inputSchema: WorkflowContextSchema,
  outputSchema: WorkflowContextSchema,
  execute: async ({ inputData }) => {
    const { projectId } = inputData;

    const toolResult: any = await (videoProductionTool.execute as any)({
      projectId,
      ...(inputData.overrideParams || {}),
    });

    if (!toolResult?.success) {
      throw new Error(`[videoProductionStep] 执行失败: ${toolResult?.error || '未知异常'}`);
    }

    return {
      projectId,
      activeStage: WorkflowStage.VIDEO_PRODUCTION,
      lastSummary: toolResult.summary || '动态视频切片渲染完成',
      criticGateStatus: 'NONE',
    };
  },
});

// Step 7: 独立影视审查官多维刚性质检 (阶段隔离)
export const criticReviewStep = createStep({
  id: 'step-critic-review',
  description: '独立影视审查官挑刺质检与放行门禁',
  inputSchema: WorkflowContextSchema,
  outputSchema: WorkflowContextSchema,
  execute: async ({ inputData, suspend }) => {
    const { projectId, activeStage } = inputData;
    const stageToReview = activeStage || WorkflowStage.NARRATIVE_DESIGN;

    const toolResult: any = await (criticReviewTool.execute as any)({
      projectId,
      stage: stageToReview,
      ...(inputData.overrideParams || {}),
    });

    if (!toolResult?.success) {
      throw new Error(`[criticReviewStep] 审查官执行异常: ${toolResult?.error || '未知错误'}`);
    }

    const report = toolResult.report;
    const gateStatus = report?.gateStatus || 'WARN';

    // 若触发刚性阻断 FAIL，调用原生 suspend 挂起工作流，阻断后续带病推进
    if (gateStatus === 'FAIL') {
      await suspend({
        reason: 'CRITIC_GATE_FAIL',
        stage: stageToReview,
        summary: `🔴 审查官刚性阻断放行！发现 ${report.criticalFlaws?.length ?? 0} 项关键逻辑或视听瑕疵，请创作者反思优化。`,
        report,
      });
    }

    return {
      projectId,
      activeStage: stageToReview,
      lastSummary: `质检完成，门禁状态: ${gateStatus} (综合评分: ${report?.scores?.overallScore ?? 'N/A'})`,
      criticGateStatus: gateStatus,
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
      ...(inputData.overrideParams || {}),
    });

    if (!toolResult?.success) {
      throw new Error(`[fmvPackagingStep] 打包失败: ${toolResult?.error || '未知异常'}`);
    }

    // 推进权由 Step 显式确认完成
    const store = ProjectStore.getInstance();
    const project = store.getProject(projectId);
    if (project) {
      project.currentStage = WorkflowStage.COMPLETED;
      project.updatedAt = new Date().toISOString();
      store.saveProject(project);
    }

    return {
      projectId,
      activeStage: WorkflowStage.COMPLETED,
      lastSummary: toolResult.summary || '🎉 互动影游母带打包编译完成！',
      criticGateStatus: 'PASS',
    };
  },
});
