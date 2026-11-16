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
  public readonly description = '出具指定场景的无人高清广角空镜母本图执行提案（支持环境光影与垫图重绘），提交给创作者在界面中审阅批准后发起物理渲染';
  public readonly inputSchema = SceneAtmosphereStepInputSchema;
  public readonly outputSchema = SceneAtmosphereStepOutputSchema;

  protected buildWorkflow() {
    return createSceneAtmosphereWorkflow();
  }
}

export const sceneAtmosphereTool = new SceneAtmosphereTool();
