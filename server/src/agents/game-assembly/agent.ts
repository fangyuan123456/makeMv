/**
 * agents/game-assembly/agent.ts
 * 游戏总装与对话修改导演 Agent
 */

import { AgentRunner } from '../runtime/runner.js';
import { ProjectStore } from '../../project-store/ProjectStore.js';
import type {
  AgentFocusContext,
  PlannerActionIntent,
  SubmittableToolSpec,
} from '../runtime/types.js';
import type { PipelineStageSpec } from '../runtime/pipeline.js';
import type { TaskRecord } from '../../task-engine/types.js';
import { gameAssemblyCapabilities } from './capabilities.js';
import { GAME_ASSEMBLY_DIRECTOR_SYSTEM_PROMPT } from './prompt.js';
import {
  evaluateGameAssemblyPhase,
  type GameAssemblyPhase,
  type GameAssemblyEvaluation,
} from './context.js';

export { GAME_ASSEMBLY_DIRECTOR_SYSTEM_PROMPT } from './prompt.js';
export {
  evaluateGameAssemblyPhase,
  type GameAssemblyPhase,
  type GameAssemblyEvaluation,
} from './context.js';

export class GameAssemblyAgent extends AgentRunner<PlannerActionIntent> {
  constructor(options: { projectId: string; sessionId?: string }) {
    super({
      projectId: options.projectId,
      sessionId: options.sessionId || 'game-assembly',
    });
  }

  /**
   * 动态计算游戏总装运行时状态机
   */
  public static evaluatePhase(projectId: string): GameAssemblyEvaluation {
    return evaluateGameAssemblyPhase(projectId);
  }

  protected assembleSystemPrompt(): string {
    const store = ProjectStore.getInstance();
    const project = store.getProject(this.projectId);
    const meta = project?.meta || ({} as any);
    const evaluation = evaluateGameAssemblyPhase(this.projectId);

    let phaseDescription = '';
    let currentMission = '';
    if (evaluation.phase === 'ASSEMBLED_READY_TO_MODIFY') {
      phaseDescription = '可玩工程已生成（支持对话增量修改与数据同步）';
      currentMission =
        '工程已就绪并可直接试玩。吸收创作者的界面排版、手感和玩法修改反馈，必要时出具 game.assembly(mode: "modify", modifyInstruction: "...") 提案，或以 chat_only 专业探讨。';
    } else if (evaluation.phase === 'READY_TO_BUILD') {
      phaseDescription = '游戏 PRD 已就绪，待首次总装生成可玩工程';
      currentMission =
        '游戏产品 PRD 与分幕规格已就位。主动出具 game.assembly(mode: "build") 提案，一键装配可玩影游。';
    } else if (evaluation.phase === 'READY_FOR_PRD') {
      phaseDescription = '结构化剧本已就绪，待生成游戏产品 PRD 规格';
      currentMission =
        '剧本与分幕拓扑已就位，但尚未生成游戏产品 PRD 规格（UI 主题、状态字典与 6 屏规划）。请主动出具 game.prd 提案，生成后再执行游戏总装。';
    } else {
      phaseDescription = '缺少前置结构化剧本，需先完成故事策划';
      currentMission =
        '当前项目尚未完成互动全景剧本创作。引导创作者先在工序 1 完成剧本推演。';
    }

    const stateBoard = `
==================================================
### 【游戏总装态势】
- 项目: 《${meta.title || this.projectId}》 (${meta.genre || '互动影游'})
- 当前管线状态: ${phaseDescription}
- 当前工序目标: ${currentMission}
- PRD 分幕数: ${evaluation.clipCount} 幕
- 已有游戏文件: ${evaluation.existingFiles.length ? evaluation.existingFiles.join(', ') : '尚未生成'}
==================================================`;

    return `${GAME_ASSEMBLY_DIRECTOR_SYSTEM_PROMPT}\n${stateBoard}`;
  }

  protected getIntentToolSpecs(): SubmittableToolSpec[] {
    return gameAssemblyCapabilities();
  }

  /**
   * 业务工序流水线阶段顺位 (Pipeline Stages SSOT)
   * 游戏总装主流程仅为 game.assembly 单一收敛阶段；
   * game.compile_story 为按需数据同步工具，避免总装后被错误推断为必须接续执行的下一步
   */
  protected override getPipelineStageSequence(): PipelineStageSpec[] {
    return [
      {
        tool: 'game.prd',
        stageName: '游戏 PRD 规格生成',
        description: '基于结构化剧本生成游戏产品 PRD 规格（UI 主题、状态字典与 6 屏交互规划）',
        targetKind: 'global',
      },
      {
        tool: 'game.assembly',
        stageName: '游戏总装与调优',
        description: '互动影游独立站点全量装配与对话增量修改',
        targetKind: 'global',
      },
    ];
  }

  public override getPostTaskPrompt(task: TaskRecord, title: string): string {
    if (task.toolName === 'game.compile_story') {
      return `【制片工序事件】数据层同步工具【${title || task.toolName}】已顺利完成，最新剧本与媒体数据已成功编译进 story.json。\n【复盘职责】：核对项目资产状态，向创作者简要汇报数据已同步完毕，可在试玩界面中刷新验证；无进一步物理工序需推进，必须使用 action="chat_only" 自然收官。`;
    }
    return super.getPostTaskPrompt(task, title);
  }

  protected override resolveFocusDetails(focus: AgentFocusContext): string[] {
    if (!focus.target) return [];
    const { kind, id, label } = focus.target;
    if (kind === 'screen') {
      return [`当前聚焦游戏界面: [${label || id}]`];
    }
    if (kind === 'clip' || kind === 'scene') {
      return [`当前聚焦分幕场景: [${label || id}]`];
    }
    if (kind === 'file') {
      return [`当前聚焦工程文件: [${label || id}]`];
    }
    return [`当前聚焦目标: [${label || id}] (${kind})`];
  }
}
