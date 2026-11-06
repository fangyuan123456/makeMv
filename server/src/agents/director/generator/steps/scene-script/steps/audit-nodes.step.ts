/**
 * agents/director/generator/steps/scene-script/steps/audit-nodes.step.ts
 * 分场剧本第 1 阶段原子 Step：剧情拓扑节点核验与场次规划
 */

import { createStep } from '@mastra/core/workflows';
import { WorkflowContextSchema, WorkflowContext } from '../../common.js';
import { ProjectStore } from '../../../../../../project-store/ProjectStore.js';
import { WorkflowStage } from '../../../../../../types/index.js';

export const sceneScriptAuditStep = createStep({
  id: 'step-scene-script-audit',
  description: '核验上游故事圣经剧情拓扑节点与角色设定，规划分场剧本展开批次',
  inputSchema: WorkflowContextSchema,
  outputSchema: WorkflowContextSchema,
  execute: async ({ inputData }) => {
    const context = inputData as WorkflowContext;
    const { projectId, sessionId, feedback, payload } = context;

    const store = ProjectStore.getInstance();
    const bible = store.getArtifact<any>(projectId, WorkflowStage.NARRATIVE_DESIGN);
    if (!bible) {
      throw new Error('[sceneScriptAuditStep] 缺少前序叙事架构资产，无法推演分场剧本');
    }

    const graphNodes = bible.storyGraph?.nodes || [];
    if (!graphNodes || graphNodes.length === 0) {
      throw new Error('[sceneScriptAuditStep] 剧情拓扑节点为空，无法规划分场剧本');
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
        sceneScriptPlan: {
          title: bible.title || '未命名互动剧本',
          theme: bible.theme || bible.logline || '叙事推演',
          characters: bible.characters || [],
          graphNodes,
          userFeedback: (context as any).userFeedback || payload?.userFeedback || feedback,
          effectiveConstraints,
        },
      },
      lastSummary: `剧情节点核验完成：共锁定 ${graphNodes.length} 个拓扑节点，准备展开分场文学剧本。`,
    };
  },
});
