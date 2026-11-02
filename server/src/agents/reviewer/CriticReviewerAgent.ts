/**
 * agents/reviewer/CriticReviewerAgent.ts
 * 独立批判性审查官与剧本医生智能体核心实体 (Critic Reviewer Agent SSOT)
 *
 * 核心机制（名副其实的双核智能体）：
 * 1. 跨工序全景资产穿透审计 (Cross-Stage Asset Auditor)；
 * 2. 思维链深度批判性推演与四大维度工业级量化打分；
 * 3. 终审刚性门禁决策 (PASS / WARN / FAIL)；
 * 4. 交互式质询与剧本辩论能力 (具备多轮连续对辩记忆，100% 持久化辩护记录)；
 * 5. 多工序质检历史分槽位隔离与时效自愈。
 */

import fs from 'fs';
import path from 'path';
import { LLMRegistry } from '../../llm/LLMRegistry.js';
import { ProjectStore, ProposalStore } from '../../project-store/index.js';
import { WorkflowStage } from '../../types/index.js';
import type {
  ReviewInput,
  ReviewReport,
  ReviewIssue,
  ReviewGateStatus,
  CriticDialogInput,
  CriticDialogReply,
} from './types.js';
import {
  CRITIC_REVIEWER_SYSTEM_PROMPT,
  buildPanoramicAuditPrompt,
  CRITIC_DIALOG_SYSTEM_PROMPT,
  buildCriticDialogPrompt,
} from './prompt.js';
import {
  CriticAuditReportSchema,
  CriticDialogReplySchema,
  type CriticAuditReportOutput,
  type CriticDialogReplyOutput,
} from './schema.js';

export class CriticReviewerAgent {
  private static instance?: CriticReviewerAgent;

  public static getInstance(): CriticReviewerAgent {
    if (!CriticReviewerAgent.instance) {
      CriticReviewerAgent.instance = new CriticReviewerAgent();
    }
    return CriticReviewerAgent.instance;
  }

