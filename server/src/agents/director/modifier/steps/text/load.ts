/**
 * agents/director/modifier/steps/text/load.ts
 * 文本轨第 1 段：读取底稿并定位改动目标
 *
 * 刻意「读全部」而不是只读目标文件：文本三件套是一条语义链，
 * 只给一份原文，模型无法判断这次改动是否需要同步其它文件，
 * 结果就是改一处、另外两处变成互相矛盾的过期资产。
 */

import fs from 'fs';
import path from 'path';
import { ProjectStore } from '../../../../../project-store/ProjectStore.js';
import { extractTargetSkill, extractUserFeedback, type PhaseReporter } from '../../spec.js';
import { TEXT_FILES } from './files.js';
import type { TextFileState, TextLoadState } from './types.js';

export async function loadTextState(ctx: any, report: PhaseReporter): Promise<TextLoadState> {
  const userFeedback = extractUserFeedback(ctx);
  if (!userFeedback) {
    throw new Error('未提供有效的修改指令，无法执行定向微调');
  }

  const store = ProjectStore.getInstance();
  const projectId = ctx.projectId;
  const projectDir = store.getProjectDir(projectId);

  report(12, '读取文本产物…');

  const files: TextFileState[] = [];
  for (const fileSpec of TEXT_FILES) {
    const artifact = store.getArtifact<any>(projectId, fileSpec.stage);
    if (!artifact) continue;

    const absPath = path.join(projectDir, fileSpec.jsonPath);
    if (!fs.existsSync(absPath)) {
      // 聚合根有产物但磁盘缺少底稿：跳过该文件，不阻塞其它文件的修改
      console.warn(
        `[ModifierPipeline] ${fileSpec.title} 磁盘底稿缺失，本次不参与修改: ${fileSpec.jsonPath}`
      );
      continue;
    }

    files.push({
      key: fileSpec.key,
      stage: fileSpec.stage,
      title: fileSpec.title,
      relPath: fileSpec.jsonPath,
      jsonPath: absPath,
      artifactSkill: fileSpec.artifactSkill,
      content: fs.readFileSync(absPath, 'utf-8'),
      probe: fileSpec.probe(artifact),
      artifact,
    });
  }

  if (files.length === 0) {
    throw new Error(`项目 [${projectId}] 下还没有任何已落盘的文本产物，无法执行内容修改`);
  }

  const skillKey = extractTargetSkill(ctx);
  const primary = files.find((f) => f.key === skillKey) || files[files.length - 1];

  report(20, `已载入 ${files.length} 份文本产物`);
  console.log(
    `[ModifierPipeline] 文本轨载入 ${files.length} 份产物（${files
      .map((f) => f.title)
      .join('、')}），主命中：${primary.title}`
  );

  return { files, primaryFileKey: primary.key, userFeedback };
}
