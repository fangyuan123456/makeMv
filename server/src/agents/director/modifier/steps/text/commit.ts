/**
 * agents/director/modifier/steps/text/commit.ts
 * 文本轨第 4 段：逐文件聚合落盘
 *
 * changedStages 是给状态机看的：下游清理必须以「本次真实改了哪些阶段」为起点，
 * 不能按单一工序推。文本轨常常一次改两三份产物，若仍按单一 skill 清下游，
 * 会把刚同步好的产物当成过期资产删掉。
 */

import { ProjectStore } from '../../../../../project-store/ProjectStore.js';
import type { ModifierCommitResult, PhaseReporter } from '../../spec.js';
import { TEXT_FILES } from './files.js';
import type { TextApplied, TextLoadState } from './types.js';

export async function commitTextChanges(
  _state: TextLoadState,
  applied: TextApplied,
  ctx: any,
  report: PhaseReporter
): Promise<ModifierCommitResult> {
  if (!applied?.updated?.length) {
    throw new Error('微调管线状态异常：没有可落盘的文件（apply 阶段未产出结果）');
  }

  const store = ProjectStore.getInstance();
  const projectId = ctx.projectId;
  const changedStages: string[] = [];
  const detail: string[] = [];

  for (const item of applied.updated) {
    const fileSpec = TEXT_FILES.find((f) => f.key === item.key);
    if (!fileSpec) throw new Error(`文件规格缺失，无法落盘: ${item.key}`);

    store.setArtifact(projectId, fileSpec.stage, item.artifact, {
      skill: item.artifactSkill,
    });
    fileSpec.commitExtras?.(projectId, item.artifact);
    fileSpec.exportToDisk(projectId, item.artifact);

    changedStages.push(fileSpec.stage);
    detail.push(`${fileSpec.title} ${item.appliedCount} 处`);
  }

  const summary = `⚡【文本修改完成】${applied.summary || ''}（已同步：${detail.join(
    '、'
  )}）。未涉及的产物 100% 物理保持原状。`;

  report(95, '已落盘');
  console.log(`[ModifierPipeline] 文本轨落盘完成: ${summary}`);

  return {
    toolResult: {
      changedStages,
      changedFiles: applied.updated.map((u) => u.key),
      summary,
    },
    summary,
  };
}
