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
  public readonly description = '出具指定角色的全身高清概念定妆照执行提案（支持提示词增强与垫图重绘），提交给创作者在界面中审阅批准后发起物理渲染';
  public readonly inputSchema = CharacterPortraitInputSchema;
  public readonly outputSchema = CharacterPortraitOutputSchema;

  protected buildWorkflow() {
    return createCharacterPortraitWorkflow();
  }
}

export const characterPortraitTool = new CharacterPortraitTool();
