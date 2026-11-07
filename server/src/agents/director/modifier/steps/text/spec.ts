/**
 * agents/director/modifier/steps/text/spec.ts
 * 文本内容修改器 (Text Modifier Spec)
 *
 * 一个修改器覆盖故事圣经 / 分场剧本 / 分镜三份文本产物：
 * 读全部原文 + 骨架索引 → 一次推演跨文件补丁 → 原子校验 → 逐文件落盘。
 *
 * 为什么是一个而不是三个：改角色年龄、改角色名、改一句台词的语气，
 * 这些改动的正确结果常常需要三份文件同时一致；拆成三个修改器后，
 * 每次只改一份，另外两份就变成「过期资产」被清掉，用户得手动重跑。
 */

import type { ModifierSpec } from '../../spec.js';
import { loadTextState } from './load.js';
import { planTextChanges } from './plan.js';
import { applyTextPatches } from './apply.js';
import { commitTextChanges } from './commit.js';
import type { TextApplied, TextLoadState, TextPlan } from './types.js';

export const textModifierSpec: ModifierSpec<TextLoadState, TextPlan, TextApplied> = {
  key: 'text',
  title: '文本内容',
  kind: 'text',
  load: loadTextState,
  plan: planTextChanges,
  apply: applyTextPatches,
  commit: commitTextChanges,
};
