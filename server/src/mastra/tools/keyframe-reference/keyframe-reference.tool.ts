/**
 * mastra/tools/keyframe-reference/keyframe-reference.tool.ts
 * Mastra 原生 Tool: 关键帧首帧高清图像渲染与单镜头微调自愈 (Keyframe Reference Tool SSOT)
 * 
 * 核心机制：
 * 1. 纯中文影视专业 prompt.ts 驱动，融合角色定妆与分镜景别构图；
 * 2. 意图 100% 透传给 VisualMediaRenderer.renderKeyframeImage；
 * 3. 产物双向落盘：ProjectStore SSOT 状态黑板 + 本地工程 keyframes/ 物理文件；
 * 4. 支持 targetShotId 单镜重绘自愈与人在回路 requireApproval: true。
 */

import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import fs from 'fs';
import path from 'path';
import { ProjectStore } from '../../../project-store/ProjectStore.js';
import { LLMRegistry } from '../../../llm/LLMRegistry.js';
import { VisualMediaRenderer } from '../../../media/VisualMediaRenderer.js';
import { asyncPool } from '../../../utils/concurrency.js';
import { WorkflowStage } from '../../../types/index.js';
import { KEYFRAME_REFERENCE_SYSTEM_PROMPT, buildKeyframeReferencePrompt } from './prompt.js';
import {
  KeyframeReferenceArtifactSchema,
  KeyframeBatchOutputSchema,
  type KeyframeItem,
  type KeyframeReferenceArtifact,
  type KeyframeBatchOutput,
} from './schema.js';

