/**
 * agents/modifier/modifiers/storyboard.modifier.ts
 * 视听分镜头增量修改与镜头差量修补引擎 (Storyboard Modifier SSOT)
 */

import path from 'path';
import type { LLMService } from '../../../../llm/LLMService.js';
import { ProjectStore } from '../../../../project-store/ProjectStore.js';
import { WorkflowStage } from '../../../../types/index.js';
import { tryExecuteJsonStringPatch } from '../../../../utils/universal-patch.js';
import type { StoryboardArtifact } from '../../generator/steps/storyboard/schema.js';
import { calculateTotalDurationSec } from '../../generator/steps/storyboard/generator.js';
import { exportStoryboardToDisk } from '../../generator/steps/storyboard/exporter.js';

export interface ModifyStoryboardOptions {
  projectId: string;
  userFeedback: string;
  llm: LLMService;
}

export interface ModifyStoryboardResult {
  success: boolean;
  data?: StoryboardArtifact;
  summary?: string;
  error?: string;
}

export async function modifyStoryboard(options: ModifyStoryboardOptions): Promise<ModifyStoryboardResult> {
  const { projectId, userFeedback, llm } = options;
  const store = ProjectStore.getInstance();
  const existingStoryboard = store.getArtifact<StoryboardArtifact>(projectId, WorkflowStage.STORYBOARD);
  if (!existingStoryboard) {
    return {
      success: false,
      error: `项目 [${projectId}] 尚未生成视听分镜底稿，无法执行修改`,
    };
  }

  const projectDir = store.getProjectDir(projectId);
  const jsonPath = path.join(projectDir, 'storyboard', 'storyboard.json');

  console.log(`[storyboard.modifier] 启动纯字符串 Delta Patch 快速推演修改...`);

  const patchRes = await tryExecuteJsonStringPatch<StoryboardArtifact>({
    jsonPath,
    userFeedback,
    extraContext: `全片共 ${existingStoryboard.shots.length} 个分镜头`,
    stageName: 'storyboard_string_patch',
    projectId,
    llm,
  });

  if (!patchRes.success || !patchRes.data) {
    return {
      success: false,
      error: patchRes.error || '分镜头表字符串 Patch 校验未完全通过',
    };
  }

  const patchedArtifact = patchRes.data;

  patchedArtifact.totalShots = patchedArtifact.shots?.length || 0;
  patchedArtifact.estimatedTotalDurationSec = calculateTotalDurationSec(patchedArtifact.shots || []);

  store.setArtifact(projectId, WorkflowStage.STORYBOARD, patchedArtifact, {
    skill: 'storyboard-generator',
  });
  exportStoryboardToDisk(projectId, patchedArtifact);

  const summary = `⚡【视听分镜修改完成】${patchRes.summary}。未修改分镜头 100% 物理保持原状。`;
  return {
    success: true,
    data: patchedArtifact,
    summary,
  };
}
