/**
 * mastra/tools/critic-review/critic-review.tool.ts
 * 独立影视审查官与剧本医生挑刺技能工具 (Mastra Tool SSOT)
 */

import { createTool } from '@mastra/core/tools';
import { LLMRegistry } from '../../../llm/LLMRegistry.js';
import { ProjectStore } from '../../../project-store/ProjectStore.js';
import { WorkflowStage } from '../../../types/index.js';
import {
  CriticReviewToolInputSchema,
  CriticReviewToolOutputSchema,
  CriticAuditReportSchema,
  type CriticAuditReportOutput,
} from './schema.js';
import {
  CRITIC_REVIEWER_SYSTEM_PROMPT,
  buildPanoramicAuditPrompt,
} from './prompt.js';

export const criticReviewTool = createTool({
  id: 'critic-review-tool',
  description: '独立影视审查官与好莱坞剧本医生视角，进行剧情因果律、角色动机、分支张力与视听可行性跨工序全景交叉穿透审计，并出具放行门禁 (PASS / WARN / FAIL)',
  inputSchema: CriticReviewToolInputSchema,
  outputSchema: CriticReviewToolOutputSchema,
  requireApproval: true,
  execute: async (input) => {
    const { projectId, targetStage, userFeedback } = input;

    if (!projectId) {
      throw new Error('[criticReviewTool] 执行失败: projectId 不能为空');
    }

    const projectStore = ProjectStore.getInstance();
    const project = projectStore.getProject(projectId);
    const activeStage = targetStage || project?.currentStage || WorkflowStage.NARRATIVE_DESIGN;
    const projectName = project?.title || '未命名影游项目';

    // 1. 穿透拉取全链路核心资产快照
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

    // 2. 构造全景穿透审计 Prompt
    const prompt = buildPanoramicAuditPrompt(
      projectName,
      activeStage,
      panoramicAssets,
      undefined,
      userFeedback
    );

    // 3. 调用统一大模型服务执行严苛推演
    const llm = LLMRegistry.get();
    const rawReport = await llm.generateObject<CriticAuditReportOutput>(
      prompt,
      CriticAuditReportSchema,
      CRITIC_REVIEWER_SYSTEM_PROMPT,
      {
        stage: `critic_audit_${activeStage}`,
        temperature: 0.2, // 低温保持绝对冷酷与客观
      }
    );

    // 4. 标准归一化评分与放行门禁刚性计算
    const subScores = [
      rawReport.scores?.narrativeLogicScore,
      rawReport.scores?.characterDepthScore,
      rawReport.scores?.branchTensionScore,
      rawReport.scores?.visualFeasibilityScore,
    ].filter((s): s is number => typeof s === 'number');

    const computedOverall = subScores.length > 0
      ? Math.round(subScores.reduce((a, b) => a + b, 0) / subScores.length)
      : 75;

    const overallScore = Math.min(100, Math.max(0, Number(rawReport.scores?.overallScore ?? computedOverall)));
    const flawsList = Array.isArray(rawReport.criticalFlaws) ? rawReport.criticalFlaws : [];
    const hasCriticalFlaw = flawsList.some((f) => f.severity === 'CRITICAL');

    let gateStatus: 'PASS' | 'WARN' | 'FAIL' = 'WARN';
    if (overallScore >= 80 && !hasCriticalFlaw) {
      gateStatus = 'PASS';
    } else if (overallScore < 60 || hasCriticalFlaw) {
      gateStatus = 'FAIL';
    }

    const finalReport: CriticAuditReportOutput = {
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
      criticalFlaws: flawsList.map((f, idx) => ({
        severity: f.severity || 'MAJOR',
        dimension: f.dimension || 'LOGIC',
        location: f.location || '全局戏剧主干',
        description: f.description || '',
        suggestion: f.suggestion || '',
      })),
      polishSuggestions: Array.isArray(rawReport.polishSuggestions) ? rawReport.polishSuggestions : [],
      verdict: rawReport.verdict || '完成全景交叉质检审查。',
    };

    // 5. 状态黑板落盘 SSOT (同时保存全局槽位与分阶段隔离槽位)
    projectStore.setArtifact(projectId, 'critic_review', finalReport);
    projectStore.setArtifact(projectId, `critic_review_${activeStage}`, finalReport);

    const gateBadge = finalReport.gateStatus === 'PASS'
      ? '🟢【准许放行】'
      : finalReport.gateStatus === 'WARN'
      ? '🟡【建议优化】'
      : '🔴【刚性阻断】';

    const flawsText = finalReport.criticalFlaws.length > 0
      ? `发现 ${finalReport.criticalFlaws.length} 处关键瑕疵（包含 ${finalReport.criticalFlaws.filter((f) => f.severity === 'CRITICAL').length} 个致命漏洞）`
      : '未发现严重逻辑漏洞';

    const summary = `🧐 独立影视审查官与剧本医生已完成全景交叉质检！\n` +
      `终审门禁：${gateBadge} (综合评分: ${finalReport.scores.overallScore}/100)\n` +
      `分项评分：因果逻辑 ${finalReport.scores.narrativeLogicScore} | 角色动机 ${finalReport.scores.characterDepthScore} | 分支张力 ${finalReport.scores.branchTensionScore} | 视听可行性 ${finalReport.scores.visualFeasibilityScore}\n` +
      `质检结论：${flawsText}。\n终审评语：${finalReport.verdict}`;

    return {
      success: true,
      report: finalReport,
      summary,
    };
  },
});
