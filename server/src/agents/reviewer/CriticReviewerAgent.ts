/**
 * agents/reviewer/CriticReviewerAgent.ts
 * 独立批判性审查官与剧本医生智能体核心实体 (Critic Reviewer Agent SSOT)
 *
 * 核心机制（名副其实的双核智能体）：
 * 1. 跨工序全景资产穿透审计 (Cross-Stage Asset Auditor)；
 * 2. 思维链深度批判性推演与四大维度工业级量化打分；
 * 3. 终审刚性门禁决策 (PASS / WARN / FAIL)；
 * 4. 交互式质询与剧本辩论能力 (Interactive Critic Dialog)；
 * 5. 本地评审库物理文件持久化与自愈建议闭环。
 */

import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { LLMRegistry } from '../../llm/LLMRegistry.js';
import { ProjectStore } from '../../project-store/ProjectStore.js';
import { SessionStore } from '../../chat/session/SessionStore.js';
import { WorkflowStage } from '../../types/index.js';
import type {
  ReviewInput,
  ReviewReport,
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

    // 3. 规约严格的工业级评审 Schema
    const schema = {
      type: 'object',
      properties: {
        projectName: { type: 'string' },
        stageReviewed: { type: 'string' },
        thoughtChain: {
          type: 'string',
          description: '审查官全景推演思维链：详尽阐述因果断裂分析过程',
        },
        crossStageInsights: {
          type: 'object',
          properties: {
            characterConsistency: { type: 'string' },
            branchValidity: { type: 'string' },
            visualFeasibility: { type: 'string' },
          },
          required: ['characterConsistency', 'branchValidity', 'visualFeasibility'],
        },
        gateStatus: { type: 'string', enum: ['PASS', 'WARN', 'FAIL'] },
        scores: {
          type: 'object',
          properties: {
            narrativeLogicScore: { type: 'number' },
            characterDepthScore: { type: 'number' },
            branchTensionScore: { type: 'number' },
            visualFeasibilityScore: { type: 'number' },
            overallScore: { type: 'number' },
          },
          required: [
            'narrativeLogicScore',
            'characterDepthScore',
            'branchTensionScore',
            'visualFeasibilityScore',
            'overallScore',
          ],
        },
        criticalFlaws: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              severity: { type: 'string', enum: ['CRITICAL', 'MAJOR', 'MINOR'] },
              dimension: { type: 'string', enum: ['LOGIC', 'CHARACTER', 'INTERACTIVE', 'VISUAL'] },
              location: { type: 'string' },
              description: { type: 'string' },
              suggestion: { type: 'string' },
            },
            required: ['severity', 'dimension', 'location', 'description', 'suggestion'],
          },
        },
        polishSuggestions: {
          type: 'array',
          items: { type: 'string' },
        },
        verdict: { type: 'string' },
      },
      required: [
        'thoughtChain',
        'crossStageInsights',
        'gateStatus',
        'scores',
        'criticalFlaws',
        'polishSuggestions',
        'verdict',
      ],
    };

    const llm = LLMRegistry.get();
    const rawReport = await llm.generateObject<any>(
      prompt,
      schema,
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
    };

    // 5. 状态黑板与本地磁盘双向落盘 (SSOT)
    projectStore.setArtifact(projectId, 'critic_review', report);
    this.exportReportToDisk(projectId, report);

    return report;
  }

  /**
   * 🌟 获取当前有效审查报告，自动识别因产物重新生成而失效的时效性 (法典隐患七治理)
   */
  public getEffectiveReport(projectId: string): ReviewReport | null {
    const projectStore = ProjectStore.getInstance();
    const report = projectStore.getArtifact<ReviewReport>(projectId, 'critic_review');
    if (!report) return null;

    const reviewedStage = report.stageReviewed;
    if (reviewedStage) {
      const stageArtifact = projectStore.getArtifact<any>(projectId, reviewedStage as any);
      if (
        stageArtifact?.createdAt &&
        report.reviewedAt &&
        new Date(stageArtifact.createdAt).getTime() > new Date(report.reviewedAt).getTime()
      ) {
        return {
          ...report,
          gateStatus: 'STALE',
          isStale: true,
          staleReason: `工序【${reviewedStage}】产物已于 ${stageArtifact.createdAt} 重新生成，旧质检告诫已自动失效，建议重新质检。`,
        };
      }
    }

    return report;
  }

  /**
   * 🌟 创作者与审查官的交互式辩论与质询接口
   */
  public async chat(input: CriticDialogInput): Promise<CriticDialogReply> {
    const { projectId, sessionId, userMessage, targetStage, currentReport, abortSignal } = input;
    const projectStore = ProjectStore.getInstance();
    const project = projectStore.getProject(projectId);

    // 🌟 审查官记忆双重保障：若未显式透传 currentReport，主动向状态黑板读取最新有效报告 (消灭失忆)
    const effectiveReport = currentReport || this.getEffectiveReport(projectId) || undefined;

    const activeStage = targetStage || effectiveReport?.stageReviewed || project?.currentStage || WorkflowStage.NARRATIVE_DESIGN;
    const projectName = project?.title || '未命名影游项目';

    const prompt = buildCriticDialogPrompt(
      projectName,
      activeStage,
      userMessage,
      effectiveReport
    );

    const schema = {
      type: 'object',
      properties: {
        reply: {
          type: 'string',
          description: '审阅官针对创作者辩护的犀利专业答复，剖析其戏剧自洽性',
        },
        isDefenseAccepted: {
          type: 'boolean',
          description: '创作者的解释是否符合戏剧因果律从而被审查官采纳',
        },
        reassessedGateStatus: {
          type: 'string',
          enum: ['PASS', 'WARN', 'FAIL'],
        },
        adjustedFlaws: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              location: { type: 'string' },
              severity: { type: 'string', enum: ['CRITICAL', 'MAJOR', 'MINOR'] },
              description: { type: 'string' },
              suggestion: { type: 'string' },
            },
          },
        },
      },
      required: ['reply', 'isDefenseAccepted'],
    };

    const llm = LLMRegistry.get();
    const result = await llm.generateObject<any>(
      prompt,
      schema,
      CRITIC_DIALOG_SYSTEM_PROMPT,
      {
        stage: `critic_dialog_${activeStage}`,
        abortSignal,
        temperature: 0.3,
      }
    );

    // 🌟 辩护真收敛：若辩护被采纳或门禁状态改变，真实同步写回磁盘 review/ 报告与状态黑板
    if (result.isDefenseAccepted || result.reassessedGateStatus) {
      try {
        const reviewDir = path.join(projectStore.getProjectDir(projectId), 'review');
        const mdFile = path.join(reviewDir, `review_${activeStage}.md`);

        // 读取原有或最新的有效 report 作为基底合并
        const baseReport = effectiveReport;
        const currentFlaws = result.adjustedFlaws || baseReport?.criticalFlaws || [];
        const newGateStatus = (result.reassessedGateStatus || (result.isDefenseAccepted ? 'PASS' : baseReport?.gateStatus) || 'PASS') as ReviewGateStatus;

        const updatedReport: ReviewReport = {
          projectName,
          stageReviewed: activeStage,
          gateStatus: newGateStatus,
          thoughtChain: baseReport?.thoughtChain || '创作者已就争议漏洞完成申诉与辩护。',
          scores: baseReport?.scores || {
            narrativeLogicScore: 85,
            characterDepthScore: 85,
            branchTensionScore: 85,
            visualFeasibilityScore: 85,
            overallScore: 85,
          },
          criticalFlaws: currentFlaws,
          polishSuggestions: baseReport?.polishSuggestions || [],
          verdict: `【辩护已审定】${result.reply}`,
          reviewedAt: new Date().toISOString(),
        };

        projectStore.setArtifact(projectId, 'critic_review', updatedReport);
        this.exportReportToDisk(projectId, updatedReport);

        // 🌟 白板自愈解禁：辩护被采纳后，自动从会话白板中清除对应的刚性告诫约束
        if (result.isDefenseAccepted) {
          try {
            const sessionStore = SessionStore.getInstance();
            const sessions = sessionStore.listSessions(projectId);
            for (const sess of sessions) {
              if (sess.scratchpad && Array.isArray(sess.scratchpad.userConstraints)) {
                sess.scratchpad.userConstraints = sess.scratchpad.userConstraints.filter(
                  (c) => !c.includes('[审查官告诫]')
                );
                sessionStore.saveSession(sess);
              }
            }
          } catch (sessionErr) {
            console.warn('[CriticReviewerAgent] 白板告诫自愈清理异常:', sessionErr);
          }
        }
      } catch (err) {
        console.warn('[CriticReviewerAgent] 辩护后同步磁盘报告警告:', err);
      }
    }

    return {
      reply: result.reply || '审查官已听取您的说明。',
      isDefenseAccepted: Boolean(result.isDefenseAccepted),
      reassessedGateStatus: result.reassessedGateStatus,
      adjustedFlaws: result.adjustedFlaws,
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

## 跨工序全景交叉洞察 (Cross-Stage Insights)
* **角色跨场次人设/物种一致性**: ${report.crossStageInsights?.characterConsistency || '未见异常'}
* **互动分支有效性**: ${report.crossStageInsights?.branchValidity || '未见异常'}
* **视听落地可行性**: ${report.crossStageInsights?.visualFeasibility || '未见异常'}

---

## 关键瑕疵与漏洞清单 (${report.criticalFlaws.length} 处)
${report.criticalFlaws.length === 0 ? '* 表现极佳，无显著硬伤。' : report.criticalFlaws.map((f, i) => `### ${i + 1}. [${f.severity}] [${f.dimension}] ${f.location}
* **缺陷因果剖析**: ${f.description}
* **剧本医生自愈建议**: ${f.suggestion}
`).join('\n')}

---

## 针对性结构优化建议
${report.polishSuggestions.map((s) => `- ${s}`).join('\n')}
`;

      const mdFile = path.join(reviewDir, `review_${report.stageReviewed}.md`);
      fs.writeFileSync(mdFile, mdContent, 'utf-8');
    } catch (err) {
      console.warn('[CriticReviewerAgent] 持久化审查报告警告:', err);
    }
  }
}
