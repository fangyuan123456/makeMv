/**
 * agents/planner/agent.ts
 * 工序 1 故事总监 Agent。
 *
 * 核心架构模式：
 * 1. 显式工序状态机看板 (Runtime Pipeline State Board)：
 *    动态计算当前是处于 STEP_1_PENDING、STEP_2_PENDING 还是 STAGE_1_COMPLETED；
 * 2. 挂载真实 Mastra Tools：
 *    直连 screenplayTool.toMastraTool() 与 scriptToPrdTool.toMastraTool()；
 * 3. 人在回路拦截切面：
 *    捕获 Tool Call 转化为 Pending 操作卡片。
 */

import { AgentRunner } from '../runtime/runner.js';
import { ProjectStore } from '../../project-store/ProjectStore.js';
import { computeProjectStaleMap } from '../../project-store/freshness.js';
import { getProjectStorySections } from '../../project-store/story-sections.js';
import { TaskStore } from '../../task-engine/task-store.js';
import { scriptToPrdTool } from '../../tools/planner/index.js';
import type { AgentFocusContext, PlannerActionIntent, SubmittableToolSpec } from '../runtime/types.js';
import type { TaskRecord } from '../../task-engine/types.js';
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

  public override getPostTaskPrompt(task: TaskRecord, title: string): string {
    const complete = task.toolName === scriptToPrdTool.toolName;
    return complete
      ? `【制片工序事件】工序【${title}】已完成并物理落盘。请核对剧本与 PRD，出具工序 1 的收官复盘。`
      : `【制片工序事件】工序【${title}】已完成并物理落盘。请核对当前剧本，简要复盘成果；若 PRD 尚未落盘，请在同一次回复中出具下一工序的待审提案，不要直接执行。`;
  }

  protected override allowPostTaskProposal(): boolean {
    return PlannerAgent.evaluatePhase(this.projectId).phase === 'STEP_2_PENDING';
  }

  /**
   * 动态计算工序 1 运行时状态机 (SOP State Machine Evaluator)
   */
  public static evaluatePhase(projectId: string): {
    phase: PlannerPhase;
    hasScreenplay: boolean;
    hasPrd: boolean;
    screenplaySummary: string;
    prdSummary: string;
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

    // 提取会话历史态势与挂起待审提案 (SSOT 最高优先级)
    const sessionMessages = this.getMessages();
    const userTurnsCount = sessionMessages.filter((m) => m.role === 'user').length;
    const lastMsgWithProposal = [...sessionMessages].reverse().find((m) => m.proposal && !m.proposalResolved);
    const activePendingProposal = lastMsgWithProposal?.proposal;
    const proposalFact = activePendingProposal
      ? `挂起待审【${activePendingProposal.title || activePendingProposal.tool}】`
      : '无挂起提案';

    let phaseDescription = '';
    let currentMission = '';

    if (activePendingProposal) {
      phaseDescription = `提案待审中: 【${activePendingProposal.title || activePendingProposal.tool}】`;
      currentMission = `当前存在挂起待审的制片/微调方案【${activePendingProposal.title || activePendingProposal.tool}】。若创作者表达认可授权（如“同意/准了/开跑/可以/好的”），你必须且只能调用 emit_director_intent(action: "approve") 授权开跑！严禁在单条回复中自说自话伪造落盘或宣称阶段已推进！`;
    } else {
      switch (evaluation.phase) {
        case 'STEP_1_PENDING':
          phaseDescription = '步骤 1/2: 互动全景剧本推演 (进行中)';
          currentMission = '协助确立故事题材与核心冲突，构思成熟时发起全景剧本推演提案；若创作者要求一次性连跑剧本与 PRD，按多步 Plan 编排通则在 operations 中依次串联 planner.screenplay_writer 与 planner.script_to_prd。';
          break;

        case 'STEP_2_PENDING':
          phaseDescription = '步骤 2/2: PRD 分幕拓扑拆解 (进行中)';
          currentMission = '剧本正文已落盘。阐述因果分幕逻辑，并主动发起 PRD 分幕拓扑拆解提案。';
          break;

        case 'STAGE_1_COMPLETED':
          phaseDescription = '工序 1 全线完工 (已完成)';
          currentMission = '剧本与 PRD 策划案均已收敛，工序 1 全线完工。为创作者出具全景总纲收官复盘，梳理世界观、人物弧光与分支拓扑格局。';
          break;
      }
    }

    // 关联物理任务存储
    const taskStore = TaskStore.getInstance();
    const projectTasks = taskStore.getTasksByProject(this.projectId).filter(
      (task) => (task.input as any)?.__chatContext?.sessionId === this.sessionId
    );
    const activeTask = projectTasks.find((t) => t.status === 'running' || t.status === 'pending');
    const failedTask = projectTasks.find((t) => t.status === 'failed');

    const activeTaskSummary = activeTask
      ? `运行中 [${activeTask.toolName}] (taskId: ${activeTask.taskId}, 进度: ${activeTask.progress?.percent || 0}%)`
      : '无';

    const failedTaskSummary = failedTask
      ? `失败 [${failedTask.toolName}] (taskId: ${failedTask.taskId}, 错误: "${failedTask.error || '未知'}")`
      : '无';

    const staleMap = computeProjectStaleMap(this.projectId);
    const staleNotice = staleMap.prd ? `⚠ PRD 同步提醒: ${staleMap.prd.reason}` : '无（上下游已同步）';

    const assetDetails = [
      evaluation.hasScreenplay ? `【已落盘剧本摘要】\n${evaluation.screenplaySummary}` : '',
      evaluation.hasPrd ? `【已落盘 PRD 拓扑摘要】\n${evaluation.prdSummary}` : '',
    ]
      .filter(Boolean)
      .join('\n\n');

    const stateBoard = `

==================================================
### 【当前制片态势 (State Board)】
- 项目: 《${meta.title || this.projectId}》 (${meta.genre || '互动影游'}) | 交互轮次: ${userTurnsCount}
- 管线进度: 步骤 1/2 剧本 [${evaluation.hasScreenplay ? '完成' : '待执行'}] | 步骤 2/2 PRD [${evaluation.hasPrd ? '完成' : '待执行'}]
- 当前阶段: ${phaseDescription}
- 制片目标: ${currentMission}
- 资产沉淀: 剧本(${evaluation.hasScreenplay ? '已落盘' : '无'}) | PRD(${evaluation.hasPrd ? '已落盘' : '无'})
- 上下游同步状态: ${staleNotice}
- 待审提案: ${proposalFact}
- 物理任务: 活跃(${activeTaskSummary}) | 异常(${failedTaskSummary})
${assetDetails ? `\n${assetDetails}\n` : ''}
==================================================
`;

    return `${PLANNER_DIRECTOR_SYSTEM_PROMPT}${stateBoard}\n${AgentRunner.renderFunnelPromptMatrix()}`;
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
    const store = ProjectStore.getInstance();
    const prd = (store.getArtifact(this.projectId, 'prd') as any) || {};
    const nodeId = focus.target.id;

    const clip = (prd.clips || []).find((c: any) => c.id === nodeId);
    if (clip) {
      const section = getProjectStorySections(this.projectId)[nodeId];
      const text = clip.narrativeText || section?.narrativeText || '';
      return [
        `节点类型：分幕片段 (${clip.id} · ${clip.title || nodeId})`,
        ...(text ? [`本幕剧本正文：${text.slice(0, 500)}${text.length > 500 ? '...' : ''}`] : []),
      ];
    }

    const interaction = (prd.interactions || []).find((i: any) => i.id === nodeId);
    if (interaction) {
      const options = (interaction.outcomes || [])
        .map((o: any) => `[${o.key}] ${o.label}`)
        .join(' ｜ ');
      return [
        `节点类型：互动抉择点 (${interaction.id})`,
        ...(interaction.prompt ? [`提示语：${interaction.prompt}`] : []),
        ...(options ? [`分支选项：${options}`] : []),
      ];
    }

    const ending = (prd.endings || []).find((e: any) => e.id === nodeId);
    if (ending) {
      return [
        `节点类型：终局节点 (${ending.id} · ${ending.title || ''})`,
        ...(ending.summary ? [`结局摘要：${ending.summary}`] : []),
      ];
    }

    return [];
  }

}