  /**
   * 🌟 发起跨工序全景交叉深度审查
   */
  public async review(input: ReviewInput): Promise<ReviewReport> {
    const { projectId, targetStage, userConstraints, userFeedback, abortSignal } = input;
    const projectStore = ProjectStore.getInstance();
    const project = projectStore.getProject(projectId);

    const activeStage = targetStage || project?.currentStage || WorkflowStage.NARRATIVE_DESIGN;
    const projectName = project?.title || '未命名影游项目';

    // 1. 穿透拉取全链路核心资产快照 (全链路 7 大工序无遗漏覆盖)
    const storyBible = projectStore.getArtifact(projectId, WorkflowStage.NARRATIVE_DESIGN) || {
      meta: project?.meta,
      note: '世界观推演初稿',
    };
    const characterDesigns = projectStore.getArtifact(projectId, WorkflowStage.CHARACTER_DESIGN);
    const sceneScript = projectStore.getArtifact(projectId, WorkflowStage.SCENE_SCRIPT);
    const storyboard = projectStore.getArtifact(projectId, WorkflowStage.STORYBOARD);
    const keyframes = projectStore.getArtifact(projectId, WorkflowStage.KEYFRAME_REFERENCE);
    const videoClips = projectStore.getArtifact(projectId, WorkflowStage.VIDEO_PRODUCTION);
    const fmvPackaging = projectStore.getArtifact(projectId, WorkflowStage.FMV_PACKAGING);

    const panoramicAssets = {
      storyBible,
      characterDesigns,
      sceneScript,
      storyboard,
      keyframes,
      videoClips,
      fmvPackaging,
    };

    // 2. 组装全景穿透审计 Prompt
    const prompt = buildPanoramicAuditPrompt(
      projectName,
      activeStage,
      panoramicAssets,
      userConstraints,
      userFeedback
    );

    // 3. 规约严格的工业级评审 Schema 并执行推演
    const llm = LLMRegistry.get();
    const rawReport = await llm.generateObject<CriticAuditReportOutput>(
      prompt,
      CriticAuditReportSchema,
      CRITIC_REVIEWER_SYSTEM_PROMPT,
      {
        stage: `critic_audit_${activeStage}`,
        abortSignal,
        temperature: 0.2, // 低温保持绝对冷酷与客观
      }
    );

    // 4. 标准归一化保证类型健全与放行门禁刚性计算
    const overallScore = Math.min(100, Math.max(0, Number(rawReport.scores?.overallScore ?? 75)));
    const flawsList = Array.isArray(rawReport.criticalFlaws) ? rawReport.criticalFlaws : [];
    const hasCriticalFlaw = flawsList.some((f: any) => f.severity === 'CRITICAL');

    let gateStatus: ReviewGateStatus = (rawReport.gateStatus as ReviewGateStatus) || 'WARN';
    if (overallScore >= 80 && !hasCriticalFlaw) {
      gateStatus = 'PASS';
    } else if (overallScore < 60 || hasCriticalFlaw) {
      gateStatus = 'FAIL';
    }

    const report: ReviewReport = {
      projectName,
      stageReviewed: activeStage,
      gateStatus,
      thoughtChain: rawReport.thoughtChain || '审查官已完成因果逻辑链条推演。',
      crossStageInsights: rawReport.crossStageInsights,
      scores: {
        narrativeLogicScore: Number(rawReport.scores?.narrativeLogicScore ?? 70),
        characterDepthScore: Number(rawReport.scores?.characterDepthScore ?? 70),
        branchTensionScore: Number(rawReport.scores?.branchTensionScore ?? 70),
        visualFeasibilityScore: Number(rawReport.scores?.visualFeasibilityScore ?? 70),
        overallScore,
      },
      criticalFlaws: flawsList.map((f: any, idx: number) => ({
        id: `flaw_${idx + 1}`,
        severity: f.severity || 'MAJOR',
        dimension: f.dimension || 'LOGIC',
        location: f.location || '全局戏剧主干',
        description: f.description || '',
        suggestion: f.suggestion || '',
      })),
      polishSuggestions: Array.isArray(rawReport.polishSuggestions) ? rawReport.polishSuggestions : [],
      verdict: rawReport.verdict || '审阅完成',
      reviewedAt: new Date().toISOString(),
      debateLogs: [],
    };

    // 5. 状态黑板与本地磁盘双向落盘 (全局最新槽位 + 工序专用槽位双持久化)
    projectStore.setArtifact(projectId, 'critic_review', report);
    projectStore.setArtifact(projectId, `critic_review_${activeStage}`, report);
    this.exportReportToDisk(projectId, report);

    return report;
  }

  /**
   * 🌟 获取当前有效审查报告，支持按工序阶段隔离与失效检测
   */
  public getEffectiveReport(projectId: string, stage?: string): ReviewReport | null {
    const projectStore = ProjectStore.getInstance();
    
    // 优先读取指定阶段历史报告，缺省读取全局最新报告
    const report =
      (stage ? projectStore.getArtifact<ReviewReport>(projectId, `critic_review_${stage}`) : null) ||
      projectStore.getArtifact<ReviewReport>(projectId, 'critic_review');

    if (!report) return null;

    const reviewedStage = report.stageReviewed;
    if (reviewedStage) {
      const stageArtifact = projectStore.getArtifact<any>(projectId, reviewedStage as any);
      const artifactTime = stageArtifact?.updatedAt || stageArtifact?.createdAt;
      if (
        artifactTime &&
        report.reviewedAt &&
        new Date(artifactTime).getTime() > new Date(report.reviewedAt).getTime()
      ) {
        return {
          ...report,
          gateStatus: 'STALE',
          isStale: true,
          staleReason: `工序【${reviewedStage}】产物已于 ${artifactTime} 重新生成或微调，旧质检告诫已自动失效，建议重新质检。`,
        };
      }
    }

    return report;
  }

