/**
 * agents/director/generator/steps/storyboard/steps/audit-scenes.step.ts
 * 视听分镜第 1 阶段原子 Step：分场剧本核验与镜头节奏规划
 */

import { createStep } from '@mastra/core/workflows';
import { WorkflowContextSchema, WorkflowContext } from '../../common.js';
import { ProjectStore } from '../../../../../../project-store/ProjectStore.js';
import { WorkflowStage } from '../../../../../../types/index.js';

export const storyboardAuditStep = createStep({
  id: 'step-storyboard-audit',
  description: '核验上游分场剧本数据，提取场次列表并规划视听镜头切分批次',
  inputSchema: WorkflowContextSchema,
  outputSchema: WorkflowContextSchema,
  execute: async ({ inputData }) => {
    const context = inputData as WorkflowContext;
    const { projectId, sessionId, feedback, payload } = context;

    const store = ProjectStore.getInstance();
    const scriptArtifact = store.getArtifact<any>(projectId, WorkflowStage.SCENE_SCRIPT);
    const scenes = scriptArtifact?.scenes || [];

    if (!scenes || scenes.length === 0) {
      throw new Error('[storyboardAuditStep] 缺少前序分场剧本数据，请先执行前置工序【分场剧本】');
    }

    let effectiveConstraints: string[] = [];
    if (sessionId) {
      const session = store.getSession(projectId, sessionId);
      if (session?.scratchpad?.userConstraints && session.scratchpad.userConstraints.length > 0) {
        effectiveConstraints = session.scratchpad.userConstraints;
      }
    }

    return {
      ...context,
      payload: {
        ...(payload || {}),
        storyboardPlan: {
          title: scriptArtifact.title || '未命名视听分镜',
          scenes,
          userFeedback: (context as any).userFeedback || payload?.userFeedback || feedback,
          effectiveConstraints,
        },
      },
      lastSummary: `场次核验完成：全剧锁定 ${scenes.length} 个场次，准备解构视听分镜头。`,
    };
  },
});
