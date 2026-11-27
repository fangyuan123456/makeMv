/**
 * tools/game-assembly/assembly-tool/index.ts
 * 互动影游全量总装与增量修改工具 (GameAssemblyTool SSOT)
 */

import { BaseTaskTool } from '../../base/task-tool.js';
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
  public readonly description =
    '全量总装（mode=build）或按自然语言指令增量修改现有互动影游工程（mode=modify），输出浏览器可运行的 index.html';
  public readonly inputSchema = TechPlanStepInputSchema;
  public readonly outputSchema = CodegenStepOutputSchema;

  protected buildWorkflow() {
    return createGameAssemblyWorkflow();
  }
}

export const gameAssemblyTool = new GameAssemblyTool();