  /**
   * 🌟 创作者与审查官的交互式辩论与质询接口 (具备多轮连续交锋记忆与 100% 驳回保全)
   */
  public async chat(input: CriticDialogInput): Promise<CriticDialogReply> {
    const { projectId, sessionId, userMessage, targetStage, currentReport, abortSignal } = input;
    const projectStore = ProjectStore.getInstance();
    const project = projectStore.getProject(projectId);

    // 🌟 审查官记忆双重保障：若未显式透传 currentReport，优先读取该阶段最新有效报告
    const effectiveReport = currentReport || this.getEffectiveReport(projectId, targetStage) || undefined;

    const activeStage = targetStage || effectiveReport?.stageReviewed || project?.currentStage || WorkflowStage.NARRATIVE_DESIGN;
    const projectName = project?.title || '未命名影游项目';

    // 🌟 核心突破：提取历史对辩记录作为多轮上下文，赋予审查官连续对话记忆 (滑动窗口保留最近6轮交锋防膨胀)
    const recentDebateLogs = (effectiveReport?.debateLogs || []).slice(-6);
    const dialogHistory = recentDebateLogs.flatMap((log) => [
      { role: 'user', content: log.userMessage },
      { role: 'assistant', content: log.reply },
    ]);

    const prompt = buildCriticDialogPrompt(
      projectName,
      activeStage,
      userMessage,
      effectiveReport,
      dialogHistory
    );

    const llm = LLMRegistry.get();
    const result = await llm.generateObject<CriticDialogReplyOutput>(
      prompt,
      CriticDialogReplySchema,
      CRITIC_DIALOG_SYSTEM_PROMPT,
      {
        stage: `critic_dialog_${activeStage}`,
        abortSignal,
        temperature: 0.3,
      }
    );

    // 🌟 辩护真收敛：无论辩护是否被采纳，对辩记录 100% 持久化沉淀入库 (杜绝失败辩护静默吞噬与回退越权)
    try {
      const baseReport = effectiveReport;
      const rawFlaws = result.adjustedFlaws || baseReport?.criticalFlaws || [];
      const currentFlaws: ReviewIssue[] = rawFlaws.map((f: any, idx: number) => ({
        id: f.id || `flaw_adj_${idx + 1}`,
        severity: f.severity || 'MAJOR',
        dimension: f.dimension || 'LOGIC',
        location: f.location || '全局戏剧主干',
        description: f.description || '',
        suggestion: f.suggestion || '',
      }));

      // 🌟 刚性门禁回退加固 (Fail-Fast Gate Safeguard)：辩护失败坚决保持 FAIL，杜绝空值误判为 PASS 破防
      let fallbackStatus: ReviewGateStatus = result.isDefenseAccepted
        ? 'PASS'
        : (baseReport?.gateStatus || 'FAIL');
      const newGateStatus = (result.reassessedGateStatus || fallbackStatus) as ReviewGateStatus;

      let finalScores = baseReport?.scores ? { ...baseReport.scores } : {
        narrativeLogicScore: result.isDefenseAccepted ? 80 : 50,
        characterDepthScore: result.isDefenseAccepted ? 80 : 50,
        branchTensionScore: result.isDefenseAccepted ? 80 : 50,
        visualFeasibilityScore: result.isDefenseAccepted ? 80 : 50,
        overallScore: result.isDefenseAccepted ? 80 : 50,
      };
      let finalFlaws: ReviewIssue[] = currentFlaws;

      const isDefenseCleared = result.isDefenseAccepted || newGateStatus === 'PASS' || newGateStatus === 'WARN';

      if (isDefenseCleared) {
        if (newGateStatus === 'PASS') {
          finalScores = {
            narrativeLogicScore: Math.max(80, finalScores.narrativeLogicScore),
            characterDepthScore: Math.max(80, finalScores.characterDepthScore),
            branchTensionScore: Math.max(80, finalScores.branchTensionScore),
            visualFeasibilityScore: Math.max(80, finalScores.visualFeasibilityScore),
            overallScore: Math.max(80, finalScores.overallScore),
          };
          finalFlaws = finalFlaws.map((f: any) =>
            f.severity === 'CRITICAL' ? { ...f, severity: 'MINOR' as const, description: `[辩护已澄清] ${f.description}` } : f
          );
        } else if (newGateStatus === 'WARN') {
          finalScores = {
            narrativeLogicScore: Math.max(65, finalScores.narrativeLogicScore),
            characterDepthScore: Math.max(65, finalScores.characterDepthScore),
            branchTensionScore: Math.max(65, finalScores.branchTensionScore),
            visualFeasibilityScore: Math.max(65, finalScores.visualFeasibilityScore),
            overallScore: Math.max(65, finalScores.overallScore),
          };
          finalFlaws = finalFlaws.map((f: any) =>
            f.severity === 'CRITICAL' ? { ...f, severity: 'MAJOR' as const, description: `[辩护已澄清] ${f.description}` } : f
          );
        }

        // 🌟 单一事实来源 (SSOT)：审查告诫统一由状态黑板 critic_review 供给，白板专注创作者纯净意图，无旧胶水残留

        // 🌟 门禁阻断卡片自愈同步：当辩护放行后，自动将历史会话中悬挂的门禁拦截待确认卡片标记为已解除 (cleared)
        try {
          const sessions = projectStore.listSessions(projectId);
          for (const sess of sessions) {
            let sessionUpdated = false;
            const msgs = projectStore.getMessages(projectId, sess.sessionId);
            for (const msg of msgs) {
              const proposal = msg.actionProposal;
              if (
                proposal &&
                proposal.status === 'pending' &&
                (proposal.isGateIntercept || proposal.actionType === 'CRITIC_DEBATE' || proposal.skill === 'critic-review') &&
                (!proposal.payload?.stage || proposal.payload?.stage === activeStage)
              ) {
                proposal.status = 'dismissed';
                proposal.description = `[🛡️ 门禁已通过辩护解除] 审查官已听取创作者说明并裁决放行 (${newGateStatus})。`;
                sessionUpdated = true;
              }
            }
            if (sessionUpdated) {
              projectStore.saveMessages(projectId, sess.sessionId, msgs);
            }
          }
        } catch (proposalCleanErr) {
          console.warn('[CriticReviewerAgent] 自愈更新门禁阻断卡片警告:', proposalCleanErr);
        }

        // 🌟 独立提案实体原子级解除 (ProposalStore SSOT)
        ProposalStore.getInstance().dismissProposalsForStage(
          projectId,
          activeStage,
          `[🛡️ 门禁已通过辩护解除] 审查官已听取创作者说明并裁决放行 (${newGateStatus})。`
        );
      }

      // 🌟 追加辩驳历史记录 (DebateLogs SSOT)
      const newLog = {
        userMessage,
        reply: result.reply || '审查官已听取您的说明。',
        isDefenseAccepted: Boolean(result.isDefenseAccepted),
        reassessedGateStatus: newGateStatus,
        timestamp: new Date().toISOString(),
      };
      const debateLogs = [...(baseReport?.debateLogs || []), newLog];

      const updatedReport: ReviewReport = {
        projectName,
        stageReviewed: activeStage,
        gateStatus: newGateStatus,
        thoughtChain: baseReport?.thoughtChain || '创作者已就争议漏洞完成申诉与辩护。',
        scores: finalScores,
        criticalFlaws: finalFlaws,
        polishSuggestions: baseReport?.polishSuggestions || [],
        verdict: `【辩护已审定】${result.reply}`,
        reviewedAt: new Date().toISOString(),
        debateLogs,
      };

      projectStore.setArtifact(projectId, 'critic_review', updatedReport);
      projectStore.setArtifact(projectId, `critic_review_${activeStage}`, updatedReport);
      this.exportReportToDisk(projectId, updatedReport);
    } catch (err) {
      console.warn('[CriticReviewerAgent] 辩护后同步报告与日志警告:', err);
    }

    return {
      reply: result.reply || '审查官已听取您的说明。',
      isDefenseAccepted: Boolean(result.isDefenseAccepted),
      reassessedGateStatus: result.reassessedGateStatus,
      adjustedFlaws: result.adjustedFlaws
        ? result.adjustedFlaws.map((f) => ({
            location: f.location,
            severity: f.severity,
            description: f.description,
            suggestion: f.suggestion || '',
          }))
        : undefined,
    };
  }

