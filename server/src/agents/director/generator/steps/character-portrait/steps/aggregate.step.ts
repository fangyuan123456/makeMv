/**
 * agents/director/generator/steps/character-portrait/steps/aggregate.step.ts
 * 角色定妆第 3 阶段原子 Step：定妆档案聚合与持久化落盘
 */

import { createStep } from '@mastra/core/workflows';
import fs from 'fs';
import path from 'path';
import { WorkflowContextSchema, WorkflowContext } from '../../common.js';
import { ProjectStore } from '../../../../../../project-store/ProjectStore.js';
import { WorkflowStage } from '../../../../../../types/index.js';
import type { CharacterPortraitArtifact, CharacterSheetItem } from '../schema.js';

export const portraitAggregateStep = createStep({
  id: 'step-portrait-aggregate',
  description: '将断点复用与新渲染角色归并，持久化写入 ProjectStore 与本地磁盘',
  inputSchema: WorkflowContextSchema,
  outputSchema: WorkflowContextSchema,
  execute: async ({ inputData }) => {
    const context = inputData as WorkflowContext;
    const { projectId, sessionId, payload } = context;
    const auditData = payload?.portraitAudit;
    const renderedCharacters: CharacterSheetItem[] = payload?.portraitRendered || [];

    if (!auditData) {
      throw new Error('[portraitAggregateStep] 缺少前置核验上下文 (portraitAudit)');
    }

    const {
      style,
      targetCharacterNames,
      cachedCharacters,
      rawCharacters,
      existingCreatedAt,
    } = auditData;

    const store = ProjectStore.getInstance();
    const allMap = new Map<string, CharacterSheetItem>();

    for (const c of cachedCharacters) {
      allMap.set(c.name, c);
    }
    for (const c of renderedCharacters) {
      allMap.set(c.name, c);
    }

    const orderedCharacters: CharacterSheetItem[] = [];
    for (const raw of rawCharacters) {
      const item = allMap.get(raw.name);
      if (item) {
        orderedCharacters.push(item);
      }
    }

    const isRefinement = Boolean(targetCharacterNames && targetCharacterNames.length > 0);
    const artifact: CharacterPortraitArtifact = {
      characters: orderedCharacters,
      totalCharacters: rawCharacters.length,
      completedCharacters: orderedCharacters.length,
      style,
      isRefinement,
      targetCharacterNames,
      createdAt: existingCreatedAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    store.setArtifact(projectId, WorkflowStage.CHARACTER_DESIGN, artifact);
    exportToLocalDisk(projectId, artifact);

    if (sessionId) {
      const visualAnchorsSummary = orderedCharacters
        .map((c) => `- ${c.name}: ${(c.appearance || '').slice(0, 40)}... (定妆Prompt: ${c.visualPrompt.slice(0, 60)}...)`)
        .join('\n');
      store.updateScratchpad(projectId, sessionId, {
        characterVisualAnchors: visualAnchorsSummary,
      });
    }

    const cachedCount = cachedCharacters.length;
    const renderedCount = renderedCharacters.length;

    let summary = '';
    if (isRefinement) {
      summary = `✨ 角色【${targetCharacterNames?.join('、')}】微调定妆照交付完成！(复用 ${cachedCount} 个，重绘 ${renderedCount} 个)`;
    } else if (cachedCount > 0 && renderedCount === 0) {
      summary = `⚡ 断点恢复：全剧 ${cachedCount} 位角色定妆照物理切片均完整，已毫秒级全部复用！`;
    } else if (cachedCount > 0) {
      summary = `🎨 角色视觉定妆完成！(断点秒级复用 ${cachedCount} 个，增量渲染 ${renderedCount} 个)`;
    } else {
      summary = `🎨 全剧 ${orderedCharacters.length} 位核心角色视觉定妆照生成并永久化落盘完毕！`;
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

function exportToLocalDisk(projectId: string, artifact: CharacterPortraitArtifact) {
  try {
    const store = ProjectStore.getInstance();
    const projectDir = store.getProjectDir(projectId);
    const charDir = path.join(projectDir, 'characters');
    if (!fs.existsSync(charDir)) {
      fs.mkdirSync(charDir, { recursive: true });
    }
    fs.writeFileSync(
      path.join(charDir, 'character_sheets.json'),
      JSON.stringify(artifact, null, 2),
      'utf-8'
    );
  } catch (e) {
    console.warn('[portraitAggregateStep] 本地物理落盘异常 (非致命):', e);
  }
}
