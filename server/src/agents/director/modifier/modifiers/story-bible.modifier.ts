/**
 * agents/modifier/modifiers/story-bible.modifier.ts
 * 故事世界观圣经增量修改与差量修补引擎 (Story Bible Modifier SSOT)
 */

import path from 'path';
import type { LLMService } from '../../../../llm/LLMService.js';
import { ProjectStore } from '../../../../project-store/ProjectStore.js';
import { WorkflowStage } from '../../../../types/index.js';
import { tryExecuteJsonStringPatch } from '../../../../utils/universal-patch.js';
import type { StoryBibleArtifact } from '../../generator/steps/story-bible/schema.js';
import { exportStoryBibleToDisk } from '../../generator/steps/story-bible/exporter.js';

export interface ModifyStoryBibleOptions {
  projectId: string;
  userFeedback: string;
  llm: LLMService;
}

export interface ModifyStoryBibleResult {
  success: boolean;
  data?: StoryBibleArtifact;
  summary?: string;
  error?: string;
}

export async function modifyStoryBible(options: ModifyStoryBibleOptions): Promise<ModifyStoryBibleResult> {
  const { projectId, userFeedback, llm } = options;
  const store = ProjectStore.getInstance();
  const project = store.getProject(projectId);
  if (!project) {
    return {
      success: false,
      error: `未找到项目: [${projectId}]`,
    };
  }

  const existingBible = store.getArtifact<StoryBibleArtifact>(projectId, WorkflowStage.NARRATIVE_DESIGN);
  if (!existingBible) {
    return {
      success: false,
      error: `项目 [${projectId}] 尚未生成故事圣经底稿，无法执行修改`,
    };
  }

  const projectDir = store.getProjectDir(projectId);
  const jsonPath = path.join(projectDir, 'narrative', 'story_bible.json');

  console.log(`[story-bible.modifier] 启动纯字符串 Delta Patch 快速推演修改...`);

  const patchRes = await tryExecuteJsonStringPatch<StoryBibleArtifact>({
    jsonPath,
    userFeedback,
    stageName: 'story_bible_string_patch',
    projectId,
    llm,
  });

  if (!patchRes.success || !patchRes.data) {
    return {
      success: false,
      error: patchRes.error || '故事圣经字符串 Patch 校验未完全通过',
    };
  }

  const patchedArtifact = patchRes.data;

  // 状态黑板与项目聚合根同步落盘
  project.title = patchedArtifact.title || project.title;
  if (!project.stageArtifacts) project.stageArtifacts = {};
  project.stageArtifacts[WorkflowStage.NARRATIVE_DESIGN] = patchedArtifact;
  store.saveProject(project);

  store.setArtifact(projectId, WorkflowStage.NARRATIVE_DESIGN, patchedArtifact, {
    skill: 'story-bible-generator',
  });
  exportStoryBibleToDisk(projectId, patchedArtifact, store);

  const summary = `⚡【故事圣经修改完成】${patchRes.summary}。全剧未修改章节 100% 物理保持原状。`;
  return {
    success: true,
    data: patchedArtifact,
    summary,
  };
}
