/**
 * agents/director/modifier/steps/image/keyframe-reference/spec.ts
 * 关键帧参考图微调规格 (Keyframe Reference Modifier Spec)
 *
 * image 型：定位镜头 → 重写关键帧提示词 → 重绘关键帧 → 替换条目并落盘
 */

import { WorkflowStage } from '../../../../../../types/index.js';
import { ProjectStore } from '../../../../../../project-store/ProjectStore.js';
import type {
  KeyframeReferenceArtifact,
  KeyframeItem,
  KeyframePromptMeta,
} from '../../../../../../artifacts/keyframe-reference.js';
import type { ModifierSpec, PhaseReporter } from '../../../spec.js';
import { extractUserFeedback } from '../../../spec.js';
import { refineKeyframePrompt, renderModifiedKeyframe } from './keyframe-reference.modifier.js';

interface KeyframeState {
  artifact: KeyframeReferenceArtifact;
  targetIndex: number;
  target: KeyframeItem;
}

interface KeyframePlan {
  finalPrompt: string;
  meta: KeyframePromptMeta;
}

export const keyframeReferenceSpec: ModifierSpec<KeyframeState, KeyframePlan, KeyframeItem> = {
  key: 'keyframe-reference',
  title: '关键帧',
  kind: 'image',
  stage: WorkflowStage.KEYFRAME_REFERENCE,

  load: async (ctx: any, report: PhaseReporter) => {
    const store = ProjectStore.getInstance();
    report(15, '读取关键帧产物…');

    const artifact = store.getArtifact<KeyframeReferenceArtifact>(
      ctx.projectId,
      WorkflowStage.KEYFRAME_REFERENCE
    );
    if (!artifact || !Array.isArray(artifact.shots) || artifact.shots.length === 0) {
      throw new Error(`项目 [${ctx.projectId}] 尚未生成关键帧参考图，无法执行局部微调`);
    }

    const targetKey: string | undefined =
      ctx.payload?.targetShotId || ctx.payload?.target || ctx.target;
    const shots = [...artifact.shots];
    const targetIndex = targetKey
      ? shots.findIndex(
          (k) =>
            k.shotId?.toLowerCase() === targetKey.toLowerCase() ||
            k.shotId?.includes(targetKey) ||
            targetKey.includes(k.shotId)
        )
      : 0;

    if (targetIndex < 0) {
      throw new Error(`未在已有关键帧中找到镜头【${targetKey}】`);
    }

    report(20, `已定位镜头【${shots[targetIndex].shotId}】`);
    return { artifact, targetIndex, target: shots[targetIndex] };
  },

  plan: async (state: KeyframeState, ctx: any, report: PhaseReporter): Promise<KeyframePlan> => {
    report(32, '推演关键帧提示词…');
    const plan = await refineKeyframePrompt({
      existingShot: state.target,
      userFeedback: extractUserFeedback(ctx),
    });
    report(45, '提示词推演完成');
    return plan;
  },

  apply: async (state: KeyframeState, plan: KeyframePlan, ctx: any, report: PhaseReporter) => {
    report(55, `正在重绘镜头【${state.target.shotId}】关键帧…`);
    const rendered = await renderModifiedKeyframe(
      ctx.projectId,
      state.target,
      plan.finalPrompt,
      plan.meta,
      { isMock: Boolean(ctx.payload?.isMock ?? ctx.overrideParams?.isMock) }
    );
    report(88, '关键帧重绘完成');
    return rendered;
  },

  commit: async (state: KeyframeState, rendered: KeyframeItem, ctx: any, report: PhaseReporter) => {
    const shots = [...state.artifact.shots];
    shots[state.targetIndex] = rendered;
    const updated: KeyframeReferenceArtifact = {
      ...state.artifact,
      shots,
      updatedAt: new Date().toISOString(),
    };
    ProjectStore.getInstance().setArtifact(
      ctx.projectId,
      WorkflowStage.KEYFRAME_REFERENCE,
      updated
    );

    report(95, '已落盘');
    return {
      toolResult: updated,
      summary: `已完成镜头【${state.target.shotId}】的关键帧局部微调与重绘。全片其余 ${shots.length - 1} 个镜头关键帧 100% 保持原状。`,
    };
  },
};
