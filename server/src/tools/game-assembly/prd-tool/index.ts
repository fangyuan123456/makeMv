/**
 * tools/planner/script-to-prd-tool/index.ts
 * 剧本资产工程解析与 PRD 提取工具 (Script To PRD Tool)
 */

import { BaseTaskTool } from '../../base/task-tool.js';
import { createScriptToPrdWorkflow } from './workflow.js';
import {
  ScriptToPrdInputSchema,
  type ScriptToPrdInput,
} from './steps/01-extract/index.js';
import {
  ScriptToPrdOutputSchema,
  type ScriptToPrdOutput,
} from './steps/02-synthesize/index.js';

export * from './steps/01-extract/index.js';
export * from './steps/02-synthesize/index.js';
export * from './workflow.js';

export class GamePrdTool extends BaseTaskTool<ScriptToPrdInput, ScriptToPrdOutput> {
  public readonly toolName = 'game.prd';
  public readonly description = '在游戏总装阶段基于结构化剧本生成游戏产品 PRD 规格（含 UI 主题、状态变量字典、6 屏交互规划与工程拓扑）';
  public readonly inputSchema = ScriptToPrdInputSchema;
  public readonly outputSchema = ScriptToPrdOutputSchema;

  protected buildWorkflow() {
    return createScriptToPrdWorkflow();
  }
}

/** 单例导出 */
export const gamePrdTool = new GamePrdTool();
