/**
 * agents/director/modifier/entity-resolver.ts
 * 目标资产实体反查阶段工序解析器 (Entity-to-Skill Resolver SSOT)
 * 
 * 核心架构特性（法典 0.4 源头求真第一法则）：
 * 1. 优先且绝对采纳大模型在 <intent skill="..." /> 中显式吐出的法定工序（源头契约第一法则，0 猜测）；
 * 2. 缺失显式 skill 时，仅比对黑板真实实体的规范属性（角色名/身份、场次ID、分镜镜头ID、剧情幕名）；
 * 3. 彻底消灭一切关键词死字典与模糊语义硬编码。
 */

import { ProjectStore } from '../../../project-store/ProjectStore.js';
import { WorkflowStage } from '../../../types/index.js';
import { DERIVED_SKILL_OF_STAGE } from '../catalog.js';

export function resolveTargetToSkill(
  projectId: string,
  targetEntity?: string,
  currentStage?: WorkflowStage,
  explicitSkill?: string
): string {
  // 1. 🌟 第一道防线（源头求真）：若上游大模型已显式给出法定 skill，直接采用，零猜测零损耗
  if (explicitSkill && explicitSkill.trim()) {
    return explicitSkill.trim();
  }

  if (!targetEntity || !targetEntity.trim()) {
    return (currentStage && DERIVED_SKILL_OF_STAGE[currentStage]) || 'story-bible';
  }

  const target = targetEntity.trim().toLowerCase();
  const store = ProjectStore.getInstance();
  const project = store.getProject(projectId);
  if (!project) {
    return (currentStage && DERIVED_SKILL_OF_STAGE[currentStage]) || 'story-bible';
  }

  const artifacts = project.stageArtifacts || {};

  // 2. 🌟 第二道防线：黑板真实实体标准属性比对 (0 词表死字典，纯粹基于黑板事实)
  // 2.1 角色库比对 (name, id, role)
  const charArt = artifacts[WorkflowStage.CHARACTER_DESIGN] || artifacts[WorkflowStage.NARRATIVE_DESIGN];
  if (charArt && Array.isArray(charArt.characters)) {
    const matched = charArt.characters.some((c: any) => {
      const name = (c.name || '').toLowerCase();
      const id = (c.id || '').toLowerCase();
      const role = (c.role || '').toLowerCase();
      return name === target || id === target || role === target ||
             (name && (target.includes(name) || name.includes(target))) ||
             (role && (target.includes(role) || role.includes(target)));
    });
    if (matched) {
      // 若当前尚处于第一阶段故事圣经 (NARRATIVE_DESIGN)，角色设定属于大纲范畴，修改目标归属 story-bible；
      // 若已进入角色定妆及后续阶段，角色微调归属专业定妆工序 character-portrait
      if (currentStage === WorkflowStage.NARRATIVE_DESIGN) {
        return 'story-bible';
      }
      return 'character-portrait';
    }
  }

  // 2.2 剧本真实场次库比对 (sceneId, title)
  const scriptArt = artifacts[WorkflowStage.SCENE_SCRIPT];
  if (scriptArt && Array.isArray(scriptArt.scenes)) {
    const matched = scriptArt.scenes.some((sc: any) => {
      const sceneId = (sc.sceneId || '').toLowerCase();
      const title = (sc.title || '').toLowerCase();
      return sceneId === target || title === target ||
             (sceneId && (target.includes(sceneId) || sceneId.includes(target))) ||
             (title && (target.includes(title) || title.includes(target)));
    });
    if (matched) return 'scene-script';
  }

  // 2.3 分镜真实镜头库比对 (shotId)
  const sbArt = artifacts[WorkflowStage.STORYBOARD];
  if (sbArt && Array.isArray(sbArt.shots)) {
    const matched = sbArt.shots.some((s: any) => {
      const shotId = (s.shotId || '').toLowerCase();
      return shotId === target || (shotId && (target.includes(shotId) || shotId.includes(target)));
    });
    if (matched) {
      if (currentStage === WorkflowStage.VIDEO_PRODUCTION) return 'video-production';
      if (currentStage === WorkflowStage.KEYFRAME_REFERENCE) return 'keyframe-reference';
      return 'storyboard';
    }
  }

  // 2.4 故事圣经黄金戏剧骨架比对 (goldenSpine.name)
  const bibleArt = artifacts[WorkflowStage.NARRATIVE_DESIGN];
  if (bibleArt && Array.isArray(bibleArt.goldenSpine)) {
    const matched = bibleArt.goldenSpine.some((act: any) => {
      const actName = (act.name || '').toLowerCase();
      return actName === target || (actName && (target.includes(actName) || actName.includes(target)));
    });
    if (matched) return 'story-bible';
  }

  // 3. 最终安全兜底：当前阶段对应的法定工序
  return (currentStage && DERIVED_SKILL_OF_STAGE[currentStage]) || 'story-bible';
}
