/**
 * agents/director/modifier/cascade-executor.ts
 * 影视因果依赖级联自愈执行器 (Cascade Ripple Self-Healing Engine SSOT)
 * 
 * 核心机制（法典 0.4 单一事实来源与源头求真）：
 * 1. 统一委托 StepManifest.modifier：根工序与下游各工序统一走标准修改契约，0 业务伪工具套娃；
 * 2. 补齐下游完整链路：支持故事圣经向下波及角色定妆与分场剧本，矩阵与执行器 100% 对齐；
 * 3. 真实战果与 Fail-Fast：严格基于 executedSteps 汇报真实战果，脏镜头全部生成失败时刚性阻断，杜绝吞错假收敛；
 * 4. 防提示词污染：正则替换历史定妆标记，消除多轮追加叠层污染。
 */

import type { LLMService } from '../../../llm/LLMService.js';
import { ProjectStore } from '../../../project-store/ProjectStore.js';
import { WorkflowStage } from '../../../types/index.js';
import { STAGE_OF_SKILL, getStepManifest } from '../generator/constants.js';
import { resolveAffectedSteps, findDirtyShotsForEntity } from './dependency-graph.js';
import type { StoryboardArtifact } from '../generator/steps/storyboard/schema.js';
import type { CharacterPortraitArtifact } from '../generator/steps/character-portrait/schema.js';

export interface CascadeRevisionOptions {
  projectId: string;
  sessionId?: string;
  rootSkill: string;
  target?: string;
  userFeedback: string;
  affectedSteps?: string[];
  llm: LLMService;
  isMock?: boolean;
}

export interface CascadeRevisionResult {
  success: boolean;
  rootSkill: string;
  executedSteps: string[];
  dirtyShotIds: string[];
  data?: any;
  summary: string;
  error?: string;
}

/**
 * 执行因果级联精修自愈流水线
 */
