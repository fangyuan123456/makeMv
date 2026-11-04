/**
 * agents/director/tools/propose-stage-action.tool.ts
 * AI 总导演高阶工序推进与工作流调度工具 (Stage Action Tool SSOT)
 * 
 * 核心架构设计（主逻辑零侵入哲学与容错自愈）：
 * 1. 业务主逻辑极致纯粹：主逻辑就像没有确认一样，只负责向通用 WorkflowEngine 派发工作流；
 * 2. 领域内聚：总导演管辖的 stageWorkflows 业务流水线传入通用引擎；
 * 3. 上下文自愈与抗击穿：若大模型漏传 projectId 自动从当前活跃工程补齐，执行异常优雅受控返回，保护 SSE 长连接。
 */

import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { WorkflowEngine } from '../../../workflow-engine/index.js';
import { ProjectStore } from '../../../project-store/ProjectStore.js';
import { STAGE_OF_SKILL } from '../workflows/register.js';
import { STAGE_SEQUENCE, type WorkflowStage } from '../../../types/index.js';

export const ProposeStageActionInputSchema = z.object({
  projectId: z.string().optional().describe('项目唯一标识 ID (若未传自动从当前活跃项目补齐)'),
  sessionId: z.string().optional().describe('当前对话会话 ID'),
  skill: z.enum([
    'story-bible',
    'character-portrait',
    'scene-script',
    'storyboard',
    'keyframe-reference',
    'video-production',
    'critic-review',
    'fmv-packaging',
  ]).describe('目标推进或调优的视听工序标识'),
  actionType: z.enum([
    'PROCEED_STAGE',
    'TARGETED_REVISE',
    'RETRY_STAGE',
    'CRITIC_AUDIT',
    'STAGE_ROLLBACK',
  ]).default('PROCEED_STAGE').describe('提案行动类型：进入新阶段/微调自愈/重试/审计/时空回退'),
  reason: z.string().describe('向创作者阐述发起本工序的专业导演决策理由与视听预期'),
  userPrompt: z.string().optional().describe('用户具体的创作指令或微调描述'),
  parameters: z.record(z.any()).optional().describe('透传给工序的额外结构化参数（如运镜、情绪、镜头编号等）'),
});

export const ProposeStageActionOutputSchema = z.object({
  success: z.boolean(),
  proposalId: z.string(),
  proposal: z.any().optional(),
  summary: z.string(),
  error: z.string().optional(),
  isReused: z.boolean().optional(),
  autoStarted: z.boolean().optional(),
});

export const proposeStageActionTool = createTool({
  id: 'propose-stage-action',
  description: '推进指定影视工序工作流（自动执行或恢复挂起）。根据配置自动启动或生成待审核提案卡片。',
  inputSchema: ProposeStageActionInputSchema,
  outputSchema: ProposeStageActionOutputSchema,
  execute: async (params: any) => {
    try {
      const raw = (params && typeof params === 'object' && 'context' in params && params.context) ? params.context : params;
      const store = ProjectStore.getInstance();

      // 1. 上下文自愈：若缺失 projectId，自动从当前活跃工程回退补齐 (按最近更新时间倒序)
      let effectiveProjectId = raw?.projectId;
      if (!effectiveProjectId) {
        const activeProjects = store.listProjects().sort((a, b) => {
          const tA = new Date(a.updatedAt || a.createdAt || 0).getTime();
          const tB = new Date(b.updatedAt || b.createdAt || 0).getTime();
          return tB - tA;
        });
        if (activeProjects.length > 0) {
          effectiveProjectId = activeProjects[0].projectId;
        } else {
          return {
            success: false,
            proposalId: '',
            summary: '发起提案失败：系统中暂无已初始化的项目',
            error: 'No active project found',
          };
        }
      }

      const inputWithSelfHealing = {
        ...raw,
        projectId: effectiveProjectId,
      };

      const parsed = ProposeStageActionInputSchema.safeParse(inputWithSelfHealing);
      if (!parsed.success) {
        const issueMsg = parsed.error.issues.map((i) => `${i.path.join('.') || 'root'}: ${i.message}`).join('; ');
        return {
          success: false,
          proposalId: '',
          summary: `发起提案参数不全: ${issueMsg}`,
          error: issueMsg,
        };
      }

      const { projectId, sessionId, skill, actionType, reason, userPrompt, parameters } = parsed.data;

      // 2. 跨阶段时空回退自动感知 (源头治理)：当目标工序早于当前阶段时，自愈标记为 STAGE_ROLLBACK
      const project = store.getProject(projectId!);
      const skillStage = STAGE_OF_SKILL[skill];
      const targetOrder = skillStage ? STAGE_SEQUENCE.indexOf(skillStage as WorkflowStage) : -1;
      const currentOrder = project?.currentStage ? STAGE_SEQUENCE.indexOf(project.currentStage as WorkflowStage) : -1;
      const isRollback = targetOrder >= 0 && currentOrder >= 0 && targetOrder < currentOrder;

      const effectiveActionType = isRollback && actionType === 'PROCEED_STAGE' ? 'STAGE_ROLLBACK' : actionType;
      const effectiveParameters = {
        ...(parameters || {}),
        ...(isRollback ? { isRollback: true } : {}),
      };

      // 3. 通用工作流引擎一键调度 (微内核流转)
      const engine = WorkflowEngine.getInstance();
      const dispatchRes = await engine.dispatch({
        projectId: projectId!,
        sessionId,
        workflowKey: skill,
        actionType: effectiveActionType,
        reason,
        userPrompt,
        parameters: effectiveParameters,
      });

      if (dispatchRes.proposal) {
        dispatchRes.proposal.projectId = projectId;
      }
      return dispatchRes;
    } catch (err: any) {
      console.warn('[proposeStageActionTool] 调度执行受控捕获:', err);
      return {
        success: false,
        proposalId: '',
        summary: `发起提案执行遇阻: ${err.message || '未知异常'}`,
        error: err.message,
      };
    }
  },
});
