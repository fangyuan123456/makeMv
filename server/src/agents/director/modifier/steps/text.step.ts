/**
 * agents/director/modifier/steps/text.step.ts
 * 文本内容修改 step（互斥分支 1/3）
 *
 * 覆盖 story-bible / scene-script / storyboard 三个工序——它们共用同一个修改器，
 * 因为文本改动天生可能跨文件。哪个工序触发都走这一条。
 */

import { createStep } from '@mastra/core/workflows';
import { ModifierContextSchema } from './common.js';
import { runModifierPhases } from './run-phases.js';
import { textModifierSpec } from './text/spec.js';

export const textModifierStep = createStep({
  id: 'step-modify-text',
  description: '文本内容定向修改（故事圣经 / 分场剧本 / 分镜）',
  inputSchema: ModifierContextSchema,
  outputSchema: ModifierContextSchema,
  execute: async ({ inputData, report }: any) => runModifierPhases(textModifierSpec, inputData, report),
});
