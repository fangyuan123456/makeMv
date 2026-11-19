import { z } from 'zod';
import {
  imageUpscaleTool,
  shotKeyframeTool,
  shotVideoTool,
  storyboardPlanningTool,
} from '../../tools/film-production/index.js';
import type { SubmittableToolSpec } from '../runtime/types.js';

export function storyboardCapabilities(clipId: string): SubmittableToolSpec[] {
  return [
    {
      toolName: storyboardPlanningTool.toolName,
      title: `优化分幕[${clipId || '当前'}]分镜台本`,
      description: storyboardPlanningTool.description,
      schema: storyboardPlanningTool.inputSchema || z.any(),
    },
    {
      toolName: shotKeyframeTool.toolName,
      title: '生成/重绘镜头关键帧',
      description: shotKeyframeTool.description,
      schema: shotKeyframeTool.inputSchema || z.any(),
    },
    {
      toolName: imageUpscaleTool.toolName,
      title: '高清超分镜头关键帧（SeedVR2）',
      description: imageUpscaleTool.description,
      schema: imageUpscaleTool.inputSchema || z.any(),
    },
    {
      toolName: shotVideoTool.toolName,
      title: '渲染镜头动态视频',
      description: shotVideoTool.description,
      schema: shotVideoTool.inputSchema || z.any(),
    },
  ];
}
