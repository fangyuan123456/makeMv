/**
 * tools/film-production/04-prop-lookdev-tool/index.ts
 * 道具特写定妆工具 (Prop Lookdev Tool)
 */

import { BaseTaskTool } from '../../base/task-tool.js';
import { createPropLookdevWorkflow } from './workflow.js';
import {
  PropLookdevInputSchema,
  PropLookdevOutputSchema,
  type PropLookdevInput,
  type PropLookdevOutput,
} from './steps/01-render/index.js';

export * from './steps/01-render/index.js';
export * from './workflow.js';

export class PropLookdevTool extends BaseTaskTool<PropLookdevInput, PropLookdevOutput> {
  public readonly toolName = 'film.prop_lookdev';
  public readonly description = '物理渲染单个核心实物道具特写图并持久化落盘，支持外部垫参考图重绘';

  protected buildWorkflow() {
    return createPropLookdevWorkflow();
  }
}

export const propLookdevTool = new PropLookdevTool();
