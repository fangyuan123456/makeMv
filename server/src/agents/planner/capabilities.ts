import { z } from 'zod';
import { screenplayTool } from '../../tools/planner/index.js';
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
  ];
}
