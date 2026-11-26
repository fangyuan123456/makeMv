/**
 * task-engine/task-registry.ts
 * 任务工具注册中心 (Task Tool Registry SSOT)
 */

import type { BaseTaskTool } from '../tools/base/task-tool.js';
import { screenplayTool, scriptToPrdTool } from '../tools/planner/index.js';
import {
  assetManifestTool,
  entitySpecTool,
  shootingScriptTool,
  shotFramePromptTool,
  shotPromptTool,
  shotMotionPromptTool,
  lookdevTool,
  shotKeyframeTool,
  shotVideoTool,
} from '../tools/film-production/index.js';
import { imageUpscaleTool } from '../tools/media/index.js';
import { gameAssemblyTool } from '../tools/game-assembly/index.js';

export interface ToolMetadata {
  toolName: string;
  description: string;
}

export class TaskToolRegistry {
  private static instance: TaskToolRegistry | null = null;
  private tools = new Map<string, BaseTaskTool<any, any>>();

  private constructor() {
    this.registerBuiltinTools();
  }

  public static getInstance(): TaskToolRegistry {
    if (!this.instance) {
      this.instance = new TaskToolRegistry();
    }
    return this.instance;
  }

  private registerBuiltinTools(): void {
    const list: BaseTaskTool<any, any>[] = [
      // 1. 剧本策划类
      screenplayTool,
      scriptToPrdTool,
      // 2. 影视视听制作类
      assetManifestTool,
      entitySpecTool,
      shootingScriptTool,
      shotFramePromptTool,
      shotMotionPromptTool,
      lookdevTool,
      shotKeyframeTool,
      shotVideoTool,
      imageUpscaleTool,
      // 3. 游戏总装类
      gameAssemblyTool,
    ];

    for (const tool of list) {
      this.register(tool);
    }

    // 历史别名兼容防守（允许历史任务记录通过旧名称定位工具实例）
    this.tools.set('film.shot_prompt', shotFramePromptTool);
    this.tools.set('film_shot_prompt', shotFramePromptTool);
  }

  public register(tool: BaseTaskTool<any, any>): void {
    this.tools.set(tool.toolName, tool);
    const canonicalName = tool.toolName.replace(/\./g, '_');
    this.tools.set(canonicalName, tool);
  }

  public getTool(toolName: string): BaseTaskTool<any, any> | undefined {
    return (
      this.tools.get(toolName) ||
      this.tools.get(toolName.replace(/\./g, '_')) ||
      this.tools.get(toolName.replace(/_/g, '.'))
    );
  }

  public getAllTools(): ToolMetadata[] {
    const seen = new Set<string>();
    const result: ToolMetadata[] = [];
    for (const tool of this.tools.values()) {
      if (!seen.has(tool.toolName)) {
        seen.add(tool.toolName);
        result.push({
          toolName: tool.toolName,
          description: tool.description,
        });
      }
    }
    // 兼容历史老名称 film.shot_prompt 查询
    if (seen.has('film.shot_frame_prompt') && !seen.has('film.shot_prompt')) {
      result.push({
        toolName: 'film.shot_prompt',
        description: '单镜首帧视觉推演与微调工具 (兼容别名)',
      });
    }
    return result;
  }
}

export const taskToolRegistry = TaskToolRegistry.getInstance();
