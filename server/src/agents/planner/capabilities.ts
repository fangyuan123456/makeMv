import { z } from 'zod';
import { screenplayTool, scriptToPrdTool } from '../../tools/planner/index.js';
import type { SubmittableToolSpec } from '../runtime/types.js';

export function plannerCapabilities(): SubmittableToolSpec[] {
  return [
    {
      toolName: screenplayTool.toolName,
      title: '推演互动全景剧本',
      stageName: '全景剧本推演',
      description: screenplayTool.description,
      schema: screenplayTool.inputSchema || z.any(),
      targetKind: 'global',
    },
    {
      toolName: scriptToPrdTool.toolName,
      title: '解析生成 PRD 拓扑',
      stageName: '全剧分幕拓扑拆解',
      description: scriptToPrdTool.description,
      schema: scriptToPrdTool.inputSchema || z.any(),
      targetKind: 'global',
    },
  ];
}
