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

export class ScriptToPrdTool extends BaseTaskTool<ScriptToPrdInput, ScriptToPrdOutput> {
  public readonly toolName = 'planner.script_to_prd';
  public readonly description = '以已物理落盘的剧本正文为唯一基准，出具【Universal PRD 分幕与因果拓扑拆解】的工程执行提案（含图论闭环门禁校验规划），提交给创作者在界面中审阅与授权批准后执行';
  public readonly inputSchema = ScriptToPrdInputSchema;
  public readonly outputSchema = ScriptToPrdOutputSchema;

  protected buildWorkflow() {
    return createScriptToPrdWorkflow();
  }
}

/** 单例导出 */
export const scriptToPrdTool = new ScriptToPrdTool();
