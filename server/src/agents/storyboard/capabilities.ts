import { z } from 'zod';
import {
  storyboardBreakdownTool,
  shotPromptTool,
  shotKeyframeTool,
  imageUpscaleTool,
  shotVideoTool,
} from '../../tools/film-production/index.js';
import type { SubmittableToolSpec } from '../runtime/types.js';

export function storyboardCapabilities(clipId: string): SubmittableToolSpec[] {
  return [
    {
      toolName: storyboardBreakdownTool.toolName,
      title: `拆解或微调分幕[${clipId || '当前'}]分镜文学台本`,
      stageName: '分镜台本拆解',
      description: storyboardBreakdownTool.description,
      schema: storyboardBreakdownTool.inputSchema || z.any(),
      targetKind: 'global',
    },
    {
      toolName: shotPromptTool.toolName,
      title: '单镜视听一体化推演（首帧生图词与同相动态运镜词 Direction-First）',
      stageName: '单镜视听一体化推演',
      description: shotPromptTool.description,
      schema: shotPromptTool.inputSchema || z.any(),
      targetKind: 'shot',
    },
    {
      toolName: shotKeyframeTool.toolName,
      title: '生成/重绘/定向微调镜头关键帧（物理生图算力）',
      stageName: '首帧关键帧渲染',
      description: shotKeyframeTool.description,
      schema: shotKeyframeTool.inputSchema || z.any(),
      targetKind: 'shot',
    },
    {
      toolName: imageUpscaleTool.toolName,
      title: '高清超分镜头关键帧（SeedVR2）',
      stageName: 'SeedVR2 高清超分',
      description: imageUpscaleTool.description,
      schema: imageUpscaleTool.inputSchema || z.any(),
      targetKind: 'shot',
    },
    {
      toolName: shotVideoTool.toolName,
      title: '渲染镜头动态视频（物理视频算力）',
      stageName: '镜头动态视频渲染',
      description: shotVideoTool.description,
      schema: shotVideoTool.inputSchema || z.any(),
      targetKind: 'shot',
    },
  ];
}
