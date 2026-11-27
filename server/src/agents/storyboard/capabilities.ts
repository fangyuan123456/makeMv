import { z } from 'zod';
import {
  shootingScriptTool,
  shotMotionPromptTool,
  shotVideoTool,
} from '../../tools/film-production/index.js';
import type { SubmittableToolSpec } from '../runtime/types.js';

export function storyboardCapabilities(clipId: string): SubmittableToolSpec[] {
  return [
    {
      toolName: shootingScriptTool.toolName,
      title: `规划分幕[${clipId || '当前'}]工业级分镜摄制台本（全幕分镜切镜、重新提取分镜、时空环境锁与镜头清单）`,
      stageName: '工业级分镜摄制台本',
      description: '全幕分镜提取与摄制台本工具（重新提取分镜/划分镜头清单）。一步到位解构本幕文学剧本为物理场面调度与全量分镜单，锁定场景时空光影，或进行定向重切增删改。',
      schema: shootingScriptTool.inputSchema || z.any(),
      targetKind: 'global',
    },
    {
      toolName: shotMotionPromptTool.toolName,
      title: '单镜视频时序动态推演（3~5秒动作演进与全员生命体征微动态 Motion-First）',
      stageName: '单镜视频动态推演',
      description: shotMotionPromptTool.description,
      schema: shotMotionPromptTool.inputSchema || z.any(),
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
