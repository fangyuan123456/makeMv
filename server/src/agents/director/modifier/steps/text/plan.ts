/**
 * agents/director/modifier/steps/text/plan.ts
 * 文本轨第 2 段：一次调用推演跨文件补丁清单（本轨唯一的重 IO）
 *
 * 为什么是一次而不是逐文件 N 次：串行 N 次有顺序悖论——改剧本时看的是旧圣经，
 * 改分镜时看的是旧剧本，第三次改完前两次的假设可能已失效。一次调用让模型
 * 同时看见全部三份产物，才能产出跨文件一致的补丁。
 */

import { generateMultiFilePatchPlan } from '../../../../../utils/universal-patch.js';
import type { PhaseReporter } from '../../spec.js';
import type { TextLoadState, TextPlan } from './types.js';

export async function planTextChanges(
  state: TextLoadState,
  ctx: any,
  report: PhaseReporter
): Promise<TextPlan> {
  report(22, `推演跨文件变更方案（${state.files.length} 份产物）…`);
  console.log(
    `[ModifierPipeline] 文本轨启动跨文件 Delta 补丁推演（${state.files.length} 份产物）...`
  );

  const plan = await generateMultiFilePatchPlan({
    files: state.files.map((f) => ({
      fileName: f.relPath,
      title: f.title,
      content: f.content,
      skeleton: f.probe,
      isPrimary: f.key === state.primaryFileKey,
    })),
    userFeedback: state.userFeedback,
    stageName: 'text_multi_file_patch',
    projectId: ctx.projectId,
    llm: ctx.llm,
    extraContext: `本次共有 ${state.files.length} 份文本产物参与修改：${state.files
      .map((f) => f.title)
      .join('、')}`,
  });

  if (!plan.success || !plan.patches?.length) {
    throw new Error(plan.error || '大模型未生成有效补丁清单');
  }

  const touched = new Set(plan.patches.map((p) => p.file));
  report(75, `补丁推演完成：${plan.patches.length} 处，涉及 ${touched.size} 份产物`);
  console.log(
    `[ModifierPipeline] 文本轨补丁推演完成: ${plan.patches.length} 处，涉及 ${touched.size} 份产物`
  );

  return plan;
}
