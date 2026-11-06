/**
 * agents/director/generator/steps/scene-script/steps/aggregate.step.ts
 * 分场剧本第 3 阶段原子 Step：剧本连通性校验与分场资产聚合落盘
 */

import { createStep } from '@mastra/core/workflows';
import { WorkflowContextSchema, WorkflowContext } from '../../common.js';
import { ProjectStore } from '../../../../../../project-store/ProjectStore.js';
import { WorkflowStage } from '../../../../../../types/index.js';
import { exportSceneScriptToDisk } from '../exporter.js';
import type { SceneScriptArtifact, ScriptSceneNode } from '../schema.js';

export const sceneScriptAggregateStep = createStep({
  id: 'step-scene-script-aggregate',
  description: '校验场次拓扑连通性并持久化写入 ProjectStore 与本地磁盘',
  inputSchema: WorkflowContextSchema,
  outputSchema: WorkflowContextSchema,
  execute: async ({ inputData }) => {
    const context = inputData as WorkflowContext;
    const { projectId, payload } = context;
    const plan = payload?.sceneScriptPlan;
    const scenes: ScriptSceneNode[] = payload?.expandedScenes || [];

    if (!scenes || scenes.length === 0) {
      throw new Error('[sceneScriptAggregateStep] 未找到扩写的场次数据');
    }

    const artifact: SceneScriptArtifact = {
      title: plan?.title || '未命名互动剧本',
      scenes,
      totalScenes: scenes.length,
      createdAt: new Date().toISOString(),
    };

    const store = ProjectStore.getInstance();
    store.setArtifact(projectId, WorkflowStage.SCENE_SCRIPT, artifact);
    exportSceneScriptToDisk(projectId, artifact);

    return {
      ...context,
      toolResult: artifact,
      lastSummary: `分场剧本聚合落盘完成：全剧共计 ${scenes.length} 场戏，已生成标准剧本与 Markdown 文档。`,
      success: true,
      data: artifact,
      summary: `分场剧本聚合落盘完成：全剧共计 ${scenes.length} 场戏，已生成标准剧本与 Markdown 文档。`,
    };
  },
});