export const keyframeReferenceTool = createTool({
  id: 'keyframe-reference-generator',
  description: '为视听分镜头表中的每个分镜生成首帧高清剧照参考图，作为后续动态视频生成的一致性基准底图；支持单镜头重绘微调',
  inputSchema: z.object({
    projectId: z.string().describe('项目全局唯一 ID (Project ID)'),
    sessionId: z.string().optional().describe('当前交互会话 ID'),
    targetShotId: z.string().optional().describe('指定微调单镜 ID (如 shot_1)，执行局部自愈'),
    userFeedback: z.string().optional().describe('关键帧美学或特定镜头修改指令'),
    isMock: z.boolean().optional().describe('是否为 Mock 模拟测试'),
  }).strict(),
  outputSchema: z.object({
    success: z.boolean(),
    data: KeyframeReferenceArtifactSchema.optional(),
    summary: z.string().optional(),
    error: z.string().optional(),
  }),
  requireApproval: true,
  execute: async (params) => {
    try {
      const { projectId, targetShotId, userFeedback, isMock } = params;
      const store = ProjectStore.getInstance();
      const project = store.getProject(projectId);

      const storyboardArtifact = store.getArtifact<any>(projectId, WorkflowStage.STORYBOARD);
      const shots = storyboardArtifact?.shots || [];

      if (!shots || shots.length === 0) {
        throw new Error('缺少前序视听分镜数据，请先执行前置工序【视听分镜切分】');
      }

      const charArtifact = store.getArtifact<any>(projectId, WorkflowStage.CHARACTER_DESIGN);
      const characterVisualSpecs = charArtifact?.characters || [];
      const style = storyboardArtifact.style || project?.meta?.style || '电影质感，写实光影';

      const existingArtifact = store.getArtifact<KeyframeReferenceArtifact>(projectId, WorkflowStage.KEYFRAME_REFERENCE);

      // 分支一：单镜头靶向微调自愈
      if (targetShotId) {
        if (!existingArtifact || !Array.isArray(existingArtifact.shots) || existingArtifact.shots.length === 0) {
          throw new Error('当前项目尚无既有关键帧资产，无法执行指定镜头微调，请先执行全量生成');
        }

        const targetShot = shots.find((s: any) => s.shotId === targetShotId);
        if (!targetShot) {
          throw new Error(`在分镜头表中未找到指定的镜头 [${targetShotId}]`);
        }

        const shotIndex = existingArtifact.shots.findIndex((s) => s.shotId === targetShotId);
        const currentPrompt = existingArtifact.shots[shotIndex]?.prompt || targetShot.visualComposition;
        const refinedPrompt = userFeedback ? `${currentPrompt}，${userFeedback}` : currentPrompt;

        const renderRes = await VisualMediaRenderer.renderKeyframeImage(
          projectId,
          targetShot.shotId,
          '16:9',
          refinedPrompt,
          { isMock }
        );

        const updatedShots = [...existingArtifact.shots];
        const updatedItem: KeyframeItem = {
          shotId: targetShot.shotId,
          shotNumber: targetShot.shotNumber || (shotIndex + 1),
          prompt: refinedPrompt,
          imageUrl: renderRes.url,
          aspectRatio: '16:9',
          status: 'ready',
          isDegraded: renderRes.isDegraded,
          degradedReason: renderRes.degradedReason,
        };

        if (shotIndex !== -1) {
          updatedShots[shotIndex] = updatedItem;
        } else {
          updatedShots.push(updatedItem);
        }

        const updatedArtifact: KeyframeReferenceArtifact = {
          shots: updatedShots,
          totalKeyframes: updatedShots.length,
          completedKeyframes: updatedShots.length,
          isRefinement: true,
          targetShotId,
          createdAt: existingArtifact.createdAt || new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };

        store.setArtifact(projectId, WorkflowStage.KEYFRAME_REFERENCE, updatedArtifact);
        exportToLocalDisk(projectId, updatedArtifact);

        return {
          success: true,
          data: updatedArtifact,
          summary: `✨ 关键帧【${targetShotId}】单镜重绘完成！首帧基准图已更新落盘。`,
        };
      }

      // 分支二：全量关键帧批量生成
      const llm = LLMRegistry.get();
      const anchorsSummary = characterVisualSpecs
        .map((c: any) => `角色【${c.name}】(${c.role}): 定妆视觉规范: ${c.visualPrompt}`)
        .join('\n');

      const prompt = buildKeyframeReferencePrompt(style, anchorsSummary, shots, userFeedback);

      const batchResult = await llm.generateObject<KeyframeBatchOutput>(
        prompt,
        KeyframeBatchOutputSchema,
        KEYFRAME_REFERENCE_SYSTEM_PROMPT,
        { stage: 'keyframe_prompt_generation', temperature: 0.3 }
      );

      const promptMap = new Map<string, string>();
      for (const k of batchResult.keyframes || []) {
        promptMap.set(k.shotId, k.prompt);
      }

      // 3路并发执行高清关键帧渲染
      const renderedKeyframes = await asyncPool<any, KeyframeItem>(
        3,
        shots,
        async (shot: any) => {
          const generatedPrompt = promptMap.get(shot.shotId) || `${shot.visualComposition}，${style}`;
          const renderRes = await VisualMediaRenderer.renderKeyframeImage(
            projectId,
            shot.shotId,
            '16:9',
            generatedPrompt,
            { isMock }
          );

          return {
            shotId: shot.shotId,
            shotNumber: shot.shotNumber,
            prompt: generatedPrompt,
            imageUrl: renderRes.url,
            aspectRatio: '16:9',
            status: 'ready',
            isDegraded: renderRes.isDegraded,
            degradedReason: renderRes.degradedReason,
          };
        }
      );

      const artifact: KeyframeReferenceArtifact = {
        shots: renderedKeyframes,
        totalKeyframes: renderedKeyframes.length,
        completedKeyframes: renderedKeyframes.length,
        createdAt: new Date().toISOString(),
      };

      store.setArtifact(projectId, WorkflowStage.KEYFRAME_REFERENCE, artifact);
      exportToLocalDisk(projectId, artifact);

      const summary = `🖼️ 全片 ${renderedKeyframes.length} 个分镜的高清首帧关键帧参考图生成完成并落盘！`;
      return {
        success: true,
        data: artifact,
        summary,
      };
    } catch (err: any) {
      return {
        success: false,
        error: err.message || '关键帧参考图生成失败',
      };
    }
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
    console.warn('[keyframeReferenceTool] 本地磁盘落盘异常 (非致命):', e);
  }
}
