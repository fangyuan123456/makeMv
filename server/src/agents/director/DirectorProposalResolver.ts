/**
 * agents/director/DirectorProposalResolver.ts
 * AI 导演行动提案解析器 (Director Proposal Resolver)
 * 
 * 单一职责：
 * 1. 直接处理原生 Tool Call 结构化入参 (propose_stage_action)；
 * 2. 统一委托 GateGuard 执行代码级刚性门禁防护 (GateGuard SSOT)；
 * 3. 门禁阻断显式转化：拒绝静默置空，自动转换为复审与辩护行动卡片。
 */

import { randomUUID } from 'crypto';
import { SkillRegistry } from '../../skills/SkillRegistry.js';
import { GateGuard } from '../reviewer/GateGuard.js';
import type { ActionProposal } from '../../chat/session/types.js';
import type { ReviewReport } from '../reviewer/types.js';
import type { ChatStreamCallbacks } from './types.js';
import type { ProposeStageActionInput } from './schema.js';

export class DirectorProposalResolver {
  private static instance?: DirectorProposalResolver;

  public static getInstance(): DirectorProposalResolver {
    if (!DirectorProposalResolver.instance) {
      DirectorProposalResolver.instance = new DirectorProposalResolver();
    }
    return DirectorProposalResolver.instance;
  }

  /**
   * 🌟 从原生 Tool Call (propose_stage_action) 直接裁决提案并执行门禁判定 (强类型入参，零猜测零正则)
   */
  public async resolveFromToolCall(
    args: ProposeStageActionInput,
    currentStage: string,
    reviewReport?: ReviewReport | null,
    callbacks?: ChatStreamCallbacks
  ): Promise<ActionProposal | undefined> {
    if (!args || typeof args !== 'object') {
      return undefined;
    }

    try {
      const registry = SkillRegistry.getInstance();
      const candidate = String(args.skill || '').trim();
      const skillEntity = registry.get(candidate);
      if (!skillEntity) {
        console.warn(`[DirectorProposalResolver] 刚性拦截：未知的技能标识 [${candidate}]，拒绝隐式降级`);
        return undefined;
      }

      const resolvedSkill = skillEntity.manifest.name;
      const executionParams = args.params || {};

      // 🌟 P1-1: 统一使用与提示词相同的可用技能白名单 (SSOT) 校验邻接性，禁止跨工序越级连跳
      const availableSkills = registry.getAvailableSkills(currentStage);
      const isAllowedInCurrentStage = availableSkills.some((s) => s.name === resolvedSkill);
      if (!isAllowedInCurrentStage) {
        console.warn(`[DirectorProposalResolver] 跨工序违规拦截：技能 [${resolvedSkill}] 不在当前工序 [${currentStage}] 的合法白名单中`);
        return undefined;
      }

      let proposal: ActionProposal = {
        actionId: `act_${randomUUID().slice(0, 8)}`,
        actionType: 'TRIGGER_STAGE',
        skill: resolvedSkill,
        label: args.label || '推进当前工序',
        description: args.description || '',
        status: 'pending',
        payload: {
          stage: currentStage,
          skill: resolvedSkill,
          params: executionParams,
        },
      };

      // 🌟 统一委托 GateGuard 进行刚性门禁判定 (GateGuard SSOT)
      const gateResult = GateGuard.check(resolvedSkill, currentStage, reviewReport);
      if (!gateResult.passed) {
        console.warn(`[DirectorProposalResolver] 门禁阻断推进提案 [${resolvedSkill}]: ${gateResult.reason}`);

        // 🌟 审查官阻断与导演自愈协同闭环 (纯契约驱动 SSOT，彻底消灭关键词启发式盲猜)
        const explicitFeedback = args.params?.userFeedback?.trim() || '';
        const isRefinementProposal = Boolean(args.params?.isRefinement);
        const hasHealingIntent = isRefinementProposal || explicitFeedback.length > 0;
        const candidateHealingText = explicitFeedback || args.description || '';

        const debateLabel = hasHealingIntent
          ? '🛡️ 审查官刚性阻断中 (已融合最新自愈方案，点击立即重新质检)'
          : '🚨 前往解决审查官刚性阻断 (点击重新质检/对辩)';

        const debateDesc = hasHealingIntent
          ? `已融合最新自愈设定: "${candidateHealingText}"。点击卡片将自动携带该方案向审查官发起重新质检并解除阻断。`
          : (gateResult.reason || `当前工序 [${currentStage}] 存在 CRITICAL 缺陷，已拦截推进，请微调设定或点击卡片重新质检/辩护。`);

        proposal = {
          actionId: `act_gate_intercept_${randomUUID().slice(0, 8)}`,
          actionType: 'CRITIC_DEBATE',
          skill: 'critic-review',
          isGateIntercept: true,
          label: debateLabel,
          description: debateDesc,
          status: 'pending',
          payload: {
            stage: currentStage,
            targetStage: currentStage,
            skill: 'critic-review',
            interceptedSkill: resolvedSkill,
            gateStatus: 'FAIL',
            reason: gateResult.reason || '存在严重逻辑破绽',
            userFeedback: candidateHealingText || undefined,
            hasHealingIntent,
            params: {
              targetStage: currentStage,
              userFeedback: candidateHealingText || undefined,
            },
          },
        };
      }

      if (callbacks?.onProposal) {
        try {
          await callbacks.onProposal(proposal);
        } catch (cbErr) {
          console.warn('[DirectorProposalResolver] onProposal 回调通知异常:', cbErr);
        }
      }

      return proposal;
    } catch (err) {
      console.warn('[DirectorProposalResolver] Tool Call 提案解析失败 (已安全降级):', err);
      return undefined;
    }
  }
}
