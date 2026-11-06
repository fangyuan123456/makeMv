/**
 * agents/pipeline/workflows/steps/scene-script/generator.ts
 * 分场剧本全量分块批量推演与节点一致性校验引擎 (Scene Script Generator SSOT)
 */

import type { LLMService } from '../../../../../llm/LLMService.js';
import { SCENE_SCRIPT_SYSTEM_PROMPT, buildSceneScriptPrompt } from './prompt.js';
import {
  SceneScriptBatchOutputSchema,
  type ScriptSceneNode,
  type SceneScriptBatchOutput,
  type SceneScriptArtifact,
} from './schema.js';

export interface ExpandSceneScriptOptions {
  title: string;
  theme: string;
  characters: any[];
  graphNodes: any[];
  userFeedback?: string;
  effectiveConstraints?: string[];
  projectId: string;
  chunkSize?: number;
}

export async function expandSceneScriptBatch(
  llm: LLMService,
  options: ExpandSceneScriptOptions
): Promise<ScriptSceneNode[]> {
  const {
    title,
    theme,
    characters,
    graphNodes,
    userFeedback,
    effectiveConstraints,
    projectId,
    chunkSize = 4,
  } = options;

  if (!graphNodes || graphNodes.length === 0) {
    throw new Error('剧情拓扑节点为空，无法执行分场剧本扩写');
  }

  const allScenes: ScriptSceneNode[] = [];

  for (let i = 0; i < graphNodes.length; i += chunkSize) {
    const chunk = graphNodes.slice(i, i + chunkSize);
    const prompt = buildSceneScriptPrompt(
      title,
      theme,
      characters,
      chunk,
      userFeedback,
      effectiveConstraints
    );

    const result = await llm.generateObject<SceneScriptBatchOutput>(
      prompt,
      SceneScriptBatchOutputSchema,
      SCENE_SCRIPT_SYSTEM_PROMPT,
      {
        stage: 'scene_script_expansion',
        projectId,
        temperature: 0.4,
      }
    );

    if (result && Array.isArray(result.scenes) && result.scenes.length > 0) {
      allScenes.push(...result.scenes);
    }
  }

  if (allScenes.length === 0) {
    throw new Error('分场剧本扩写失败，未产生有效场景数据');
  }

  const validNodeIds = new Set(graphNodes.map((n: any) => n.id));
  for (const scene of allScenes) {
    if (!validNodeIds.has(scene.nodeId)) {
      throw new Error(`剧本场次绑定的节点 ID [${scene.nodeId}] 在上游剧情拓扑中不存在，阻断幽灵场次`);
    }
  }

  return allScenes;
}

export interface GenerateSceneScriptOptions extends ExpandSceneScriptOptions {}

export async function generateSceneScript(
  llm: LLMService,
  options: GenerateSceneScriptOptions
): Promise<SceneScriptArtifact> {
  const allScenes = await expandSceneScriptBatch(llm, options);
  return {
    title: options.title || '未命名互动剧本',
    scenes: allScenes,
    totalScenes: allScenes.length,
    createdAt: new Date().toISOString(),
  };
}
