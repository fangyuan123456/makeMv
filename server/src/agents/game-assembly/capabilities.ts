import { z } from 'zod';
import { gameAssemblyTool, gameCompileStoryTool, gamePrdTool } from '../../tools/game-assembly/index.js';
import type { SubmittableToolSpec } from '../runtime/types.js';

export function gameAssemblyCapabilities(): SubmittableToolSpec[] {
  return [
    {
      toolName: gamePrdTool.toolName,
      title: '生成游戏产品 PRD 规格',
      stageName: '游戏 PRD 规格生成',
      description: gamePrdTool.description,
      schema: gamePrdTool.inputSchema || z.any(),
      targetKind: 'global',
    },
    {
      toolName: gameAssemblyTool.toolName,
      title: '总装或修改互动影游工程',
      stageName: '游戏总装与调优',
      description: gameAssemblyTool.description,
      schema: gameAssemblyTool.inputSchema || z.any(),
      targetKind: 'global',
    },
    {
      toolName: gameCompileStoryTool.toolName,
      title: '同步剧本与媒体数据到游戏',
      stageName: '数据层同步',
      description: gameCompileStoryTool.description,
      schema: gameCompileStoryTool.inputSchema || z.any(),
      targetKind: 'global',
    },
  ];
}
