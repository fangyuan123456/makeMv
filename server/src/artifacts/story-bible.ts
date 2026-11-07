/**
 * artifacts/story-bible.ts
 * 故事世界观圣经 —— 产物契约层 (Artifact Contract)
 *
 * 定位：生成轨（generator）与修改轨（modifier）共同向下依赖的产物契约。
 * 两条路线互不引用，只共享「这个产物长什么样、怎么落盘」。
 *
 * 依赖方向：modifier → artifacts ← generator
 */

import fs from 'fs';
import path from 'path';
import type { IProjectStateStore } from '../project-store/IProjectStateStore.js';
import { atomicWriteJsonSync, atomicWriteStringSync } from '../utils/atomicFile.js';
import type { StoryBibleArtifact } from '../agents/director/generator/steps/story-bible/schema.js';

export type { StoryBibleArtifact };

/** 产物物理路径（相对项目根目录），生成与修改共用同一份真相 */
export const STORY_BIBLE_JSON_PATH = 'narrative/story_bible.json';

export function exportStoryBibleToDisk(
  projectId: string,
  artifact: StoryBibleArtifact,
  projectStore: IProjectStateStore
): { jsonPath: string; mdPath: string } {
  const projectDir = projectStore.getProjectDir(projectId);
  const narrativeDir = path.join(projectDir, 'narrative');
  if (!fs.existsSync(narrativeDir)) {
    fs.mkdirSync(narrativeDir, { recursive: true });
  }

  // 1. JSON 物理文件导出 (使用系统级原子写入)
  const jsonPath = path.join(narrativeDir, 'story_bible.json');
  atomicWriteJsonSync(jsonPath, artifact);

  // 2. Markdown 排版文档导出
  const mdContent = `# 《${artifact.title}》故事世界观圣经 (Story Bible)

> **视觉影调风格**: ${artifact.style}  
> **核心哲学立意**: ${artifact.theme}  
> **生成时间**: ${artifact.createdAt}

---

## 一句话大纲 (Logline)
${artifact.logline}

---

## 核心商业看点与卖点 (Selling Points)
${(artifact.sellingPoints || []).map((s) => `- ${s}`).join('\n')}

---

## 黄金戏剧骨架 (Three-Act Spine)
${(artifact.goldenSpine || [])
  .map(
    (act) => `### 第 ${act.act} 幕：${act.name}
${act.summary}
* **建议时长**: ${act.targetDurationSec || 60}秒
* **悬念断点**: ${act.cliffhanger || '无'}
`
  )
  .join('\n')}

---

## 核心分支抉择点矩阵 (Pivot Points)
${(artifact.pivotPoints?.macroPivotPoints || [])
  .map(
    (pivot) => `### 抉择时刻 [第 ${pivot.act} 幕]：${pivot.decisionMoment}
${(pivot.choices || []).map((c) => `* **选项 [${c.choiceId}] ${c.text}**: ${c.dramaticImpact}`).join('\n')}
`
  )
  .join('\n')}

---

## 核心登场角色档案 (Character Profiles)
${(artifact.characters || [])
  .map(
    (c) => `### ${c.name} (${c.role})
* **视觉外貌**: ${c.appearance}
* **性格特质**: ${c.personality}
* **欲望动机**: ${c.motivation}
`
  )
  .join('\n')}

---

## 网状剧情有向图拓扑概览 (Story Graph DAG)
* **根起点**: ${artifact.storyGraph?.rootNodeId || 'root'}
* **剧情节点总数**: ${artifact.storyGraph?.nodes?.length || 0} 个
* **可能终局结局数**: ${artifact.storyGraph?.endingsCount || 0} 个
`;

  const mdPath = path.join(narrativeDir, 'story_bible.md');
  atomicWriteStringSync(mdPath, mdContent);

  return { jsonPath, mdPath };
}
