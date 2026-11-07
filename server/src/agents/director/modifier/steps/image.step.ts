/**
 * agents/director/modifier/steps/image.step.ts
 * 图像内容修改 step（互斥分支 2/3）
 *
 * 图像有两个目标形态，二者流程同构、实现不同：
 *   character-portrait  操作 characters[]，重渲染角色定妆
 *   keyframe-reference  操作 shots[]，重绘镜头关键帧
 * 按 targetSkill 查注册表选定其一，step 本身不含分支逻辑。
 */

import { createStep } from '@mastra/core/workflows';
import { ModifierContextSchema } from './common.js';
import { runModifierPhases } from './run-phases.js';
import { extractTargetSkill, type ModifierSpec } from '../spec.js';
import { characterPortraitSpec } from './image/character-portrait/spec.js';
import { keyframeReferenceSpec } from './image/keyframe-reference/spec.js';

/** 图像目标注册表：一个工序一个修改器，按 targetSkill 精确命中 */
export const IMAGE_SPECS: Record<string, ModifierSpec> = {
  'character-portrait': characterPortraitSpec,
  'keyframe-reference': keyframeReferenceSpec,
};

export const imageModifierStep = createStep({
  id: 'step-modify-image',
  description: '图像内容定向修改（角色定妆 / 镜头关键帧）',
  inputSchema: ModifierContextSchema,
  outputSchema: ModifierContextSchema,
  execute: async ({ inputData, report }: any) => {
    const skillKey = extractTargetSkill(inputData);
    const spec = skillKey ? IMAGE_SPECS[skillKey] : undefined;
    if (!spec) {
      throw new Error(`工序 [${skillKey || '未指定'}] 未声明图像微调规格，无法执行定向修改`);
    }
    return runModifierPhases(spec, inputData, report);
  },
});
