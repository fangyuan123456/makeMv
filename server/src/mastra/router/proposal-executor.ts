/**
 * mastra/router/proposal-executor.ts
 * 人在回路提案安全执行器 (Proposal Executor SSOT)
 * 
 * 核心安全防线：
 * 1. 刚性状态机拦截：仅允许 pending 态执行，杜绝 dismissed/executed 提案复活；
 * 2. 跨阶段门禁前置守卫：当前阶段处于 FAIL 阻断态时拦截带病跨工序推进；
 * 3. 继承 ProjectLockManager：单项目串行互斥锁，彻底根除并发重复扣费；
 * 4. 阶段推进权统筹收拢：工序完成后统一推进 project.currentStage。
 */

import { stageWorkflows } from '../workflows/pipeline.workflow.js';
import { ProjectStore, ProposalStore } from '../../project-store/index.js';
import { ProjectLockManager } from '../../utils/projectLock.js';
import { WorkflowStage, SessionStatus, type ActionProposal } from '../../types/index.js';

export interface ExecuteProposalOptions {
  projectId: string;
  proposalId: string;
  overrideParameters?: Record<string, any>;
}

export interface ExecuteProposalResult {
  success: boolean;
  proposal: ActionProposal;
  result?: any;
  error?: string;
}

/**
 * 影视生产各工序到下一阶段的权威推进映射表 (Stage Transition Map SSOT)
 */
const STAGE_TRANSITION_MAP: Record<string, WorkflowStage> = {
  'story-bible': WorkflowStage.CHARACTER_DESIGN,
  'character-portrait': WorkflowStage.SCENE_SCRIPT,
  'scene-script': WorkflowStage.STORYBOARD,
  'storyboard': WorkflowStage.KEYFRAME_REFERENCE,
  'keyframe-reference': WorkflowStage.VIDEO_PRODUCTION,
  'video-production': WorkflowStage.FMV_PACKAGING,
  'fmv-packaging': WorkflowStage.COMPLETED,
};

export class ProposalExecutor {
  private static instance?: ProposalExecutor;

  public static getInstance(): ProposalExecutor {
    if (!ProposalExecutor.instance) {
      ProposalExecutor.instance = new ProposalExecutor();
    }
    return ProposalExecutor.instance;
  }

