/**
 * mastra/agents/context-assembler.ts
 * 导演智能体全景视听上下文装配器 (Director Context Assembler SSOT)
 * 
 * 职责：
 * 动态提取项目状态黑板、已落盘资产摘要、审查官各阶段门禁状态，消除模型上下文盲区。
 */

import { ProjectStore } from '../../project-store/ProjectStore.js';
import { WorkflowStage } from '../../types/index.js';

export interface AssembledContext {
  projectId: string;
  projectName: string;
  currentStage: string;
  assetsSummary: string;
  criticGatesSummary: string;
  creativeIdea: string;
  style: string;
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

    const stages = [
      { id: WorkflowStage.NARRATIVE_DESIGN, label: '叙事架构 (Story Bible)' },
      { id: WorkflowStage.CHARACTER_DESIGN, label: '角色定妆 (Character Portrait)' },
      { id: WorkflowStage.SCENE_SCRIPT, label: '分场文学剧本 (Scene Script)' },
      { id: WorkflowStage.STORYBOARD, label: '视听镜头分镜 (Storyboard)' },
      { id: WorkflowStage.KEYFRAME_REFERENCE, label: '关键帧参考图 (Keyframe Reference)' },
      { id: WorkflowStage.VIDEO_PRODUCTION, label: '动态视频切片 (Video Production)' },
      { id: WorkflowStage.FMV_PACKAGING, label: '互动母带打包 (FMV Packaging)' },
    ];

    // 1. 抽取资产实际内容高信噪比摘要
    const assetsLines: string[] = [];
    for (const s of stages) {
      const art = store.getArtifact<any>(projectId, s.id);
      if (!art) {
        assetsLines.push(`- 【${s.label}】: ⏳ 待生成`);
        continue;
      }

      // 根据工序提取有血有肉的内容，告别单纯的 Ready/Pending
      if (s.id === WorkflowStage.NARRATIVE_DESIGN && art.goldenSpine) {
        const charNames = Array.isArray(art.characters) ? art.characters.map((c: any) => c.name).join('、') : '无';
        const endings = art.storyGraph?.endingsCount ?? '未知';
        assetsLines.push(`- 【${s.label}】: ✅ 已就绪 | 核心角色: [${charNames}] | 故事收束终局数: ${endings} 个`);
      } else if (s.id === WorkflowStage.CHARACTER_DESIGN && art.portraits) {
        assetsLines.push(`- 【${s.label}】: ✅ 已就绪 | 已渲染定妆角色数: ${art.portraits.length} 位`);
      } else if (s.id === WorkflowStage.STORYBOARD && art.shots) {
        assetsLines.push(`- 【${s.label}】: ✅ 已就绪 | 规划镜头总数: ${art.shots.length} 镜`);
      } else if (s.id === WorkflowStage.VIDEO_PRODUCTION && art.videos) {
        assetsLines.push(`- 【${s.label}】: ✅ 已就绪 | 渲染视频切片: ${art.videos.length} 段`);
      } else if (s.id === WorkflowStage.FMV_PACKAGING) {
        assetsLines.push(`- 【${s.label}】: ✅ 已完成 | 互动母带总时长: ${art.playableDurationSec ?? 0} 秒`);
      } else {
        assetsLines.push(`- 【${s.label}】: ✅ 已落盘`);
      }
    }

    // 2. 抽取分阶段审查官质检门禁 (Stage-Isolated Critic Gates)
    const gatesLines: string[] = [];
    for (const s of stages) {
      const stageReport = store.getArtifact<any>(projectId, `critic_review_${s.id}`);
      if (stageReport) {
        gatesLines.push(`- ${s.label}: ${stageReport.gateStatus} (综合打分: ${stageReport.scores?.overallScore ?? 'N/A'}, 关键瑕疵: ${stageReport.criticalFlaws?.length ?? 0}项)`);
      }
    }

    // 全局兜底检查
    if (gatesLines.length === 0) {
      const legacyReport = store.getArtifact<any>(projectId, 'critic_review');
      if (legacyReport) {
        gatesLines.push(`- 全局审查: ${legacyReport.gateStatus} (打分: ${legacyReport.scores?.overallScore ?? 'N/A'})`);
      } else {
        gatesLines.push('- 暂无质检记录 (所有工序尚未触发审查)');
      }
    }

    return {
      projectId,
      projectName: project.title,
      currentStage: project.currentStage,
      assetsSummary: assetsLines.join('\n'),
      criticGatesSummary: gatesLines.join('\n'),
      creativeIdea: project.meta?.idea || '',
      style: project.meta?.style || '电影质感，写实光影',
    };
  }
}
