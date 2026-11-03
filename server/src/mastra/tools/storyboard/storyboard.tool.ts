/**
 * mastra/tools/storyboard/storyboard.tool.ts
 * Mastra 原生 Tool: 视听分镜头切分与运镜规划 (Storyboard Tool SSOT)
 * 
 * 核心机制：
 * 1. 彻底消灭 slice(0, 8) 截断，采用全量按批次 Chunking 分块推演；
 * 2. 独立纯中文影视专业 prompt.ts 驱动，规约景别、机位、运镜与构图；
 * 3. 产物双向落盘：ProjectStore SSOT 状态黑板 + 本地工程 storyboard/ 物理文件；
 * 4. 原生标记 requireApproval: true 践行人在回路。
 */

import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import fs from 'fs';
import path from 'path';
import { ProjectStore } from '../../../project-store/ProjectStore.js';
import { LLMRegistry } from '../../../llm/LLMRegistry.js';
import { WorkflowStage } from '../../../types/index.js';
import { STORYBOARD_SYSTEM_PROMPT, buildStoryboardPrompt } from './prompt.js';
import {
  StoryboardArtifactSchema,
  StoryboardBatchOutputSchema,
  type StoryboardShotItem,
  type StoryboardArtifact,
  type StoryboardBatchOutput,
} from './schema.js';

export const storyboardTool = createTool({
  id: 'storyboard-generator',
  description: '将分场剧本逐场拆解为包含景别、机位运动、建议时长与画面构图细节的工业级分镜头表',
  inputSchema: z.object({
    projectId: z.string().describe('项目全局唯一 ID (Project ID)'),
    sessionId: z.string().optional().describe('当前交互会话 ID'),
    userFeedback: z.string().optional().describe('景别偏好或节奏调整要求'),
  }).strict(),
  outputSchema: z.object({
    success: z.boolean(),
    data: StoryboardArtifactSchema.optional(),
    summary: z.string().optional(),
    error: z.string().optional(),
  }),
  requireApproval: true,
  execute: async (params) => {
    try {
      const { projectId, sessionId, userFeedback } = params;
      const store = ProjectStore.getInstance();

      const scriptArtifact = store.getArtifact<any>(projectId, WorkflowStage.SCENE_SCRIPT);
      const scenes = scriptArtifact?.scenes || [];

      if (!scenes || scenes.length === 0) {
        throw new Error('缺少前序分场剧本数据，请先执行前置工序【分场剧本】');
      }

      const llm = LLMRegistry.get();
      const CHUNK_SIZE = 5;
      const allShots: StoryboardShotItem[] = [];

      for (let i = 0; i < scenes.length; i += CHUNK_SIZE) {
        const chunk = scenes.slice(i, i + CHUNK_SIZE);
        const prompt = buildStoryboardPrompt(scriptArtifact.title || '互动影游', chunk, userFeedback);

        const result = await llm.generateObject<StoryboardBatchOutput>(
          prompt,
          StoryboardBatchOutputSchema,
          STORYBOARD_SYSTEM_PROMPT,
          { stage: 'storyboard_segmentation', temperature: 0.4 }
        );

        if (result.shots && result.shots.length > 0) {
          allShots.push(...result.shots);
        }
      }

      if (allShots.length === 0) {
        throw new Error('视听分镜头切分失败，未产生有效分镜头数据');
      }

      // 镜头与场次主键归属性刚性校验
      const validNodeIds = new Set(scenes.map((sc: any) => sc.nodeId));
      for (const shot of allShots) {
        if (!validNodeIds.has(shot.nodeId)) {
          throw new Error(`分镜头 [${shot.shotId}] 关联的剧情节点 [${shot.nodeId}] 在分场剧本中不存在，阻断幽灵镜头`);
        }
      }

      const totalDuration = allShots.reduce((acc, shot) => acc + (shot.durationSec || 4), 0);

      const artifact: StoryboardArtifact = {
        title: scriptArtifact.title || '未命名分镜头表',
        shots: allShots,
        totalShots: allShots.length,
        estimatedTotalDurationSec: totalDuration,
        createdAt: new Date().toISOString(),
      };

      store.setArtifact(projectId, WorkflowStage.STORYBOARD, artifact);
      exportToLocalDisk(projectId, artifact);

      // 回写备忘录白板
      if (sessionId) {
        const scaleDistribution = allShots.reduce<Record<string, number>>((acc, s) => {
          acc[s.shotScale] = (acc[s.shotScale] || 0) + 1;
          return acc;
        }, {});
        const distStr = Object.entries(scaleDistribution).map(([k, v]) => `${k}:${v}镜`).join('、');
        store.updateScratchpad(projectId, sessionId, {
          cinematographyAndRhythm: `全片已切分 ${allShots.length} 镜 (预估时长 ${totalDuration}s)。景别配比: ${distStr}`,
        });
      }

      const summary = `🎬 全片已拆解为 ${allShots.length} 个视听分镜头，总预估时长约 ${Math.round(totalDuration / 60)} 分钟！`;
      return {
        success: true,
        data: artifact,
        summary,
      };
    } catch (err: any) {
      return {
        success: false,
        error: err.message || '分镜头切分失败',
      };
    }
  },
});

function exportToLocalDisk(projectId: string, artifact: StoryboardArtifact) {
  try {
    const store = ProjectStore.getInstance();
    const projectDir = store.getProjectDir(projectId);
    const sbDir = path.join(projectDir, 'storyboard');
    if (!fs.existsSync(sbDir)) {
      fs.mkdirSync(sbDir, { recursive: true });
    }
    fs.writeFileSync(
      path.join(sbDir, 'storyboard.json'),
      JSON.stringify(artifact, null, 2),
      'utf-8'
    );
  } catch (e) {
    console.warn('[storyboardTool] 本地磁盘落盘异常 (非致命):', e);
  }
}
