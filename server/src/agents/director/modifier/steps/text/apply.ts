/**
 * agents/director/modifier/steps/text/apply.ts
 * 文本轨第 3 段：两阶段原子提交
 *
 * 全部补丁命中 + 全部 JSON.parse 通过，才允许进入 commit 写盘。
 * 文本轨尤其不能半写：故事圣经改成 45 岁、剧本还写着 28 岁，比不改更糟。
 */

import { applyJsonStringPatchesAtomic } from '../../../../../utils/universal-patch.js';
import { atomicWriteStringSync } from '../../../../../utils/atomicFile.js';
import type { PhaseReporter } from '../../spec.js';
import {
  blockingIssues,
  checkArtifactInvariants,
  summarizeIssues,
  type InvariantFile,
} from '../../invariants.js';
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
  const byFile = new Map<
    string,
    Array<{ search: string; replace: string; scope?: 'unique' | 'all' }>
  >();

  for (const patch of patches) {
    const fileName = patch.file as string;
    if (!fileMap.has(fileName)) {
      throw new Error(`补丁指向未参与本次修改的文件: ${fileName}`);
    }
    if (!byFile.has(fileName)) byFile.set(fileName, []);
    byFile
      .get(fileName)!
      .push({ search: patch.search, replace: patch.replace, scope: patch.scope });
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

  report(85, '校验设定一致性…');

  /*
   * 语义不变量校验：JSON 合法 ≠ 故事成立。
   *
   * 基线取磁盘原文（聚合根可能与磁盘不同步），改后视图 = 基线 + 本次补丁结果。
   * 传基线是为了区分「本次改出来的」与「项目里本来就有的」：
   * 后者只报警告，否则历史脏数据会把每一次修改都挡住。
   */
  const updatedByKey = new Map(updated.map((u) => [u.key, u]));
  const baselineOf = (f: (typeof state.files)[number]) => {
    try {
      return JSON.parse(f.content);
    } catch {
      return f.artifact;
    }
  };

  const baselineView: InvariantFile[] = state.files.map((f) => ({
    key: f.key,
    title: f.title,
    artifact: baselineOf(f),
  }));
  const view: InvariantFile[] = baselineView.map((f) => {
    const changed = updatedByKey.get(f.key);
    return changed ? { ...f, artifact: changed.artifact } : f;
  });

  const issues = checkArtifactInvariants(view, {
    strictKeys: updated.map((u) => u.key),
    baselineFiles: baselineView,
  });
  const blockers = blockingIssues(issues);

  if (blockers.length > 0) {
    /*
     * 补丁在 applyJsonStringPatchesAtomic 里已写入磁盘，语义校验失败必须按原文回滚，
     * 否则会留下「语法合法、故事错乱」的产物——这正是最难被发现的一类损坏。
     */
    const rolledBack: string[] = [];
    for (const f of state.files) {
      try {
        atomicWriteStringSync(f.jsonPath, f.content);
        rolledBack.push(f.title);
      } catch (rollbackErr: any) {
        console.error(`[ModifierPipeline] 语义回滚失败 ${f.title}: ${rollbackErr.message}`);
      }
    }
    console.warn(
      `[ModifierPipeline] 语义校验未通过（${blockers.length} 处），已回滚: ${rolledBack.join('、')}`
    );
    throw new Error(`${summarizeIssues(blockers)}\n已整体回滚，本次未修改任何产物。`);
  }

  const warnings = issues.filter((i) => i.level === 'warning');
  if (warnings.length > 0) {
    console.warn(
      `[ModifierPipeline] 语义提示 ${warnings.length} 处（历史遗留，不阻断）: ${warnings
        .map((w) => w.message)
        .join('；')}`
    );
  }

  report(88, `原子校验通过：${updated.map((u) => `${u.title} ${u.appliedCount} 处`).join('、')}`);
  console.log(
    `[ModifierPipeline] 文本轨原子落地完成: ${updated
      .map((u) => `${u.title} ${u.appliedCount} 处`)
      .join('、')}`
  );

  const baseSummary = plan.summary || `成功应用 ${patches.length} 处补丁`;
  return {
    updated,
    summary:
      warnings.length > 0
        ? `${baseSummary}（另有 ${warnings.length} 处设定提示待确认，详见服务端日志）`
        : baseSummary,
  };
}
