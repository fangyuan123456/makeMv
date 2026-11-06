/**
 * agents/director/generator/steps/keyframe-reference/steps/aggregate.step.ts
 * 关键帧首帧第 3 阶段原子 Step：关键帧资产聚合与持久化落盘
 */

import { createStep } from '@mastra/core/workflows';
import fs from 'fs';
import path from 'path';
import { WorkflowContextSchema, WorkflowContext } from '../../common.js';
import { ProjectStore } from '../../../../../../project-store/ProjectStore.js';
import { WorkflowStage } from '../../../../../../types/index.js';
import type { KeyframeItem, KeyframeReferenceArtifact } from '../schema.js';

export const keyframeAggregateStep = createStep({
  id: 'step-keyframe-aggregate',
  description: '将断点复用与新渲染关键帧归并，持久化写入 ProjectStore 与本地磁盘',
  inputSchema: WorkflowContextSchema,
  outputSchema: WorkflowContextSchema,
  execute: async ({ inputData }) => {
    const context = inputData as WorkflowContext;
    const { projectId, payload } = context;
    const auditData = payload?.keyframeAudit;
    const renderedKeyframes: KeyframeItem[] = payload?.keyframeRendered || [];

    if (!auditData) {
      throw new Error('[keyframeAggregateStep] 缺少前置核验上下文 (keyframeAudit)');
    }

    const {
      style,
      targetShotIds,
      cachedKeyframes,
      allShots,
      existingCreatedAt,
    } = auditData;

    const store = ProjectStore.getInstance();
    const allMap = new Map<string, KeyframeItem>();

    for (const k of cachedKeyframes) {
      allMap.set(k.shotId, k);
    }
    for (const k of renderedKeyframes) {
      allMap.set(k.shotId, k);
    }

    const orderedShots: KeyframeItem[] = [];
    for (const shot of allShots) {
      const item = allMap.get(shot.shotId);
      if (item) {
        orderedShots.push(item);
      }
    }

    const isRefinement = Boolean(targetShotIds && targetShotIds.length > 0);
    const artifact: KeyframeReferenceArtifact = {
      shots: orderedShots,
      totalKeyframes: allShots.length,
      completedKeyframes: orderedShots.length,
      isRefinement,
      targetShotId: targetShotIds?.[0],
      createdAt: existingCreatedAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    store.setArtifact(projectId, WorkflowStage.KEYFRAME_REFERENCE, artifact);
    exportToLocalDisk(projectId, artifact);

    const cachedCount = cachedKeyframes.length;
    const renderedCount = renderedKeyframes.length;

    let summary = '';
    if (isRefinement) {
      summary = `✨ 镜头【${targetShotIds?.join('、')}】关键帧重绘完成！(复用 ${cachedCount} 帧，重绘 ${renderedCount} 帧)`;
    } else if (cachedCount > 0 && renderedCount === 0) {
      summary = `⚡ 断点恢复：全剧 ${cachedCount} 帧关键帧基准图均完整，已全部秒级复用！`;
    } else if (cachedCount > 0) {
      summary = `🎨 关键帧基准图就绪！(断点秒级复用 ${cachedCount} 帧，增量渲染 ${renderedCount} 帧)`;
    } else {
      summary = `🎨 全剧共 ${orderedShots.length} 帧首帧高保真基准图渲染并落盘完毕！`;
    }

    return {
      ...context,
      toolResult: artifact,
      lastSummary: summary,
      success: true,
      data: artifact,
      summary,
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
    console.warn('[keyframeAggregateStep] 本地磁盘落盘异常 (非致命):', e);
  }
}
