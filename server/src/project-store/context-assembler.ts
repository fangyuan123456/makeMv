/**
 * project-store/context-assembler.ts
 * 状态黑板视听工程全景态势与上下文装配器 (Project Context Assembler SSOT)
 * 
 * 职责（法典 0.4 单一事实来源与黑板态势投影）：
 * 1. 动态提取状态黑板 (ProjectStore) 的项目元数据、已落盘资产摘要、审查官各阶段门禁状态；
 * 2. 专门产出 System Instructions 工程事实，彻底剥离历史对话拼贴，消灭跨轮上下文雪崩；
 * 3. 作为全局状态黑板的态势感知视图，供多智能体与各工序统一安全消费。
 */

import { ProjectStore } from './ProjectStore.js';
import { WorkflowStage } from '../types/index.js';
import { STEP_MANIFESTS, getStepManifestByStage } from '../agents/director/generator/constants.js';

export interface AssembledContext {
  projectId: string;
  projectName: string;
  currentStage: string;
  currentStageTitle?: string;
  assetsSummary: string;
  criticGatesSummary: string;
  creativeIdea: string;
  style: string;
  currentStageSop?: string;
  currentStageReviewFocus?: string;
}

export class ContextAssembler {
  private static instance?: ContextAssembler;

  public static getInstance(): ContextAssembler {
    if (!ContextAssembler.instance) {
      ContextAssembler.instance = new ContextAssembler();
    }
    return ContextAssembler.instance;
  }

  /**
   * 为指定项目组装高信噪比视听工程上下文
   */
  public assemble(projectId: string): AssembledContext {
    const store = ProjectStore.getInstance();
    const project = store.getProject(projectId);

    if (!project) {
      return {
        projectId,
        projectName: '未命名项目',
        currentStage: WorkflowStage.NARRATIVE_DESIGN,
        assetsSummary: '项目尚未初始化',
        criticGatesSummary: '无质检记录',
        creativeIdea: '',
        style: '',
      };
    }

    // 1. 抽取资产实际内容高信噪比摘要 (通过 StepManifest.summarizeArtifact 自内聚提取，0 调度硬编码)
    const pipelineManifests = STEP_MANIFESTS
      .filter((m) => m.isPipelineStep && m.order >= 0)
      .sort((a, b) => a.order - b.order);

    const assetsLines: string[] = [];
    for (const m of pipelineManifests) {
      const art = store.getArtifact<any>(projectId, m.stage);
      if (!art) {
        assetsLines.push(`- 【${m.title}】: ⏳ 待生成`);
        continue;
      }

      if (m.summarizeArtifact) {
        const summary = m.summarizeArtifact(art);
        assetsLines.push(`- 【${m.title}】: ${summary}`);
      } else {
        assetsLines.push(`- 【${m.title}】: ✅ 资产已落盘`);
      }
    }

    // 2. 抽取审查官门禁判定与最新缺陷备忘 (SSOT: 对齐当前阶段审计报告与总报告)
    const gatesLines: string[] = [];
    const reviewArtifact =
      store.getArtifact<any>(projectId, `critic_review_${project.currentStage}`) ||
      store.getArtifact<any>(projectId, 'criticReports') ||
      store.getArtifact<any>(projectId, 'critic_review');

    if (!reviewArtifact) {
      gatesLines.push('- 最新质检门禁: 暂无审查记录 (创作者推进工序时可适时提议审查)');
    } else {
      const decision = reviewArtifact.gateStatus || reviewArtifact.gateDecision || 'WARN';
      const score = reviewArtifact.scores?.overallScore ?? reviewArtifact.overallScore ?? '未评分';
      gatesLines.push(`- 最新质检门禁: [${decision}] (综合得分: ${score}/100)`);

      // 提取致命与阻断性瑕疵
      const criticalFlaws = Array.isArray(reviewArtifact.criticalFlaws)
        ? reviewArtifact.criticalFlaws
            .filter((f: any) => f.severity === 'CRITICAL' || f.severity === 'MAJOR')
            .map((f: any) => `[${f.severity}][${f.location || f.dimension}] ${f.description || ''}`)
        : Array.isArray(reviewArtifact.blockingIssues)
        ? reviewArtifact.blockingIssues
        : [];
      if (criticalFlaws.length > 0) {
        gatesLines.push(`  * 刚性阻断缺陷: ${criticalFlaws.join('；')}`);
      }

      // 提取自愈与润色建议
      const suggestions = Array.isArray(reviewArtifact.polishSuggestions)
        ? reviewArtifact.polishSuggestions
        : Array.isArray(reviewArtifact.suggestions)
        ? reviewArtifact.suggestions
        : [];
      if (suggestions.length > 0) {
        gatesLines.push(`  * 剧本医生自愈建议: ${suggestions.join('；')}`);
      }

      if (reviewArtifact.verdict) {
        gatesLines.push(`  * 终审定性评语: ${reviewArtifact.verdict}`);
      }
    }

    const currentManifest = getStepManifestByStage(project.currentStage);

    return {
      projectId,
      projectName: project.title,
      currentStage: project.currentStage,
      currentStageTitle: currentManifest?.title || project.currentStage,
      assetsSummary: assetsLines.join('\n'),
      criticGatesSummary: gatesLines.join('\n'),
      creativeIdea: project.meta?.idea || '',
      style: project.meta?.style || '电影质感，写实光影',
      currentStageSop: currentManifest?.sopGuide,
      currentStageReviewFocus: currentManifest?.reviewFocus,
    };
  }

