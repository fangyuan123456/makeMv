/**
 * tools/game-assembly/index.ts
 * 互动影游打包集成工坊 (Game Assembly Tool SSOT)
 */

import { BaseTaskTool } from '../base/task-tool.js';
import { createGameAssemblyWorkflow } from './workflow.js';
import {
  TechPlanStepInputSchema,
  type TechPlanStepInput,
} from './steps/01-tech-plan/index.js';
import {
  CodegenStepOutputSchema,
  type CodegenStepOutput,
} from './steps/02-codegen/index.js';

export * from './steps/01-tech-plan/index.js';
export * from './steps/02-codegen/index.js';
export * from './workflow.js';

export type GameAssemblyInput = TechPlanStepInput;
export type GameAssemblyOutput = CodegenStepOutput;

export class GameAssemblyTool extends BaseTaskTool<GameAssemblyInput, GameAssemblyOutput> {
  public readonly toolName = 'game.assembly';
  public readonly description = '将 PRD 策划案、状态机拓扑与分幕数据装配为浏览器可直接运行的互动影游前端工程与 index.html 试玩入口';

  protected buildWorkflow() {
    return createGameAssemblyWorkflow();
  }
}

export const gameAssemblyTool = new GameAssemblyTool();
