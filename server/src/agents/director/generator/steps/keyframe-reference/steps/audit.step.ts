/**
 * agents/director/generator/steps/keyframe-reference/steps/audit.step.ts
 * 关键帧首帧第 1 阶段原子 Step：核验既有关键帧图片与断点缓存
 */

import { createStep } from '@mastra/core/workflows';
import fs from 'fs';
import path from 'path';
import { WorkflowContextSchema, WorkflowContext } from '../../common.js';
import { ProjectStore } from '../../../../../../project-store/ProjectStore.js';
import { WorkflowStage } from '../../../../../../types/index.js';
import type { KeyframeItem, KeyframeReferenceArtifact } from '../schema.js';

export const keyframeAuditStep = createStep({
  id: 'step-keyframe-audit',
  description: '核验物理关键帧图片与已有资产，计算断点复用与待渲染镜头',
  inputSchema: WorkflowContextSchema,
  outputSchema: WorkflowContextSchema,
  execute: async ({ inputData }) => {
    const context = inputData as WorkflowContext;
    const { projectId, sessionId, payload } = context;

    const store = ProjectStore.getInstance();
    const project = store.getProject(projectId);
    const projectDir = store.getProjectDir(projectId);

    const storyboardArtifact = store.getArtifact<any>(projectId, WorkflowStage.STORYBOARD);
    const shots = storyboardArtifact?.shots || [];

    if (!shots || shots.length === 0) {
      throw new Error('[keyframeAuditStep] 缺少前序视听分镜数据，请先执行前置工序【视听分镜】');
    }

    const charArtifact = store.getArtifact<any>(projectId, WorkflowStage.CHARACTER_DESIGN);
    const characterVisualSpecs = charArtifact?.characters || [];
    const style = storyboardArtifact.style || project?.meta?.style || '电影质感，写实光影';

    const existingArtifact = store.getArtifact<KeyframeReferenceArtifact>(projectId, WorkflowStage.KEYFRAME_REFERENCE);
    const existingShots = Array.isArray(existingArtifact?.shots) ? existingArtifact.shots : [];

    const targetShotIds: string[] | undefined =
      (context as any).targetShotIds ||
      payload?.targetShotIds ||
      ((context as any).targetShotId ? [(context as any).targetShotId] : undefined) ||
      (payload?.targetShotId ? [payload.targetShotId] : undefined);

    const rollbackSet = new Set<string>(targetShotIds || []);
    const forceRegenerate = Boolean((context as any).forceRegenerate || payload?.forceRegenerate);
    const isMock = Boolean((context as any).isMock || payload?.isMock);

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

      if (!forceRegenerate && !isTargetRollback && existingShot && isPhysicalFileValid) {
        cachedKeyframes.push(existingShot);
      } else {
        pendingShots.push(shot);
      }
    }

    return {
      ...context,
      payload: {
        ...(payload || {}),
        keyframeAudit: {
          style,
          targetShotIds,
          userFeedback: (context as any).userFeedback || payload?.userFeedback || context.feedback,
          isMock,
          characterVisualSpecs,
          cachedKeyframes,
          pendingShots,
          allShots: shots,
          existingCreatedAt: existingArtifact?.createdAt,
        },
      },
      lastSummary: `关键帧核验完成：全剧 ${shots.length} 个分镜，断点秒级复用 ${cachedKeyframes.length} 帧，待渲染 ${pendingShots.length} 帧。`,
    };
  },
});
