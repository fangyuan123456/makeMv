/**
 * mastra/tools/scene-script/scene-script.tool.ts
 * Mastra 原生 Tool: 分场多分支剧本文学扩写 (Scene Script Tool SSOT)
 * 
 * 核心机制：
 * 1. 彻底消灭 slice 截断，采用全量节点批次分块 (Chunking) 推演；
 * 2. 纯中文影视文学提示词体系驱动；
 * 3. 产物双向落盘：ProjectStore SSOT 状态黑板 + 本地工程 script/ 物理目录；
 * 4. 原生标记 requireApproval: true 践行人在回路。
 */

import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import fs from 'fs';
import path from 'path';
import { ProjectStore } from '../../../project-store/ProjectStore.js';
import { LLMRegistry } from '../../../llm/LLMRegistry.js';
import { WorkflowStage } from '../../../types/index.js';
import { SCENE_SCRIPT_SYSTEM_PROMPT, buildSceneScriptPrompt } from './prompt.js';
import {
  SceneScriptArtifactSchema,
  SceneScriptBatchOutputSchema,
  type ScriptSceneNode,
  type SceneScriptArtifact,
  type SceneScriptBatchOutput,
} from './schema.js';

export const sceneScriptTool = createTool({
  id: 'scene-script-generator',
  description: '将故事圣经中的网状剧情拓扑节点逐场扩写为包含角色台词交锋、动作神态与微观互动情境的工业级分场剧本',
  inputSchema: z.object({
    projectId: z.string().describe('项目全局唯一 ID (Project ID)'),
    sessionId: z.string().optional().describe('当前交互会话 ID'),
    userFeedback: z.string().optional().describe('剧本台词或节奏偏好说明'),
  }).strict(),
  outputSchema: z.object({
    success: z.boolean(),
    data: SceneScriptArtifactSchema.optional(),
    summary: z.string().optional(),
    error: z.string().optional(),
  }),
  requireApproval: true,
  execute: async (params) => {
    try {
      const { projectId, sessionId, userFeedback } = params;
      const store = ProjectStore.getInstance();

      const narrativeArtifact = store.getArtifact<any>(projectId, WorkflowStage.NARRATIVE_DESIGN);
      const graphNodes = narrativeArtifact?.storyGraph?.nodes || [];

      if (!graphNodes || graphNodes.length === 0) {
        throw new Error('缺少前序故事世界观数据，请先执行前置工序【故事世界观推演】生成剧情拓扑');
      }

      const llm = LLMRegistry.get();
      const CHUNK_SIZE = 4;
      const allScenes: ScriptSceneNode[] = [];

      for (let i = 0; i < graphNodes.length; i += CHUNK_SIZE) {
        const chunk = graphNodes.slice(i, i + CHUNK_SIZE);
        const prompt = buildSceneScriptPrompt(
          narrativeArtifact.title || '互动影游',
          narrativeArtifact.theme || '探讨人性与科技',
          narrativeArtifact.characters || [],
          chunk,
          userFeedback
        );

        const result = await llm.generateObject<SceneScriptBatchOutput>(
          prompt,
          SceneScriptBatchOutputSchema,
          SCENE_SCRIPT_SYSTEM_PROMPT,
          { stage: 'scene_script_expansion', temperature: 0.4 }
        );

        if (result.scenes && result.scenes.length > 0) {
          allScenes.push(...result.scenes);
        }
      }

      if (allScenes.length === 0) {
        throw new Error('分场剧本扩写失败，未产生有效场景数据');
      }

      // P1-1 拓扑主键一致性校验
      const validNodeIds = new Set(graphNodes.map((n: any) => n.id));
      for (const scene of allScenes) {
        if (!validNodeIds.has(scene.nodeId)) {
          throw new Error(`剧本场次绑定的节点 ID [${scene.nodeId}] 在上游剧情拓扑中不存在，阻断幽灵场次`);
        }
      }

      const artifact: SceneScriptArtifact = {
        title: narrativeArtifact.title || '未命名互动剧本',
        scenes: allScenes,
        totalScenes: allScenes.length,
        createdAt: new Date().toISOString(),
      };

      store.setArtifact(projectId, WorkflowStage.SCENE_SCRIPT, artifact);
      exportToLocalDisk(projectId, artifact);

      // 回写会话备忘录
      if (sessionId) {
        const scenesBrief = allScenes
          .slice(0, 6)
          .map((s) => `- 第${s.act}幕 [${s.sceneTitle}] (${s.location}): ${s.actionSummary.slice(0, 35)}...`)
          .join('\n');
        store.updateScratchpad(projectId, sessionId, {
          cinematographyAndRhythm: `全剧共 ${allScenes.length} 场戏。前沿场次:\n${scenesBrief}`,
        });
      }

      const summary = `📖 全剧共 ${allScenes.length} 场戏剧本文学扩写完成并持久化落盘！`;
      return {
        success: true,
        data: artifact,
        summary,
      };
    } catch (err: any) {
      return {
        success: false,
        error: err.message || '分场剧本扩写失败',
      };
    }
  },
});

function exportToLocalDisk(projectId: string, artifact: SceneScriptArtifact) {
  try {
    const store = ProjectStore.getInstance();
    const projectDir = store.getProjectDir(projectId);
    const scriptDir = path.join(projectDir, 'script');
    if (!fs.existsSync(scriptDir)) {
      fs.mkdirSync(scriptDir, { recursive: true });
    }
    fs.writeFileSync(
      path.join(scriptDir, 'scene_scripts.json'),
      JSON.stringify(artifact, null, 2),
      'utf-8'
    );
  } catch (e) {
    console.warn('[sceneScriptTool] 本地磁盘落盘异常 (非致命):', e);
  }
}