  /**
   * 恢复并执行已批准的提案 (真正走 Mastra Workflow Run 驱动)
   */
  public async executeProposal(options: ExecuteProposalOptions): Promise<ExecuteProposalResult> {
    const { projectId, proposalId, overrideParameters } = options;
    const lock = ProjectLockManager.getInstance();

    return await lock.withLock(projectId, async () => {
      const proposalStore = ProposalStore.getInstance();
      const projectStore = ProjectStore.getInstance();
      const proposal = proposalStore.getProposal(projectId, proposalId);

      if (!proposal) {
        throw new Error(`[ProposalExecutor] 未找到提案: ${proposalId}`);
      }

      // 1. 状态机严格防御：防复活与防重放
      if (proposal.status !== 'pending') {
        throw new Error(`[ProposalExecutor] 提案处于非可执行状态 [${proposal.status}]，禁止执行！`);
      }

      if (!proposal.skill) {
        throw new Error(`[ProposalExecutor] 提案 [${proposalId}] 缺少合法的 skill 工序标识`);
      }
      const skill = proposal.skill;

      // 规范化入参，保证 targetStage 严密传递以支持阶段隔离 (P0-3 修复)
      const rawPayload = proposal.payload || {};
      const targetStage = rawPayload.targetStage || rawPayload.stage;
      const cleanPayload = { ...rawPayload };
      if (targetStage) {
        cleanPayload.targetStage = targetStage;
      }

      // 2. 审查官刚性门禁与跨工序守卫
      const project = projectStore.getProject(projectId);
      if (project) {
        const stageGate = projectStore.getArtifact<any>(projectId, `critic_review_${project.currentStage}`);
        const isSelfHealing = skill === 'critic-review' || cleanPayload.targetStage === project.currentStage;
        if (stageGate?.gateStatus === 'FAIL' && !isSelfHealing) {
          throw new Error(`[ProposalExecutor] 当前阶段 ${project.currentStage} 审查未通过 (FAIL)，禁止跨工序执行 ${skill}！请先优化当前阶段。`);
        }
      }

      // 3. 获取对应的 Mastra 官方 Workflow 微内核实例并启动 Run
      const workflow = stageWorkflows[skill];
      if (!workflow) {
        throw new Error(`[ProposalExecutor] 未找到工序标识对应的 Mastra 工作流: ${skill}`);
      }

      try {
        console.log(`[ProposalExecutor] 触发 Mastra 原生 Run: skill=${skill}, project=${projectId}`);
        const run = await workflow.createRun();
        const runResult = await run.start({
          inputData: {
            projectId,
            activeStage: project?.currentStage,
            payload: cleanPayload,
            overrideParams: overrideParameters,
          },
        });

        // 4. 工作流执行状态与失败防御
        if (runResult.status !== 'success') {
          const errorMsg = (runResult as any).error || `Mastra 工作流执行异常 (状态: ${runResult.status})`;
          proposalStore.updateProposalStatus(projectId, proposalId, 'failed', {
            failedAt: new Date().toISOString(),
            error: errorMsg,
          });

          return {
            success: false,
            proposal,
            error: errorMsg,
            result: runResult,
          };
        }

        const stepResults = (runResult as any).results || {};
        const firstStepOutput = Object.values(stepResults)[0] as any;
        const stepOutput = firstStepOutput?.output || (runResult as any).output || {};
        const toolResult = stepOutput.toolResult;

        // 检查底层工具显式返回的业务错误
        if (toolResult?.error || toolResult?.success === false) {
          const errorMsg = toolResult?.message || toolResult?.error || '工序工具返回执行失败';
          proposalStore.updateProposalStatus(projectId, proposalId, 'failed', {
            failedAt: new Date().toISOString(),
            error: errorMsg,
          });

          return {
            success: false,
            proposal,
            error: errorMsg,
            result: toolResult,
          };
        }

        // 5. 成功判定后，统筹推进 project.currentStage 与状态机生命周期 (P0-2 & P0-4 修复)
        if (project) {
          const nextStage = STAGE_TRANSITION_MAP[skill];
          if (nextStage) {
            project.currentStage = nextStage;
            if (nextStage === WorkflowStage.COMPLETED) {
              project.status = SessionStatus.COMPLETED;
            }
            project.updatedAt = new Date().toISOString();
            projectStore.saveProject(project);
            console.log(`[ProposalExecutor] 项目 [${projectId}] 成功推进阶段至: ${nextStage}`);
          }
        }

        const summary = stepOutput.lastSummary || toolResult?.summary || '工序执行完成';
        const updatedProposal = proposalStore.updateProposalStatus(projectId, proposalId, 'executed', {
          executedAt: new Date().toISOString(),
          resultSummary: summary,
        });

        return {
          success: true,
          proposal: updatedProposal || proposal,
          result: toolResult || stepOutput,
        };
      } catch (err: any) {
        proposalStore.updateProposalStatus(projectId, proposalId, 'failed', {
          failedAt: new Date().toISOString(),
          error: err.message || '执行异常',
        });

        return {
          success: false,
          proposal,
          error: err.message,
        };
      }
    });
  }

  /**
   * 创作者驳回提案
   */
  public rejectProposal(projectId: string, proposalId: string, reason?: string): ActionProposal {
    const proposalStore = ProposalStore.getInstance();
    const updated = proposalStore.updateProposalStatus(projectId, proposalId, 'dismissed', {
      description: reason || '创作者主动驳回',
    });
    if (!updated) {
      throw new Error(`[ProposalExecutor] 提案 ${proposalId} 不存在`);
    }
    return updated;
  }
}
