/**
 * agents/director/modifier/modifier.workflow.ts
 * 定向微调唯一工作流 (Modifier Workflow SSOT)
 *
 * 与生成轨同构：**一个业务单元 = 一个 step**。
 * 生成轨是「一个工序一个 step」，修改轨是「一个媒介一个 step」——
 * 三条分支互斥，一次请求只命中一条，其余由 skipIf 静默透传（不执行、不上报）。
 *
 * 每个 step 内部串四段：load → plan → apply → commit。
 * 四段之间的中间态是局部变量，不跨 step，因此没有 z.any() 中转，
 * 也不需要为每个工序再建一条 workflow。
 *
 * 权重按媒介动态分配：命中分支 100%，其余 0。静态 weight 无法表达
 * 「文本 80% 花在推演、视频 80% 花在渲染」这种耗时结构差异。
 */

import { Workflow } from '../../../workflow-engine/index.js';
import { ModifierContextSchema } from './steps/common.js';
import { textModifierStep } from './steps/text/step.js';
import { imageModifierStep } from './steps/image/step.js';
import { videoModifierStep } from './steps/video/step.js';
import { extractTargetSkill, type ModifierKind } from './spec.js';
import { getModifierSpec } from './manifest.js';

/** 本次请求命中的媒介；工序未声明微调规格时返回 undefined */
function mediumOf(inputData: any): ModifierKind | undefined {
  const skillKey = extractTargetSkill(inputData);
  return skillKey ? getModifierSpec(skillKey)?.kind : undefined;
}

export const modifierWorkflow = Workflow.getInstance().create({
  id: 'subwf-modify',
  title: '定向微调',
  description:
    '按产物媒介分三条互斥路径，每条内部走 读取底稿 → 推演变更 → 执行落地 → 聚合落盘',
  inputSchema: ModifierContextSchema,
  outputSchema: ModifierContextSchema,
  requireConfirmation: false,
  steps: [
    {
      step: textModifierStep,
      name: '文本内容修改',
      skipIf: (inputData: any) => mediumOf(inputData) !== 'text',
    },
    {
      step: imageModifierStep,
      name: '图像内容修改',
      skipIf: (inputData: any) => mediumOf(inputData) !== 'image',
    },
    {
      step: videoModifierStep,
      name: '视频内容修改',
      skipIf: (inputData: any) => mediumOf(inputData) !== 'video',
    },
  ],
  weightResolver: (inputData: any) => {
    switch (mediumOf(inputData)) {
      case 'text':
        return [100, 0, 0];
      case 'image':
        return [0, 100, 0];
      case 'video':
        return [0, 0, 100];
      default:
        // 未知媒介：回落按步数均分，具体错误由 step 抛出，保证失败可见
        return undefined;
    }
  },
});
