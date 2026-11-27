/**
 * tools/game-assembly/compile-story-tool/index.ts
 * 互动影游数据层同步工具 (GameCompileStoryTool SSOT)
 */

import { BaseTaskTool } from '../../base/task-tool.js';
import { createCompileStoryWorkflow } from './workflow.js';
import {
  CompileStoryInputSchema,
  CompileStoryOutputSchema,
  type CompileStoryInput,
  type CompileStoryOutput,
} from './steps/01-compile-story/index.js';

export * from './steps/01-compile-story/index.js';
export * from './workflow.js';

export class GameCompileStoryTool extends BaseTaskTool<CompileStoryInput, CompileStoryOutput> {
  public readonly toolName = 'game.compile_story';
  public readonly description =
    '仅重新编译同步 story.json 与系统底座 runtime/*（当上游剧本、背景图、视频或定妆图修改后使用，不重写已定制的前端表现代码）';
  public readonly inputSchema = CompileStoryInputSchema;
  public readonly outputSchema = CompileStoryOutputSchema;

  protected buildWorkflow() {
    return createCompileStoryWorkflow();
  }
}

export const gameCompileStoryTool = new GameCompileStoryTool();
