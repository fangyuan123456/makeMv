/**
 * artifacts/scene-script.ts
 * 分场剧本 —— 产物契约层 (Artifact Contract)
 *
 * 依赖方向：modifier → artifacts ← generator
 */

import fs from 'fs';
import path from 'path';
import { ProjectStore } from '../project-store/ProjectStore.js';
import { atomicWriteJsonSync, atomicWriteStringSync } from '../utils/atomicFile.js';
import type { SceneScriptArtifact } from '../agents/director/generator/steps/scene-script/schema.js';

export type { SceneScriptArtifact };

/** 产物物理路径（相对项目根目录）—— 注意是复数 scene_scripts */
export const SCENE_SCRIPT_JSON_PATH = 'script/scene_scripts.json';

export function exportSceneScriptToDisk(
  projectId: string,
  artifact: SceneScriptArtifact
): { jsonPath: string; mdPath: string } {
  const store = ProjectStore.getInstance();
  const projectDir = store.getProjectDir(projectId);
  const scriptDir = path.join(projectDir, 'script');
  if (!fs.existsSync(scriptDir)) {
    fs.mkdirSync(scriptDir, { recursive: true });
  }

  // 1. JSON 物理数据持久化
  const jsonPath = path.join(scriptDir, 'scene_scripts.json');
  atomicWriteJsonSync(jsonPath, artifact);

  // 2. 工业级排版剧本文档 Markdown 导出
  const mdLines: string[] = [
    `# 《${artifact.title}》分场影视剧本 (Scene Scripts)`,
    ``,
    `> **总场次数**: ${artifact.totalScenes || artifact.scenes.length} 场  `,
    `> **导出时间**: ${artifact.createdAt}  `,
    ``,
    `---`,
    ``,
  ];

  for (let i = 0; i < artifact.scenes.length; i++) {
    const scene = artifact.scenes[i];
    mdLines.push(`## 第 ${scene.act} 幕 · 场次 ${i + 1}：${scene.sceneTitle}`);
    mdLines.push(`* **关联节点**: \`${scene.nodeId}\``);
    mdLines.push(`* **场景空间**: ${scene.location} | ${scene.timeOfDay || '日景'}`);
    if (scene.interactionMoment) {
      mdLines.push(`* **关键互动时刻**: ${scene.interactionMoment}`);
    }
    mdLines.push(``);
    mdLines.push(`### 【动作与情境概述】`);
    mdLines.push(`${scene.actionSummary}`);
    mdLines.push(``);

    if (Array.isArray(scene.dialogues) && scene.dialogues.length > 0) {
      mdLines.push(`### 【角色台词交锋】`);
      for (const d of scene.dialogues) {
        const ext = d.parenthetical ? `（${d.parenthetical}）` : '';
        mdLines.push(`**${d.speaker}**${ext}：${d.line}`);
      }
      mdLines.push(``);
    }
    mdLines.push(`---`);
    mdLines.push(``);
  }

  const mdPath = path.join(scriptDir, 'scene_scripts.md');
  atomicWriteStringSync(mdPath, mdLines.join('\n'));

  return { jsonPath, mdPath };
}
