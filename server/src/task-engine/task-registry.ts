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
  shotPromptTool,
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
      shotPromptTool,
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
    return result;
  }
}

export const taskToolRegistry = TaskToolRegistry.getInstance();
