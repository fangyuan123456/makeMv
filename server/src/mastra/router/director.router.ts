/**
 * mastra/router/director.router.ts
 * 导演动态路由与人在回路提案引擎核心实体 (Director Router SSOT)
 */

import { LLMRegistry } from '../../llm/LLMRegistry.js';
import { ProjectStore, ProposalStore } from '../../project-store/index.js';
import { WorkflowStage, type ActionProposal } from '../../types/index.js';
import {
  DirectorRouterDecisionSchema,
  type DirectorRouterDecision,
} from './schema.js';
import {
  DIRECTOR_ROUTER_SYSTEM_PROMPT,
  buildRouterPrompt,
} from './prompt.js';

export interface RouteMessageInput {
  projectId: string;
  userMessage: string;
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
}

export interface RouteMessageResult {
  thought: string;
  reply: string;
  intent: string;
  proposal?: ActionProposal;
}

export class DirectorRouter {
  private static instance?: DirectorRouter;

  public static getInstance(): DirectorRouter {
    if (!DirectorRouter.instance) {
      DirectorRouter.instance = new DirectorRouter();
    }
    return DirectorRouter.instance;
  }

  /**
   * 核心路由方法：结合项目状态图黑板与创作者意图，推演下一步行动与人在回路提案
   */
  public async routeMessage(input: RouteMessageInput): Promise<RouteMessageResult> {
    const { projectId, userMessage, history = [] } = input;
    const projectStore = ProjectStore.getInstance();
    const project = projectStore.getProject(projectId);

    if (!project) {
      throw new Error(`[DirectorRouter] 未找到项目: ${projectId}`);
    }

    const projectName = project.title || '未命名影游项目';

    // 1. 扫描当前状态图中 8 大节点资产就绪情况（高信噪比内容摘要）
    const stages = [
      WorkflowStage.NARRATIVE_DESIGN,
      WorkflowStage.CHARACTER_DESIGN,
      WorkflowStage.SCENE_SCRIPT,
      WorkflowStage.STORYBOARD,
      WorkflowStage.KEYFRAME_REFERENCE,
      WorkflowStage.VIDEO_PRODUCTION,
      WorkflowStage.FMV_PACKAGING,
    ];

    const assetsSnapshot: Record<string, string> = {};
    for (const st of stages) {
      const art = projectStore.getArtifact<any>(projectId, st);
      if (art) {
        if (st === WorkflowStage.NARRATIVE_DESIGN && art.characters) {
          assetsSnapshot[st] = `已就绪 (包含角色: ${art.characters.map((c: any) => c.name).slice(0, 3).join('/')}等)`;
        } else if (st === WorkflowStage.CHARACTER_DESIGN && art.portraits) {
          assetsSnapshot[st] = `已就绪 (${art.portraits.length}位角色定妆照)`;
        } else if (st === WorkflowStage.STORYBOARD && art.shots) {
          assetsSnapshot[st] = `已就绪 (${art.shots.length}个镜头分镜)`;
        } else if (st === WorkflowStage.VIDEO_PRODUCTION && art.videos) {
          assetsSnapshot[st] = `已就绪 (${art.videos.length}个视频切片)`;
        } else {
          assetsSnapshot[st] = '已完成 (Ready)';
        }
      } else {
        assetsSnapshot[st] = '未生成 (Pending)';
      }
    }

    // 检查阶段隔离审查官门禁 (Stage-Isolated Gate SSOT)
    const criticReport = projectStore.getArtifact<any>(projectId, `critic_review_${project.currentStage}`) || projectStore.getArtifact<any>(projectId, 'critic_review');
    const criticGate = criticReport ? `${criticReport.gateStatus} (综合打分: ${criticReport.scores?.overallScore ?? 'N/A'}, 阶段: ${criticReport.stageReviewed || project.currentStage})` : undefined;

    // 2. 构造意图路由分析 Prompt
    const prompt = buildRouterPrompt(
      projectName,
      userMessage,
      history,
      assetsSnapshot,
      criticGate
    );

    // 3. 调度大模型进行结构化推演
    const llm = LLMRegistry.get();
    const decision = await llm.generateObject<DirectorRouterDecision>(
      prompt,
      DirectorRouterDecisionSchema,
      DIRECTOR_ROUTER_SYSTEM_PROMPT,
      {
        stage: 'director_router_decision',
        temperature: 0.3,
      }
    );

    // 4. 若产生了行动提案，转换为标准 ActionProposal 并落盘持久化
    let actionProposal: ActionProposal | undefined;
    if (decision.proposal && (decision.intent === 'PROPOSE_ACTION' || decision.intent === 'INVOKE_CRITIC')) {
      const actionId = `prop_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
      actionProposal = {
        actionId,
        actionType: decision.proposal.actionType || 'FULL_GENERATION',
        skill: decision.proposal.skill,
        label: decision.proposal.label,
        description: decision.proposal.description,
        status: 'pending',
        payload: {
          projectId,
          stage: decision.proposal.targetStage,
          ...(decision.proposal.payload || {}),
        },
      };

      // 落盘到 ProposalStore
      ProposalStore.getInstance().saveProposal(projectId, actionProposal);
    }

    return {
      thought: decision.thought,
      reply: decision.reply,
      intent: decision.intent,
      proposal: actionProposal,
    };
  }
}