  /**
   * 为意图路由器 (RouterAgent) 提供轻量、高信噪比的黑板全局态势简报
   */
  public buildRouterBrief(projectId: string): string {
    const store = ProjectStore.getInstance();
    const project = store.getProject(projectId);
    if (!project) return '';

    const artifactKeys = Object.keys(project.stageArtifacts || {});
    return `【当前黑板全局态势】:
- 项目唯一 ID: ${projectId}
- 当前工序阶段: ${project.currentStage}
- 已有视听资产: ${artifactKeys.length > 0 ? artifactKeys.join(', ') : '暂无资产 (处于0到1初始阶段)'}`;
  }

  /**
   * 将项目全景视听事实拼装为 System Instructions 注入给智能体
   */
  public buildSystemInstructions(projectId: string, sessionId?: string): string {
    const ctx = this.assemble(projectId);
    const isCompleted = ctx.currentStage === WorkflowStage.COMPLETED;
    const completedNotice = isCompleted
      ? `\n\n【互动影游母带终局状态 (COMPLETED)】:
⚠️ 本互动影游工程已完成全链路制作与母带封包！当前所有工序已执行完毕。绝对严禁再提议进入下一阶段或发起修改提案（绝对严禁附带任何 <intent> 标签）！请以总导演身份与创作者进行终局互动影游复盘与艺术品鉴。`
      : '';

    return `【全局项目工程态势黑板 (System Context - SSOT)】:
- 当前项目 ID: ${ctx.projectId} (项目名称: ${ctx.projectName})
- 当前所处业务阶段: ${ctx.currentStage} (工序名称: ${ctx.currentStageTitle || ctx.currentStage})
- 故事初始灵感与主旨: ${ctx.creativeIdea || '暂无，等待创作者提供'}
- 视觉风格统领: ${ctx.style}

【当前工序阶段导演 SOP 作业指引】:
${ctx.currentStageSop ? `- 导演工作重心: ${ctx.currentStageSop}` : '- 统筹把控整体视听质量与创作者诉求'}
${ctx.currentStageReviewFocus ? `- 审查打磨焦点: ${ctx.currentStageReviewFocus}` : ''}

【各工序资产落盘全貌】:
${ctx.assetsSummary}

【独立审查官最新审计门禁】:
${ctx.criticGatesSummary}${completedNotice}`;
  }
}
