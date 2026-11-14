/**
 * tools/film-production/03-character-portrait-tool/index.ts
 * 角色立绘定妆工具 (Character Portrait Tool)
 */

import { BaseTaskTool } from '../../base/task-tool.js';
import { createCharacterPortraitWorkflow } from './workflow.js';
import {
  CharacterPortraitInputSchema,
  CharacterPortraitOutputSchema,
  type CharacterPortraitInput,
  type CharacterPortraitOutput,
} from './steps/01-render/index.js';

export * from './steps/01-render/index.js';
export * from './workflow.js';

export class CharacterPortraitTool extends BaseTaskTool<CharacterPortraitInput, CharacterPortraitOutput> {
  public readonly toolName = 'film.character_portrait';
  public readonly description = '物理渲染单个角色全身高清概念立绘并持久化落盘，支持外部垫参考图重绘';

  protected buildWorkflow() {
    return createCharacterPortraitWorkflow();
  }
}

export const characterPortraitTool = new CharacterPortraitTool();
