/**
 * agents/director/generator/steps/character-portrait/steps/audit.step.ts
 * 角色定妆第 1 阶段原子 Step：核验既有角色资产与断点缓存
 */

import { createStep } from '@mastra/core/workflows';
import fs from 'fs';
import path from 'path';
import { WorkflowContextSchema, WorkflowContext } from '../../common.js';
import { ProjectStore } from '../../../../../../project-store/ProjectStore.js';
import { WorkflowStage } from '../../../../../../types/index.js';
import type { CharacterPortraitArtifact, CharacterSheetItem } from '../schema.js';

export const portraitAuditStep = createStep({
  id: 'step-portrait-audit',
  description: '核验物理定妆照与已有资产，计算断点复用角色与待渲染角色',
  inputSchema: WorkflowContextSchema,
  outputSchema: WorkflowContextSchema,
  execute: async ({ inputData }) => {
    const context = inputData as WorkflowContext;
    const { projectId, sessionId, overrideParams, payload } = context;

    const store = ProjectStore.getInstance();
    const project = store.getProject(projectId);
    const projectDir = store.getProjectDir(projectId);

    const narrativeArtifact = store.getArtifact<any>(projectId, WorkflowStage.NARRATIVE_DESIGN);
    const rawCharacters = narrativeArtifact?.characters || [];

    if (!rawCharacters || rawCharacters.length === 0) {
      throw new Error('[portraitAuditStep] 缺少前序叙事架构角色数据，请先推进第一阶段【叙事架构】生成角色小传');
    }

    const style =
      overrideParams?.style ||
      (context as any).styleOverride ||
      narrativeArtifact.style ||
      project?.meta?.style ||
      '电影质感，冷色调，高对比度光影';

    let effectiveConstraints: string[] = [];
    if (sessionId) {
      const session = store.getSession(projectId, sessionId);
      if (session?.scratchpad?.userConstraints && session.scratchpad.userConstraints.length > 0) {
        effectiveConstraints = session.scratchpad.userConstraints;
      }
    }
    if (effectiveConstraints.length === 0 && project?.meta?.userConstraints) {
      effectiveConstraints = project.meta.userConstraints;
    }

    const existingArtifact = store.getArtifact<CharacterPortraitArtifact>(projectId, WorkflowStage.CHARACTER_DESIGN);
    const existingCharacters = Array.isArray(existingArtifact?.characters) ? existingArtifact.characters : [];

    const targetCharacterNames: string[] | undefined =
      (context as any).targetCharacterNames ||
      payload?.targetCharacterNames ||
      (payload?.target ? [payload.target] : undefined);

    const rollbackSet = new Set<string>(targetCharacterNames || []);
    const forceRegenerate = Boolean((context as any).forceRegenerate || payload?.forceRegenerate);
    const isMock = Boolean((context as any).isMock || payload?.isMock);

    const cachedCharacters: CharacterSheetItem[] = [];
    const pendingCharacters: any[] = [];

    for (const char of rawCharacters) {
      const isTargetRollback = rollbackSet.has(char.name);
      const existingChar = existingCharacters.find((c) => c.name === char.name);

      let isPhysicalFileValid = false;
      if (existingChar?.imageUrl) {
        if (isMock) {
          isPhysicalFileValid = true;
        } else if (existingChar.imageUrl.startsWith(`/media/${projectId}/`)) {
          const relPath = existingChar.imageUrl.replace(`/media/${projectId}/`, '');
          const absPath = path.join(projectDir, relPath);
          isPhysicalFileValid = fs.existsSync(absPath) && fs.statSync(absPath).size > 0;
        } else {
          isPhysicalFileValid = true;
        }
      }

      if (!forceRegenerate && !isTargetRollback && existingChar && isPhysicalFileValid) {
        cachedCharacters.push(existingChar);
      } else {
        pendingCharacters.push(char);
      }
    }

    return {
      ...context,
      payload: {
        ...(payload || {}),
        portraitAudit: {
          style,
          targetCharacterNames,
          userFeedback: (context as any).userFeedback || payload?.userFeedback || context.feedback,
          isMock,
          effectiveConstraints,
          cachedCharacters,
          pendingCharacters,
          rawCharacters,
          existingCreatedAt: existingArtifact?.createdAt,
        },
      },
      lastSummary: `角色核验完成：全剧 ${rawCharacters.length} 位角色，断点秒级复用 ${cachedCharacters.length} 位，待渲染 ${pendingCharacters.length} 位。`,
    };
  },
});
