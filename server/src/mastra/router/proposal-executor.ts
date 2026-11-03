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

import {
  storyBibleTool,
  characterPortraitTool,
  sceneScriptTool,
  storyboardTool,
  keyframeReferenceTool,
  videoProductionTool,
  criticReviewTool,
  fmvPackagingTool,
} from '../tools/index.js';
import { ProjectStore, ProposalStore } from '../../project-store/index.js';
import { ProjectLockManager } from '../../utils/projectLock.js';
import { WorkflowStage, SessionStatus } from '../../types/index.js';
import type { ActionProposal } from '../../types/proposal.js';

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

export class ProposalExecutor {
  private static instance?: ProposalExecutor;

  public static getInstance(): ProposalExecutor {
    if (!ProposalExecutor.instance) {
      ProposalExecutor.instance = new ProposalExecutor();
    }
    return ProposalExecutor.instance;
  }

  /**
   * 恢复并执行已批准的提案 (Resume Suspended State)
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

      // 2. 审查官刚性门禁与跨工序守卫
      const project = projectStore.getProject(projectId);
      if (project) {
        const stageGate = projectStore.getArtifact<any>(projectId, `critic_review_${project.currentStage}`);
        const isSelfHealing = proposal.skill === 'critic-review' || proposal.payload?.stage === project.currentStage;
        if (stageGate?.gateStatus === 'FAIL' && !isSelfHealing) {
          throw new Error(`[ProposalExecutor] 当前阶段 ${project.currentStage} 审查未通过 (FAIL)，禁止跨工序执行 ${proposal.skill}！请先优化当前阶段。`);
        }
      }

      // 剥离元数据标记，保证严格契约
      const { stage: _unusedStage, ...cleanPayload } = proposal.payload || {};

      const mergedPayload = {
        projectId,
        ...cleanPayload,
        ...(overrideParameters || {}),
      };

      let toolResult: any;

      try {
        switch (proposal.skill) {
          case 'story-bible': {
            toolResult = await (storyBibleTool.execute as any)(mergedPayload);
            break;
          }
          case 'character-portrait': {
            toolResult = await (characterPortraitTool.execute as any)(mergedPayload);
            break;
          }
          case 'scene-script': {
            toolResult = await (sceneScriptTool.execute as any)(mergedPayload);
            break;
          }
          case 'storyboard': {
            toolResult = await (storyboardTool.execute as any)(mergedPayload);
            break;
          }
          case 'keyframe-reference': {
            toolResult = await (keyframeReferenceTool.execute as any)(mergedPayload);
            break;
          }
          case 'video-production': {
            toolResult = await (videoProductionTool.execute as any)(mergedPayload);
            break;
          }
          case 'critic-review': {
            toolResult = await (criticReviewTool.execute as any)(mergedPayload);
            break;
          }
          case 'fmv-packaging': {
            toolResult = await (fmvPackagingTool.execute as any)(mergedPayload);
            // 推进权由执行器统一确认收拢
            if (project) {
              project.currentStage = WorkflowStage.COMPLETED;
              project.status = SessionStatus.COMPLETED;
              project.updatedAt = new Date().toISOString();
              projectStore.saveProject(project);
            }
            break;
          }
          default:
            throw new Error(`[ProposalExecutor] 未知工具标识: ${proposal.skill}`);
        }

        // 检查工具返回的失败标识
        if (toolResult?.error || toolResult?.success === false) {
          const errorMsg = toolResult?.message || toolResult?.error || '工具内部返回执行失败';
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

        const summary = toolResult?.summary || '工序执行完成';
        const updatedProposal = proposalStore.updateProposalStatus(projectId, proposalId, 'executed', {
          executedAt: new Date().toISOString(),
          resultSummary: summary,
        });

        return {
          success: true,
          proposal: updatedProposal || proposal,
          result: toolResult,
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
