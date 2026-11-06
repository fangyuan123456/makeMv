/**
 * agents/pipeline/workflows/steps/storyboard/exporter.ts
 * 视听分镜头表磁盘持久化与 Markdown 导演台账导出器 (Storyboard Exporter SSOT)
 */

import fs from 'fs';
import path from 'path';
import { ProjectStore } from '../../../../../project-store/ProjectStore.js';
import { atomicWriteJsonSync, atomicWriteStringSync } from '../../../../../utils/atomicFile.js';
import type { StoryboardArtifact } from './schema.js';

export function exportStoryboardToDisk(projectId: string, artifact: StoryboardArtifact): { jsonPath: string; mdPath: string } {
  const store = ProjectStore.getInstance();
  const projectDir = store.getProjectDir(projectId);
  const sbDir = path.join(projectDir, 'storyboard');
  if (!fs.existsSync(sbDir)) {
    fs.mkdirSync(sbDir, { recursive: true });
  }

  // 1. JSON 物理数据持久化
  const jsonPath = path.join(sbDir, 'storyboard.json');
  atomicWriteJsonSync(jsonPath, artifact);

  // 2. 导演分镜台账 Markdown 表格导出
  const mdLines: string[] = [
    `# 《${artifact.title}》视听分镜头导演台账 (Storyboard Sheet)`,
    ``,
    `> **分镜头总数**: ${artifact.totalShots} 镜  `,
    `> **预估总时长**: ${artifact.estimatedTotalDurationSec} 秒 (约 ${(artifact.estimatedTotalDurationSec / 60).toFixed(1)} 分钟)  `,
    `> **生成时间**: ${artifact.createdAt}  `,
    ``,
    `---`,
    ``,
    `| 镜号 | 关联节点 | 景别 | 摄影机运动 | 建议时长 | 画面视听描述 |`,
    `| :--- | :--- | :--- | :--- | :--- | :--- |`,
  ];

  for (const shot of artifact.shots) {
    const desc = (shot.visualComposition || '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
    mdLines.push(
      `| \`${shot.shotId}\` | \`${shot.nodeId}\` | **${shot.shotScale}** | ${shot.cameraMovement} | ${shot.durationSec}s | ${desc} |`
    );
  }

  const mdPath = path.join(sbDir, 'storyboard.md');
  atomicWriteStringSync(mdPath, mdLines.join('\n'));

  return { jsonPath, mdPath };
}