  /**
   * 将质检报告持久化到工程本地磁盘
   */
  private exportReportToDisk(projectId: string, report: ReviewReport): void {
    try {
      const store = ProjectStore.getInstance();
      const projectDir = store.getProjectDir(projectId);
      const reviewDir = path.join(projectDir, 'review');
      if (!fs.existsSync(reviewDir)) {
        fs.mkdirSync(reviewDir, { recursive: true });
      }

      const timestamp = Date.now();
      const jsonFile = path.join(reviewDir, `review_${report.stageReviewed}_${timestamp}.json`);
      fs.writeFileSync(jsonFile, JSON.stringify(report, null, 2), 'utf-8');

      const gateBadge = report.gateStatus === 'PASS' ? '🟢【准许放行】' : report.gateStatus === 'WARN' ? '🟡【建议优化】' : '🔴【刚性阻断】';

      const mdContent = `# 🧐 独立影视审查官与剧本医生全景质检报告

> **项目名称**: 《${report.projectName}》  
> **审阅工序**: ${report.stageReviewed}  
> **终审门禁**: **${gateBadge}** (综合评分: ${report.scores.overallScore} / 100)  
> **审阅时间**: ${report.reviewedAt}

---

## 维度量化评分 (0-100)
* **因果逻辑严密性 (反机械降神)**: ${report.scores.narrativeLogicScore} / 100
* **角色动机可信度 (反强行降智)**: ${report.scores.characterDepthScore} / 100
* **分支两难张力 (反伪选择欺骗)**: ${report.scores.branchTensionScore} / 100
* **视听落地可行性 (反抽象模型崩坏)**: ${report.scores.visualFeasibilityScore} / 100

---

## 终审裁决评语
> ${report.verdict}

---

## 审读官推演思维链 (Thought Chain)
${report.thoughtChain}

---

## 关键瑕疵与漏洞清单 (${report.criticalFlaws.length} 处)
${report.criticalFlaws.length === 0 ? '* 表现极佳，无显著硬伤。' : report.criticalFlaws.map((f, i) => `### ${i + 1}. [${f.severity}] [${f.dimension}] ${f.location}
* **缺陷因果剖析**: ${f.description}
* **剧本医生自愈建议**: ${f.suggestion}
`).join('\n')}

---

## 历史辩护与对辩交锋记录 (${(report.debateLogs || []).length} 轮)
${(report.debateLogs || []).length === 0 ? '* 暂无辩护交锋记录。' : report.debateLogs!.map((d, i) => `### 轮次 ${i + 1} (${d.timestamp})
* **创作者辩解**: ${d.userMessage}
* **审查官裁定**: ${d.reply}
* **判定状态**: ${d.isDefenseAccepted ? '✔ 辩护成立' : '✖ 驳回辩解'}
`).join('\n')}
`;

      const mdFile = path.join(reviewDir, `review_${report.stageReviewed}.md`);
      fs.writeFileSync(mdFile, mdContent, 'utf-8');
    } catch (err) {
      console.warn('[CriticReviewerAgent] 持久化审查报告警告:', err);
    }
  }
}
