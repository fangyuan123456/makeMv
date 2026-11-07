/**
 * agents/director/modifier/steps/text/files.ts
 * 文本产物文件注册表 (Text Files Registry)
 *
 * 文本轨不再是「一个工序一个规格」，而是「一个修改器 + 若干文件规格」。
 * 原因：故事圣经 → 分场剧本 → 分镜是一条语义链，一次修改常常横跨多个产物；
 * 按工序切会把一次连贯的改动拆成三次互不知情的调用，改完还把下游当过期资产删掉。
 *
 * 每个文件规格只声明四件事：
 *   - 它是谁（key / stage / title / 磁盘路径 / 生产者标识）
 *   - 它的骨架索引（probe：角色、场次、镜号等主键清单，供跨文件引用定位）
 *   - 补丁落地后的派生字段重算（normalize）
 *   - 落盘与聚合根同步（exportToDisk / commitExtras）
 *
 * 不声明任何「怎么生成」的信息——修改轨只看内容，不看流水线。
 */

import { WorkflowStage } from '../../../../../types/index.js';
import { ProjectStore } from '../../../../../project-store/ProjectStore.js';
import {
  type StoryBibleArtifact,
  STORY_BIBLE_JSON_PATH,
  exportStoryBibleToDisk,
} from '../../../../../artifacts/story-bible.js';
import {
  type SceneScriptArtifact,
  SCENE_SCRIPT_JSON_PATH,
  exportSceneScriptToDisk,
} from '../../../../../artifacts/scene-script.js';
import {
  type StoryboardArtifact,
  STORYBOARD_JSON_PATH,
  calculateTotalDurationSec,
  exportStoryboardToDisk,
} from '../../../../../artifacts/storyboard.js';
import type { TextFileSpec } from '../../spec.js';

/**
 * 故事圣经：全剧设定源（角色小传、黄金骨架、网状剧情节点）
 */
const storyBibleFile: TextFileSpec<StoryBibleArtifact> = {
  key: 'story-bible',
  stage: WorkflowStage.NARRATIVE_DESIGN,
  title: '故事圣经',
  jsonPath: STORY_BIBLE_JSON_PATH,
  artifactSkill: 'story-bible-generator',
  probe: (a) =>
    `《${a.title}》｜影调：${a.style}` +
    `｜角色：${(a.characters || []).map((c) => `${c.name}(${c.role})`).join('、')}` +
    `｜幕：${(a.goldenSpine || []).map((s) => s.name).join('→')}` +
    `｜节点：${(a.storyGraph?.nodes || []).map((n) => `${n.id}:${n.title}`).join('、')}`,
  commitExtras: (projectId, artifact) => {
    // 聚合根需同步标题（聚合根与产物一致性，与生成轨共用同一口径）
    const store = ProjectStore.getInstance();
    const project = store.getProject(projectId);
    if (!project) return;
    project.title = artifact.title || project.title;
    if (!project.stageArtifacts) project.stageArtifacts = {};
    project.stageArtifacts[WorkflowStage.NARRATIVE_DESIGN] = artifact;
    store.saveProject(project);
  },
  exportToDisk: (projectId, artifact) =>
    exportStoryBibleToDisk(projectId, artifact, ProjectStore.getInstance()),
};

/**
 * 分场文学剧本：把剧情节点铺成可拍摄的场次与对白
 */
const sceneScriptFile: TextFileSpec<SceneScriptArtifact> = {
  key: 'scene-script',
  stage: WorkflowStage.SCENE_SCRIPT,
  title: '分场剧本',
  jsonPath: SCENE_SCRIPT_JSON_PATH,
  artifactSkill: 'scene-script-generator',
  probe: (a) => {
    const scenes = a.scenes || [];
    const speakers = Array.from(
      new Set(scenes.flatMap((sc) => (sc.dialogues || []).map((d) => d.speaker)))
    );
    return (
      `共 ${scenes.length} 场｜` +
      scenes.map((sc) => `${sc.nodeId}:${sc.sceneTitle}`).join('、') +
      `｜说话角色：${speakers.join('、')}`
    );
  },
  normalize: (artifact) => {
    artifact.totalScenes = artifact.scenes?.length || 0;
  },
  exportToDisk: (projectId, artifact) => exportSceneScriptToDisk(projectId, artifact),
};

/**
 * 视听分镜：把场次拆成镜头级执行清单（景别 / 运镜 / 时长 / 画面描述）
 */
const storyboardFile: TextFileSpec<StoryboardArtifact> = {
  key: 'storyboard',
  stage: WorkflowStage.STORYBOARD,
  title: '视听分镜',
  jsonPath: STORYBOARD_JSON_PATH,
  artifactSkill: 'storyboard-generator',
  probe: (a) =>
    `共 ${a.shots?.length ?? 0} 镜｜` +
    (a.shots || []).map((s) => `${s.shotId}/${s.shotScale}/${s.durationSec}s`).join('、'),
  normalize: (artifact) => {
    artifact.totalShots = artifact.shots?.length || 0;
    artifact.estimatedTotalDurationSec = calculateTotalDurationSec(artifact.shots || []);
  },
  exportToDisk: (projectId, artifact) => exportStoryboardToDisk(projectId, artifact),
};

/**
 * 文件清单顺序即 prompt 中的阅读顺序：上游 → 下游
 */
export const TEXT_FILES: TextFileSpec<any>[] = [
  storyBibleFile,
  sceneScriptFile,
  storyboardFile,
];

/** 按工序键取文件规格 */
export function getTextFileBySkill(skillKey: string): TextFileSpec<any> | undefined {
  return TEXT_FILES.find((f) => f.key === skillKey);
}
