/**
 * tools/film-production/05-scene-atmosphere-tool/index.ts
 * 场景空镜定妆工具 (Scene Atmosphere Tool)
 */

import { BaseTaskTool } from '../../base/task-tool.js';
import { createSceneAtmosphereWorkflow } from './workflow.js';
import {
  SceneAtmosphereStepInputSchema,
  SceneAtmosphereStepOutputSchema,
  type SceneAtmosphereStepInput,
  type SceneAtmosphereStepOutput,
} from './steps/01-render/index.js';

export * from './steps/01-render/index.js';
export * from './workflow.js';

export class SceneAtmosphereTool extends BaseTaskTool<SceneAtmosphereStepInput, SceneAtmosphereStepOutput> {
  public readonly toolName = 'film.scene_atmosphere';
  public readonly description = '调用物理生图算力与垫参考图，渲染单个场景无人高清广角空镜母本图并持久化落盘';

  protected buildWorkflow() {
    return createSceneAtmosphereWorkflow();
  }
}

export const sceneAtmosphereTool = new SceneAtmosphereTool();
