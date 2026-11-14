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
  public readonly description = '从 Markdown 格式互动影游全景剧本中精准抽取 Universal PRD、分镜故事段落、拓扑图谱并执行图论闭环门禁';

  protected buildWorkflow() {
    return createScriptToPrdWorkflow();
  }
}

/** 单例导出 */
export const scriptToPrdTool = new ScriptToPrdTool();
