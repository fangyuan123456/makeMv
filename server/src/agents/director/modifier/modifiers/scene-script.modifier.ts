/**
 * agents/modifier/modifiers/scene-script.modifier.ts
 * 分场剧本增量修改与对白差量修补引擎 (Scene Script Modifier SSOT)
 */

import path from 'path';
import type { LLMService } from '../../../../llm/LLMService.js';
import { ProjectStore } from '../../../../project-store/ProjectStore.js';
import { WorkflowStage } from '../../../../types/index.js';
import { tryExecuteJsonStringPatch } from '../../../../utils/universal-patch.js';
import type { SceneScriptArtifact } from '../../generator/steps/scene-script/schema.js';
import { exportSceneScriptToDisk } from '../../generator/steps/scene-script/exporter.js';

export interface ModifySceneScriptOptions {
  projectId: string;
  userFeedback: string;
  llm: LLMService;
}

export interface ModifySceneScriptResult {
  success: boolean;
  data?: SceneScriptArtifact;
  summary?: string;
  error?: string;
}

export async function modifySceneScript(options: ModifySceneScriptOptions): Promise<ModifySceneScriptResult> {
  const { projectId, userFeedback, llm } = options;
  const store = ProjectStore.getInstance();
  const existingScript = store.getArtifact<SceneScriptArtifact>(projectId, WorkflowStage.SCENE_SCRIPT);
  if (!existingScript) {
    return {
      success: false,
      error: `项目 [${projectId}] 尚未生成分场剧本底稿，无法执行修改`,
    };
  }

  const projectDir = store.getProjectDir(projectId);
  const jsonPath = path.join(projectDir, 'script', 'scene_script.json');

  console.log(`[scene-script.modifier] 启动纯字符串 Delta Patch 快速推演修改...`);

  const patchRes = await tryExecuteJsonStringPatch<SceneScriptArtifact>({
    jsonPath,
    userFeedback,
    extraContext: `全剧共 ${existingScript.scenes.length} 场戏`,
    stageName: 'scene_script_string_patch',
    projectId,
    llm,
  });

  if (!patchRes.success || !patchRes.data) {
    return {
      success: false,
      error: patchRes.error || '分场剧本字符串 Patch 校验未完全通过',
    };
  }

  const patchedArtifact = patchRes.data;
  patchedArtifact.totalScenes = patchedArtifact.scenes?.length || 0;

  store.setArtifact(projectId, WorkflowStage.SCENE_SCRIPT, patchedArtifact, {
    skill: 'scene-script-generator',
  });
  exportSceneScriptToDisk(projectId, patchedArtifact);

  const summary = `⚡【分场剧本修改完成】${patchRes.summary}。未修改场次对白 100% 物理保持原状。`;
  return {
    success: true,
    data: patchedArtifact,
    summary,
  };
}
