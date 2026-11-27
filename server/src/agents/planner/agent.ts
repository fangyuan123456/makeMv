/**
 * agents/planner/agent.ts
 * 工序 1 故事总监 Agent。
 *
 * 核心架构模式：
 * 1. 显式工序状态机看板 (Runtime Pipeline State Board)：
 *    动态计算当前是处于 STEP_1_PENDING 还是 STAGE_1_COMPLETED；
 * 2. 挂载真实 Mastra Tools：
 *    直连 screenplayTool.toMastraTool()；
 * 3. 人在回路拦截切面：
 *    捕获 Tool Call 转化为 Pending 操作卡片。
 */

import { AgentRunner } from '../runtime/runner.js';
import { ProjectStore } from '../../project-store/ProjectStore.js';
import { resolveProjectStorySource } from '../../project-store/story-source.js';
import { getProjectStorySections } from '../../project-store/story-sections.js';
import type { AgentFocusContext, PlannerActionIntent, SubmittableToolSpec } from '../runtime/types.js';
import { plannerCapabilities } from './capabilities.js';
import { PLANNER_DIRECTOR_SYSTEM_PROMPT } from './prompt.js';
import { evaluatePlannerPhase, type PlannerPhase } from './context.js';

export { PLANNER_DIRECTOR_SYSTEM_PROMPT } from './prompt.js';
export type { PlannerPhase } from './context.js';

export class PlannerAgent extends AgentRunner<PlannerActionIntent> {
  constructor(options: { projectId: string; sessionId?: string }) {
    super({
      projectId: options.projectId,
      sessionId: options.sessionId || 'planner',
    });
  }

  /**
   * 动态计算工序 1 运行时状态机 (SOP State Machine Evaluator)
   */
  public static evaluatePhase(projectId: string): {
    phase: PlannerPhase;
    hasScreenplay: boolean;
    screenplaySummary: string;
    topologySummary: string;
  } {
    return evaluatePlannerPhase(projectId);
  }

  /**
   * 组装带工序 1 SOP 状态机看板的专属 System Prompt
   */
  protected assembleSystemPrompt(): string {
    const store = ProjectStore.getInstance();
    const project = store.getProject(this.projectId);
    const meta = project.meta;
    const evaluation = PlannerAgent.evaluatePhase(this.projectId);

    const phaseDescription =
      evaluation.phase === 'STEP_1_PENDING'
        ? '工序 1: 互动全景剧本与结构化拓扑推演 (进行中)'
        : '工序 1 全线完工 (已圆满收官)';

    const currentMission =
      evaluation.phase === 'STEP_1_PENDING'
        ? '协助确立故事题材与核心冲突，构思成熟时发起全景剧本推演提案。'
        : '结构化剧本与因果拓扑均已落盘收敛，工序 1 已全线圆满收官。严格遵循【终态自知公理】，出具 action="chat_only" 专业对白收官复盘，并自然引导创作者进入后续工坊。';

    const assetDetails = [
      evaluation.hasScreenplay ? `【已落盘剧本摘要】\n${evaluation.screenplaySummary}` : '',
      evaluation.topologySummary ? `【已落盘结构化分幕拓扑】\n${evaluation.topologySummary}` : '',
    ]
      .filter(Boolean)
      .join('\n\n');

    const stateBoard = `
==================================================
### 【工序 1 文学策划态势】
- 项目: 《${meta.title || this.projectId}》 (${meta.genre || '互动影游'})
- 当前管线阶段: ${phaseDescription}
- 当前工序目标: ${currentMission}
- 核心资产状态: 结构化剧本与拓扑(${evaluation.hasScreenplay ? '已落盘' : '待推演'})
${assetDetails ? `\n${assetDetails}\n` : ''}
==================================================`;

    return `${PLANNER_DIRECTOR_SYSTEM_PROMPT}\n${stateBoard}`;
  }

  /**
   * 声明工序 1 支持的法定物理工具清单 (SSOT)
   * AgentRunner 基于此清单自动构建强类型 emit_director_intent 意图识别工具
   */
  protected getIntentToolSpecs(): SubmittableToolSpec[] {
    return plannerCapabilities();
  }

  protected override resolveFocusDetails(focus: AgentFocusContext): string[] {
    if (focus.target?.kind !== 'prd_node' || !focus.target.id) return [];
    const storySource = resolveProjectStorySource(this.projectId) || {};
    const nodeId = focus.target.id;

    const clip = (storySource.clips || []).find((c: any) => c.id === nodeId);
    if (clip) {
      return [
        `节点类型：分幕片段 (${clip.id} · ${clip.title || nodeId})`,
      ];
    }

    const interaction = (storySource.interactions || []).find((i: any) => i.id === nodeId);
    if (interaction) {
      const options = (interaction.outcomes || [])
        .map((o: any) => `[${o.key}] ${o.label}`)
        .join(' ｜ ');
      return [
        `节点类型：互动节点 (${interaction.id} | 类型: ${interaction.kind || 'CHOICE'}${interaction.isBranching === false ? ' · 单线沉浸' : ' · 命运分支'}${interaction.timeoutSec ? ` · 限时 ${interaction.timeoutSec}s` : ''})`,
        ...(interaction.prompt ? [`提示语：${interaction.prompt}`] : []),
        ...(options ? [`结果与去向：${options}`] : []),
      ];
    }

    const ending = (storySource.endings || []).find((e: any) => e.id === nodeId);
    if (ending) {
      return [
        `节点类型：终局节点 (${ending.id} · ${ending.title || ''})`,
        ...(ending.summary ? [`结局摘要：${ending.summary}`] : []),
      ];
    }

    return [];
  }

}
