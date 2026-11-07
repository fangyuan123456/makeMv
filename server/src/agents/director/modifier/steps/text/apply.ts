/**
 * agents/director/modifier/steps/text/apply.ts
 * 文本轨第 3 段：两阶段原子提交
 *
 * 全部补丁命中 + 全部 JSON.parse 通过，才允许进入 commit 写盘。
 * 文本轨尤其不能半写：故事圣经改成 45 岁、剧本还写着 28 岁，比不改更糟。
 */

import { applyJsonStringPatchesAtomic } from '../../../../../utils/universal-patch.js';
import type { PhaseReporter } from '../../spec.js';
import { TEXT_FILES } from './files.js';
import type { TextApplied, TextLoadState, TextPlan } from './types.js';

export async function applyTextPatches(
  state: TextLoadState,
  plan: TextPlan,
  _ctx: any,
  report: PhaseReporter
): Promise<TextApplied> {
  const patches = plan?.patches || [];
  if (!patches.length) throw new Error('微调管线状态异常：补丁清单为空');

  report(78, '校验并应用补丁…');

  const fileMap = new Map(state.files.map((f) => [f.relPath, f]));
  const byFile = new Map<string, Array<{ search: string; replace: string }>>();

  for (const patch of patches) {
    const fileName = patch.file as string;
    if (!fileMap.has(fileName)) {
      throw new Error(`补丁指向未参与本次修改的文件: ${fileName}`);
    }
    if (!byFile.has(fileName)) byFile.set(fileName, []);
    byFile.get(fileName)!.push({ search: patch.search, replace: patch.replace });
  }

  const groups = Array.from(byFile.entries()).map(([fileName, list]) => ({
    fileName,
    filePath: fileMap.get(fileName)!.jsonPath,
    patches: list,
  }));

  const applyRes = applyJsonStringPatchesAtomic(groups);
  if (!applyRes.success) {
    throw new Error(applyRes.error || '跨文件字符串补丁校验未通过，已整体拦截落盘');
  }

  const updated = applyRes.files.map((r) => {
    const fileState = fileMap.get(r.fileName)!;
    const fileSpec = TEXT_FILES.find((f) => f.key === fileState.key);
    if (!fileSpec) throw new Error(`文件规格缺失: ${fileState.key}`);
    fileSpec.normalize?.(r.updatedObject);
    return {
      key: fileState.key,
      stage: fileState.stage,
      title: fileState.title,
      artifactSkill: fileState.artifactSkill,
      artifact: r.updatedObject,
      appliedCount: r.appliedCount,
    };
  });

  report(88, `原子校验通过：${updated.map((u) => `${u.title} ${u.appliedCount} 处`).join('、')}`);
  console.log(
    `[ModifierPipeline] 文本轨原子落地完成: ${updated
      .map((u) => `${u.title} ${u.appliedCount} 处`)
      .join('、')}`
  );

  return {
    updated,
    summary: plan.summary || `成功应用 ${patches.length} 处补丁`,
  };
}
