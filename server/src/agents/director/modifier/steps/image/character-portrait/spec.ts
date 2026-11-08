/**
 * agents/director/modifier/steps/image/character-portrait/spec.ts
 * 角色定妆微调规格 (Character Portrait Modifier Spec)
 *
 * image 型：定位角色 → 重写视觉提示词(LLM) → 渲染新定妆照 → 替换条目并压入历史
 */

import { WorkflowStage } from '../../../../../../types/index.js';
import { ProjectStore } from '../../../../../../project-store/ProjectStore.js';
import type {
  CharacterPortraitArtifact,
  CharacterSheetItem,
} from '../../../../../../artifacts/character-portrait.js';
import type { ModifierSpec, PhaseReporter } from '../../../spec.js';
import { extractUserFeedback } from '../../../spec.js';
import { withCharacterFacts } from '../../../../character-facts.js';
import {
  refineCharacterVisualPrompt,
  archiveHistoryAndPrepareRefine,
  renderModifiedCharacter,
} from './character-portrait.modifier.js';

interface PortraitState {
  artifact: CharacterPortraitArtifact;
  targetIndex: number;
  target: CharacterSheetItem;
  extra: { style: string };
}

interface PortraitPlan {
  refinedPrompt: string;
  history: any[];
  referenceImageUrl?: string;
  useReference: boolean;
}

export const characterPortraitSpec: ModifierSpec<PortraitState, PortraitPlan, CharacterSheetItem> = {
  key: 'character-portrait',
  title: '角色定妆',
  kind: 'image',
  stage: WorkflowStage.CHARACTER_DESIGN,

  load: async (ctx: any, report: PhaseReporter) => {
    const store = ProjectStore.getInstance();
    report(15, '读取角色定妆产物…');

    const artifact = store.getArtifact<CharacterPortraitArtifact>(
      ctx.projectId,
      WorkflowStage.CHARACTER_DESIGN
    );
    if (!artifact || !Array.isArray(artifact.characters) || artifact.characters.length === 0) {
      throw new Error(`项目 [${ctx.projectId}] 尚未生成角色定妆照，无法执行局部精修`);
    }

    const targetKey: string | undefined =
      ctx.payload?.targetName || ctx.payload?.target || ctx.target;
    const characters = [...artifact.characters];
    const targetIndex = targetKey
      ? characters.findIndex(
          (c) =>
            c.name?.toLowerCase() === targetKey.toLowerCase() ||
            c.name?.includes(targetKey) ||
            targetKey.includes(c.name)
        )
      : 0;

    if (targetIndex < 0) {
      throw new Error(`未在已有定妆照中找到角色【${targetKey}】`);
    }

    const project = store.getProject(ctx.projectId);
    const narrative = store.getArtifact<any>(ctx.projectId, WorkflowStage.NARRATIVE_DESIGN);
    const style = narrative?.style || project?.meta?.style || '电影质感，写实光影';

    report(20, `已定位角色【${characters[targetIndex].name}】`);
    return { artifact, targetIndex, target: characters[targetIndex], extra: { style } };
  },

  plan: async (state: PortraitState, ctx: any, report: PhaseReporter): Promise<PortraitPlan> => {
    report(30, '推演视觉提示词…');
    // 定妆条目只持视觉结果，重写提示词需要角色事实 → 按 name 从故事圣经现查并合并（只读）
    const project = ProjectStore.getInstance().getProject(ctx.projectId);
    const characterView = withCharacterFacts(project, state.target);
    const refinedPrompt = await refineCharacterVisualPrompt(ctx.llm, {
      existingChar: characterView as any,
      userFeedback: extractUserFeedback(ctx),
      style: state.extra?.style,
      projectId: ctx.projectId,
    });

    const { history, referenceImageUrl, useReference } = archiveHistoryAndPrepareRefine(
      state.target
    );
    report(45, '提示词推演完成');
    return { refinedPrompt, history, referenceImageUrl, useReference };
  },

  apply: async (state: PortraitState, plan: PortraitPlan, ctx: any, report: PhaseReporter) => {
    report(55, `正在渲染角色【${state.target.name}】定妆照…`);
    const rendered = await renderModifiedCharacter(ctx.projectId, state.target, plan.refinedPrompt, {
      useReference: plan.useReference,
      referenceImageUrl: plan.referenceImageUrl,
      isMock: Boolean(ctx.payload?.isMock ?? ctx.overrideParams?.isMock),
      history: plan.history,
    });
    report(88, '定妆照渲染完成');
    return rendered;
  },

  commit: async (state: PortraitState, rendered: CharacterSheetItem, ctx: any, report: PhaseReporter) => {
    const characters = [...state.artifact.characters];
    characters[state.targetIndex] = rendered;
    const updated: CharacterPortraitArtifact = {
      ...state.artifact,
      characters,
      updatedAt: new Date().toISOString(),
    };
    ProjectStore.getInstance().setArtifact(ctx.projectId, WorkflowStage.CHARACTER_DESIGN, updated);

    report(95, '已落盘');
    return {
      toolResult: updated,
      summary: `已完成角色【${state.target.name}】的局部微调精修，定妆照已重新生成并压入版本历史。其余 ${characters.length - 1} 位角色 100% 物理保持原状。`,
    };
  },
};
