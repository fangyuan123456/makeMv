import { z } from 'zod';
import { screenplayTool, scriptToPrdTool } from '../../tools/planner/index.js';
import type { SubmittableToolSpec } from '../runtime/types.js';

export function plannerCapabilities(): SubmittableToolSpec[] {
  return [
    { toolName: screenplayTool.toolName, title: '推演互动全景剧本', description: screenplayTool.description, schema: screenplayTool.inputSchema || z.any() },
    { toolName: scriptToPrdTool.toolName, title: '解析生成 PRD 拓扑', description: scriptToPrdTool.description, schema: scriptToPrdTool.inputSchema || z.any() },
  ];
}
