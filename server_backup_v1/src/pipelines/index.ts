/**
 * pipelines/index.ts
 * 生产流水线统一出口与工序映射 (SSOT)
 */

import { WorkflowStage } from '../types/index.js';
import { NarrativePipeline } from './narrative/NarrativePipeline.js';
import { CharacterPipeline } from './character/CharacterPipeline.js';
import { SceneScriptPipeline } from './scene-script/SceneScriptPipeline.js';
import { StoryboardPipeline } from './storyboard/StoryboardPipeline.js';
import { ReferencePipeline } from './reference/ReferencePipeline.js';
import { VideoProductionPipeline } from './video/VideoProductionPipeline.js';
import { FmvPackagingPipeline } from './packaging/FmvPackagingPipeline.js';
import type { PipelineResult } from './narrative/NarrativePipeline.js';

export * from './narrative/NarrativePipeline.js';
export * from './character/CharacterPipeline.js';
export * from './scene-script/SceneScriptPipeline.js';
export * from './storyboard/StoryboardPipeline.js';
export * from './reference/ReferencePipeline.js';
export * from './video/VideoProductionPipeline.js';
export * from './packaging/FmvPackagingPipeline.js';

export * from './narrative/types.js';
export * from './character/types.js';
export * from './scene-script/types.js';
export * from './storyboard/types.js';
export * from './reference/types.js';
export * from './video/types.js';
export * from './packaging/types.js';

export interface IExecutablePipeline {
  execute(input: any): Promise<PipelineResult>;
}

export const STAGE_PIPELINE_FACTORY: Record<
  string,
  (projectId?: string) => IExecutablePipeline
> = {
  [WorkflowStage.NARRATIVE_DESIGN]: (pid) => new NarrativePipeline(pid),
  [WorkflowStage.CHARACTER_DESIGN]: (pid) => new CharacterPipeline(pid),
  [WorkflowStage.SCENE_SCRIPT]: (pid) => new SceneScriptPipeline(pid),
  [WorkflowStage.STORYBOARD]: (pid) => new StoryboardPipeline(pid),
  [WorkflowStage.KEYFRAME_REFERENCE]: (pid) => new ReferencePipeline(pid),
  [WorkflowStage.VIDEO_PRODUCTION]: (pid) => new VideoProductionPipeline(pid),
  [WorkflowStage.FMV_PACKAGING]: (pid) => new FmvPackagingPipeline(pid),
};