export async function executeCascadeRevision(
  options: CascadeRevisionOptions
): Promise<CascadeRevisionResult> {
  const {
    projectId,
    rootSkill,
    target,
    userFeedback,
    llm,
    isMock = false,
  } = options;

  const store = ProjectStore.getInstance();
  const project = store.getProject(projectId);
  if (!project) {
    return {
      success: false,
      rootSkill,
      executedSteps: [],
      dirtyShotIds: [],
      summary: '',
      error: `未找到项目 [${projectId}]`,
    };
  }

  // 1. 动态拓扑解析受影响工序清单 (严格截断至当前项目已推进阶段)
  const effectiveAffectedSteps =
    Array.isArray(options.affectedSteps) && options.affectedSteps.length > 0
      ? options.affectedSteps
      : resolveAffectedSteps(projectId, rootSkill, target);

  const executedSteps: string[] = [rootSkill];
  let rootResultData: any = undefined;
  let rootSummary = '';

  console.log(`[cascade-executor] 启动级联精修自愈: 源头 [${rootSkill}] ➔ 波及工序 [${effectiveAffectedSteps.join(', ')}]`);

  // 2. 第一站：执行源头根工序修改 (统一委托 StepManifest.modifier)
  const rootManifest = getStepManifest(rootSkill);
  if (!rootManifest?.modifier) {
    return {
      success: false,
      rootSkill,
      executedSteps: [],
      dirtyShotIds: [],
      summary: '',
      error: `工序 [${rootSkill}] 未声明修改器 (modifier)`,
    };
  }

  const rootRes = await rootManifest.modifier({
    projectId,
    userFeedback,
    llm,
    target,
    payload: { isMock },
  });

  if (!rootRes.success) {
    return {
      success: false,
      rootSkill,
      executedSteps,
      dirtyShotIds: [],
      summary: '',
      error: rootRes.error || `${rootManifest.title} 微调失败`,
    };
  }

  rootResultData = rootRes.data;
  rootSummary = rootRes.summary || `${rootManifest.title} 靶向微调成功`;

  // 3. 计算需要局部级联的 Dirty 镜头列表
  const dirtyShotIds = findDirtyShotsForEntity(projectId, target);
  const downstreamSteps = effectiveAffectedSteps.filter((s) => s !== rootSkill);

  const kfFailed: string[] = [];
  const vpFailed: string[] = [];

  // 4. 顺向级联波及受影响的下游工序 (统一委托各工序 modifier)
  for (const stepKey of downstreamSteps) {
    const stepManifest = getStepManifest(stepKey);
    if (!stepManifest) continue;

    if (stepKey === 'character-portrait') {
      const charArt = store.getArtifact<any>(projectId, WorkflowStage.CHARACTER_DESIGN);
      if (charArt && Array.isArray(charArt.characters)) {
        let targetName = target;
        if (!targetName) {
          const matched = charArt.characters.find(
            (c: any) =>
              (c.name && userFeedback.includes(c.name)) ||
              (c.role && userFeedback.includes(c.role))
          );
          if (matched) targetName = matched.name;
        }
        if (targetName && stepManifest.modifier) {
          console.log(`[cascade-executor] 故事圣经修改波及角色定妆: [${targetName}]...`);
          try {
            const charRes = await stepManifest.modifier({
              projectId,
              userFeedback,
              llm,
              target: targetName,
              payload: { isMock },
            });
            if (charRes.success) {
              executedSteps.push(stepKey);
            }
          } catch (charErr) {
            console.warn(`[cascade-executor] 角色定妆 [${targetName}] 级联更新跳过:`, charErr);
          }
        }
      }
    } else if (stepKey === 'scene-script') {
      const scriptArt = store.getArtifact<any>(projectId, WorkflowStage.SCENE_SCRIPT);
      if (scriptArt && Array.isArray(scriptArt.scenes) && scriptArt.scenes.length > 0 && stepManifest.modifier) {
        console.log(`[cascade-executor] 故事圣经修改波及分场剧本，执行文学剧本情节同步...`);
        try {
          const scriptRes = await stepManifest.modifier({
            projectId,
            userFeedback,
            llm,
            target,
          });
          if (scriptRes.success) {
            executedSteps.push(stepKey);
          }
        } catch (scriptErr) {
          console.warn(`[cascade-executor] 分场剧本级联同步跳过:`, scriptErr);
        }
      }
    } else if (stepKey === 'storyboard') {
      const sbArtifact = store.getArtifact<StoryboardArtifact>(projectId, WorkflowStage.STORYBOARD);
      if (sbArtifact && Array.isArray(sbArtifact.shots) && target) {
        const charArtifact = store.getArtifact<CharacterPortraitArtifact>(
          projectId,
          WorkflowStage.CHARACTER_DESIGN
        );
        const matchedChar = charArtifact?.characters?.find(
          (c) =>
            (c.name && (c.name.toLowerCase() === target.toLowerCase() || c.name.includes(target) || target.includes(c.name))) ||
            (c.role && (c.role.toLowerCase() === target.toLowerCase() || c.role.includes(target) || target.includes(c.role)))
        );

        if (matchedChar) {
          let updatedShotsCount = 0;
          for (const shot of sbArtifact.shots) {
            const shotId = shot.shotId;
            if (dirtyShotIds.includes(shotId)) {
              // 正则消除历史 [定妆更新: ...] 避免无限追加叠层污染
              const cleanComp = (shot.visualComposition || '').replace(/\s*\[定妆更新:[^\]]*\]/g, '').trim();
              shot.visualComposition = `${cleanComp} [定妆更新: ${matchedChar.visualPrompt || matchedChar.appearance || ''}]`;
              updatedShotsCount++;
            }
          }
          if (updatedShotsCount > 0) {
            store.setArtifact(projectId, WorkflowStage.STORYBOARD, sbArtifact);
            console.log(`[cascade-executor] 成功同步 ${updatedShotsCount} 个受波及分镜的画面定妆描述`);
            executedSteps.push(stepKey);
          }
        }
      }
    } else if (stepKey === 'keyframe-reference') {
      const kfArtifact = store.getArtifact<any>(projectId, WorkflowStage.KEYFRAME_REFERENCE);
      if (kfArtifact && Array.isArray(kfArtifact.shots) && dirtyShotIds.length > 0 && stepManifest.modifier) {
        console.log(`[cascade-executor] 级联重绘关键帧 Dirty 镜头: [${dirtyShotIds.join(', ')}]...`);
        let kfSuccessCount = 0;
        for (const shotId of dirtyShotIds) {
          try {
            const res = await stepManifest.modifier({
              projectId,
              userFeedback,
              llm,
              target: shotId,
              payload: { isMock },
            });
            if (res.success) {
              kfSuccessCount++;
            } else {
              kfFailed.push(shotId);
            }
          } catch (kfErr) {
            console.warn(`[cascade-executor] 关键帧镜头 [${shotId}] 级联重绘跳过:`, kfErr);
            kfFailed.push(shotId);
          }
        }
        if (kfSuccessCount > 0) {
          executedSteps.push(stepKey);
        }
      }
    } else if (stepKey === 'video-production') {
      const vpArtifact = store.getArtifact<any>(projectId, WorkflowStage.VIDEO_PRODUCTION);
      if (vpArtifact && Array.isArray(vpArtifact.clips) && dirtyShotIds.length > 0 && stepManifest.modifier) {
        console.log(`[cascade-executor] 级联重新生成视频 Dirty 镜头: [${dirtyShotIds.join(', ')}]...`);
        let vpSuccessCount = 0;
        for (const shotId of dirtyShotIds) {
          try {
            const res = await stepManifest.modifier({
              projectId,
              userFeedback,
              llm,
              target: shotId,
              payload: { isMock },
            });
            if (res.success) {
              vpSuccessCount++;
            } else {
              vpFailed.push(shotId);
            }
          } catch (vpErr) {
            console.warn(`[cascade-executor] 视频切片 [${shotId}] 级联重做跳过:`, vpErr);
            vpFailed.push(shotId);
          }
        }
        if (vpSuccessCount > 0) {
          executedSteps.push(stepKey);
        }
      }
    }
  }

  // 刚性阻断检测 (Fail-Fast)：若存在 Dirty 镜头但重绘全军覆没，绝不隐式假收敛标成功
  const allKfFailed = dirtyShotIds.length > 0 && downstreamSteps.includes('keyframe-reference') && kfFailed.length === dirtyShotIds.length;
  const allVpFailed = dirtyShotIds.length > 0 && downstreamSteps.includes('video-production') && vpFailed.length === dirtyShotIds.length;
  if (allKfFailed || allVpFailed) {
    const failReason = allKfFailed ? `所有关键帧镜头 [${kfFailed.join(', ')}] 级联重绘均失败` : `所有视频切片 [${vpFailed.join(', ')}] 级联重新生成均失败`;
    return {
      success: false,
      rootSkill,
      executedSteps,
      dirtyShotIds,
      summary: `${rootSummary}，但级联下游执行失败: ${failReason}`,
      error: failReason,
    };
  }

  // 5. 级联重置受波及下游阶段的历史审查官旧门禁 (触发自愈复审)
  const currentProject = store.getProject(projectId);
  if (currentProject && currentProject.stageArtifacts) {
    for (const step of effectiveAffectedSteps) {
      const stage = STAGE_OF_SKILL[step];
      if (stage && currentProject.stageArtifacts[`critic_review_${stage}`]) {
        delete currentProject.stageArtifacts[`critic_review_${stage}`];
      }
    }
    store.saveProject(currentProject);
  }

  // 6. 真实战果总结：严格基于实际执行的 executedSteps 汇总，绝不谎报下游战果
  const actuallyUpdatedDownstream = executedSteps.filter((s) => s !== rootSkill);
  let rippleDesc = '';
  if (actuallyUpdatedDownstream.length > 0) {
    let shotsInfo = '';
    if (dirtyShotIds.length > 0) {
      shotsInfo = `（重绘镜头: ${dirtyShotIds.join(', ')}`;
      if (kfFailed.length > 0 || vpFailed.length > 0) {
        const fails = [...new Set([...kfFailed, ...vpFailed])];
        shotsInfo += `；失败镜头: ${fails.join(', ')}`;
      }
      shotsInfo += `）`;
    }
    rippleDesc = `，并顺向级联联动更新了下游工序 [${actuallyUpdatedDownstream.join(' ➔ ')}]${shotsInfo}。其余未受波及资产 100% 物理保持原状。`;
  } else {
    rippleDesc = '。下游未检测到受波及的重绘资产，保持原状。';
  }

  const finalSummary = `${rootSummary}${rippleDesc}`;

  return {
    success: true,
    rootSkill,
    executedSteps,
    dirtyShotIds,
    data: rootResultData,
    summary: finalSummary,
  };
}
