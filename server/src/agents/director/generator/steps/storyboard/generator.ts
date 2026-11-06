/**
 * agents/pipeline/workflows/steps/storyboard/generator.ts
 * 视听分镜头全量分块批量拆解与时长核算引擎 (Storyboard Generator SSOT)
 */

import type { LLMService } from '../../../../../llm/LLMService.js';
import { STORYBOARD_SYSTEM_PROMPT, buildStoryboardPrompt } from './prompt.js';
import {
  StoryboardBatchOutputSchema,
  type StoryboardShotItem,
  type StoryboardBatchOutput,
  type StoryboardArtifact,
} from './schema.js';

export interface GenerateStoryboardOptions {
  title: string;
  scenes: any[];
  userFeedback?: string;
  effectiveConstraints?: string[];
  projectId: string;
  chunkSize?: number;
}

export async function generateStoryboardBatch(
  llm: LLMService,
  options: GenerateStoryboardOptions
): Promise<{ shots: StoryboardShotItem[]; totalDurationSec: number }> {
  const {
    title,
    scenes,
    userFeedback,
    effectiveConstraints,
    projectId,
    chunkSize = 2,
  } = options;

  if (!scenes || scenes.length === 0) {
    throw new Error('分场剧本为空，无法拆解分镜头');
  }

  const allShots: StoryboardShotItem[] = [];

  for (let i = 0; i < scenes.length; i += chunkSize) {
    const chunk = scenes.slice(i, i + chunkSize);
    const prompt = buildStoryboardPrompt(title, chunk, userFeedback, effectiveConstraints);

    const result = await llm.generateObject<StoryboardBatchOutput>(
      prompt,
      StoryboardBatchOutputSchema,
      STORYBOARD_SYSTEM_PROMPT,
      {
        stage: 'storyboard_segmentation',
        projectId,
        temperature: 0.4,
      }
    );

    if (result && Array.isArray(result.shots) && result.shots.length > 0) {
      allShots.push(...result.shots);
    }
  }

  if (allShots.length === 0) {
    throw new Error('视听分镜头切分失败，未产生有效分镜头数据');
  }

  const validNodeIds = new Set(scenes.map((sc: any) => sc.nodeId));
  for (const shot of allShots) {
    if (!validNodeIds.has(shot.nodeId)) {
      throw new Error(`分镜头 [${shot.shotId}] 关联的剧情节点 [${shot.nodeId}] 在分场剧本中不存在，阻断幽灵镜头`);
    }
  }

  const totalDurationSec = calculateTotalDurationSec(allShots);

  return { shots: allShots, totalDurationSec };
}

export function calculateTotalDurationSec(shots: StoryboardShotItem[]): number {
  return shots.reduce((acc, shot) => acc + (shot.durationSec || 4), 0);
}

export async function generateStoryboard(
  llm: LLMService,
  options: GenerateStoryboardOptions
): Promise<StoryboardArtifact> {
  const { shots, totalDurationSec } = await generateStoryboardBatch(llm, options);
  return {
    title: options.title || '未命名视听分镜表',
    totalShots: shots.length,
    estimatedTotalDurationSec: totalDurationSec,
    shots,
    createdAt: new Date().toISOString(),
  };
}
