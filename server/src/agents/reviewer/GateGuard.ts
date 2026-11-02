/**
 * agents/reviewer/GateGuard.ts
 * 统一影视工序门禁拦截判定器 (Gate Guard SSOT)
 *
 * 单一职责：
 * 消除重复与判定漂移。无论在 AI 导演自主提案阶段 (DirectorProposalResolver)，
 * 还是在技能执行端 (SkillController)，统一依赖本守卫判定工序推进合法性。
 */

import { SkillRegistry } from '../../skills/SkillRegistry.js';
import type { ReviewReport, ReviewGateStatus } from './types.js';

export interface GateCheckResult {
  passed: boolean;
  gateStatus?: ReviewGateStatus;
  reason?: string;
  interceptedSkill?: string;
  reviewReport?: ReviewReport;
}

export class GateGuard {
  /**
   * 判定指定技能在当前阶段与质检报告下是否准许执行或提议
   */
  public static check(
    skillName: string,
    currentStage: string,
    report?: ReviewReport | null
  ): GateCheckResult {
    // 1. 无质检报告、报告失效(STALE)或非阻断状态(PASS/WARN)，直接放行
    if (!report || report.isStale || report.gateStatus === 'STALE' || report.gateStatus === 'PASS' || report.gateStatus === 'WARN') {
      return { passed: true, gateStatus: report?.gateStatus };
    }

    // 2. 报告不属于当前工序，不产生跨工序误伤，放行
    if (report.stageReviewed && report.stageReviewed !== currentStage) {
      return { passed: true, gateStatus: report.gateStatus };
    }

    // 3. 报告属于当前工序且处于 FAIL 刚性阻断状态
    if (report.gateStatus === 'FAIL') {
      const skillManifest = SkillRegistry.getInstance().get(skillName)?.manifest;
      const skillTargetStage = skillManifest?.targetStage;

      // 允许当前工序内的自愈修复、重新推演与质检对辩
      const isAllowedRecovery =
        (skillManifest && skillTargetStage === currentStage) ||
        skillManifest?.category === 'critic' ||
        skillName === 'critic-review';

      if (isAllowedRecovery) {
        return { passed: true, gateStatus: 'FAIL' };
      }

      const flawCount = report.criticalFlaws?.length || 0;
      const score = report.scores?.overallScore ?? 0;
      return {
        passed: false,
        gateStatus: 'FAIL',
        interceptedSkill: skillName,
        reviewReport: report,
        reason: `当前工序 [${currentStage}] 存在 ${flawCount} 处 CRITICAL 核心缺陷 (审查官总评: ${score}/100)，已刚性阻断推进后续工序 [${skillName}]。请针对漏洞微调设定或发起对辩质询。`,
      };
    }

    return { passed: true };
  }
}
