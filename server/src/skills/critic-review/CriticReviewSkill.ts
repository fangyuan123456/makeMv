/**
 * skills/critic-review/CriticReviewSkill.ts
 * 独立影视审查官与剧本医生挑刺技能包 (Critic Review Skill SSOT)
 *
 * 核心机制：
 * 1. 继承 BaseSkill，纯声明式数据流驱动；
 * 2. 调度做实后的核心智能体 CriticReviewerAgent 进行跨工序全景资产穿透；
 * 3. 产出结构化质检报告、思维链推演与放行门禁 (PASS / WARN / FAIL)；
 * 4. 🌟 单一事实来源 (SSOT)：质检资产由状态黑板 critic_review 供给 DirectorAgent 动态感知，避免污染会话白板。
 */

import { BaseSkill } from '../BaseSkill.js';
import type { SkillManifest, SkillContext } from '../types.js';
import { WorkflowStage } from '../../types/index.js';
import { ProjectStore } from '../../project-store/ProjectStore.js';

import { CriticReviewerAgent } from '../../agents/reviewer/CriticReviewerAgent.js';
import type { ReviewReport, CriticReviewParams } from '../../agents/reviewer/types.js';

export class CriticReviewSkill extends BaseSkill<CriticReviewParams, ReviewReport> {
  public readonly manifest: SkillManifest = {
    name: 'critic-review',
    displayName: '影视独立审查官挑刺质检',
    description: '独立影视审查官与好莱坞剧本医生视角，进行剧情因果律、角色动机、分支张力与视听可行性跨工序全景交叉穿透审计，并出具放行门禁',
    category: 'critic',
    targetStage: WorkflowStage.NARRATIVE_DESIGN, // 默认基底工序，通过 category === 'critic' 支持全工序自适应穿透
    parameters: {
      targetStage: { type: 'string', description: '被审查的聚焦阶段名称' },
      userFeedback: { type: 'string', description: '重点关注的疑虑或挑刺方向' },
    },
  };

  protected async run(
    context: SkillContext<CriticReviewParams>
  ): Promise<{ data: ReviewReport; summary: string }> {
    const { projectId, sessionId, params, abortSignal, userConstraints } = context;

    await this.notifyProgress(context, 15, '审查官正在跨工序拉取故事圣经、定妆照、分场与分镜全景资产快照...');

    // 提取会话中的底线禁忌
    let constraints = userConstraints;
    if ((!constraints || constraints.length === 0) && sessionId) {
      const session = ProjectStore.getInstance().getSession(projectId, sessionId);
      constraints = session?.scratchpad?.userConstraints;
    }

    await this.notifyProgress(context, 40, '正在从剧情因果律、角色防降智、反伪选择、AI视听边界四大维度展开深度推演...');

    // 调度做实后的核心智能体 CriticReviewerAgent 穿透审计
    const reviewer = CriticReviewerAgent.getInstance();
    const report = await reviewer.review({
      projectId,
      targetStage: params.targetStage,
      userConstraints: constraints,
      userFeedback: params.userFeedback,
      abortSignal,
    });

    await this.notifyProgress(context, 85, '审查官正在拟定漏洞自愈修复建议与终审门禁评语...');

    // 🌟 全局状态黑板统一落盘 (SSOT)：将审查报告作为一等资产写入黑板，供 Director 双核博弈闭环感知
    ProjectStore.getInstance().setArtifact(projectId, 'critic_review', report);


    const gateBadge = report.gateStatus === 'PASS' ? '🟢【准许放行】' : report.gateStatus === 'WARN' ? '🟡【建议优化】' : '🔴【刚性阻断】';
    const flawsText = report.criticalFlaws.length > 0
      ? `发现 ${report.criticalFlaws.length} 处关键瑕疵（包含 ${report.criticalFlaws.filter((f) => f.severity === 'CRITICAL').length} 个致命漏洞）`
      : '未发现严重逻辑漏洞';

    const summary = `🧐 独立影视审查官与剧本医生已完成全景交叉质检！\n` +
      `终审门禁：${gateBadge} (综合评分: ${report.scores.overallScore}/100)\n` +
      `分项评分：因果逻辑 ${report.scores.narrativeLogicScore} | 角色动机 ${report.scores.characterDepthScore} | 分支张力 ${report.scores.branchTensionScore} | 视听可行性 ${report.scores.visualFeasibilityScore}\n` +
      `质检结论：${flawsText}。\n终审评语：${report.verdict}`;

    return {
      data: report,
      summary,
    };
  }
}
