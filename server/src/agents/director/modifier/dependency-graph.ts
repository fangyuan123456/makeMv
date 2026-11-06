/**
 * agents/director/modifier/dependency-graph.ts
 * 影视工序资产因果依赖图与脏标记波及解析器 (Asset Dependency Graph SSOT)
 * 
 * 核心架构特性：
 * 1. 静态因果拓扑矩阵：确立 8 大工序之间不可逆向倒流的法定因果依赖链条；
 * 2. 动态截断防护：根据项目当前最高推进阶段 (currentStage)，严格过滤未解锁的未来工序；
 * 3. 实体级脏镜头过滤 (Dirty Invalidation)：精准反查分镜表中出场特定角色的 Shot 列表，未受影响镜头 100% 资产保全。
 */

import { ProjectStore } from '../../../project-store/ProjectStore.js';
import { WorkflowStage, STAGE_SEQUENCE } from '../../../types/index.js';
import { STAGE_OF_SKILL } from '../generator/constants.js';

/**
 * 影视工序不可逆因果静态依赖矩阵 (Dependency Matrix SSOT)
 */
export const ASSET_DEPENDENCY_MATRIX: Record<string, string[]> = {
  'story-bible': [
    'story-bible',
    'character-portrait',
    'scene-script',
    'storyboard',
    'keyframe-reference',
    'video-production',
  ],
  'character-portrait': [
    'character-portrait',
    'storyboard',
    'keyframe-reference',
    'video-production',
  ],
  'scene-script': [
    'scene-script',
    'storyboard',
    'keyframe-reference',
    'video-production',
  ],
  'storyboard': [
    'storyboard',
    'keyframe-reference',
    'video-production',
  ],
  'keyframe-reference': [
    'keyframe-reference',
    'video-production',
  ],
  'video-production': [
    'video-production',
  ],
  'critic-review': [
    'critic-review',
  ],
  'fmv-packaging': [
    'fmv-packaging',
  ],
};

/**
 * 结合当前项目推进阶段，动态计算并截断得出真实的受影响工序清单
 */
export function resolveAffectedSteps(
  projectId: string,
  rootSkill: string,
  targetEntity?: string
): string[] {
  const fullChain = ASSET_DEPENDENCY_MATRIX[rootSkill] || [rootSkill];
  const store = ProjectStore.getInstance();
  const project = store.getProject(projectId);
  if (!project || !project.currentStage) {
    return [rootSkill];
  }

  const currentOrder = STAGE_SEQUENCE.indexOf(project.currentStage as WorkflowStage);
  if (currentOrder < 0) {
    return [rootSkill];
  }

  // 严格过滤掉当前项目推进阶段尚未到达的未来工序
  return fullChain.filter((skill) => {
    const stage = STAGE_OF_SKILL[skill];
    if (!stage) return false;
    const stageOrder = STAGE_SEQUENCE.indexOf(stage as WorkflowStage);
    return stageOrder >= 0 && stageOrder <= currentOrder;
  });
}

/**
 * 精准反查分镜黑板：检索哪些分镜镜头涉及指定实体（如角色阿诺出场）
 * 返回需要定向重绘的 Dirty Shot ID 列表
 */
export function findDirtyShotsForEntity(
  projectId: string,
  entityName?: string
): string[] {
  if (!entityName || !entityName.trim()) {
    return [];
  }

  const store = ProjectStore.getInstance();
  const target = entityName.trim().toLowerCase();
  const sbArtifact = store.getArtifact<any>(projectId, WorkflowStage.STORYBOARD);
  if (!sbArtifact || !Array.isArray(sbArtifact.shots)) {
    return [];
  }

  const dirtyShotIds: string[] = [];
  for (const shot of sbArtifact.shots) {
    const shotId = shot.shotId || shot.id || '';
    const visualText = (shot.visualComposition || shot.subjectMotion || '').toLowerCase();
    const characters = Array.isArray(shot.characterNames)
      ? shot.characterNames.map((c: any) => String(c).toLowerCase())
      : [];

    const isMatch =
      characters.some((c: string) => c.includes(target) || target.includes(c)) ||
      visualText.includes(target);

    if (isMatch && shotId && !dirtyShotIds.includes(shotId)) {
      dirtyShotIds.push(shotId);
    }
  }

  // 跨工序校验：若 storyboard 未完全命中，但 keyframe_reference 存在该角色的主体外观记录，追加 dirty 标记
  const kfArtifact = store.getArtifact<any>(projectId, WorkflowStage.KEYFRAME_REFERENCE);
  if (kfArtifact && Array.isArray(kfArtifact.shots)) {
    for (const kf of kfArtifact.shots) {
      const shotId = kf.shotId || kf.id || '';
      const prompt = (kf.prompt || '').toLowerCase();
      const appearance = (kf.subjectAppearance || '').toLowerCase();
      if ((prompt.includes(target) || appearance.includes(target)) && shotId && !dirtyShotIds.includes(shotId)) {
        dirtyShotIds.push(shotId);
      }
    }
  }

  return dirtyShotIds;
}
