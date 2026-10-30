import fs from 'fs';
import path from 'path';
import { BaseAgent, AgentContext, AgentResult } from '../base/index.js';
import { WorkflowStage } from '../../types/workflow.js';
import { NarrativeDesignArtifact } from './types.js';
import { spineService } from './spine.service.js';
import { pivotPointsService } from './pivot-points.service.js';
import { characterProfilesService } from './character-profiles.service.js';
import { bibleService } from './bible.service.js';
import { storyGraphService } from './story-graph.service.js';
import { topologyValidator } from './topology-validator.service.js';

export class NarrativeDesignerAgent extends BaseAgent<NarrativeDesignArtifact> {
  readonly stage = WorkflowStage.NARRATIVE_DESIGN;

  async execute(context: AgentContext): Promise<AgentResult<NarrativeDesignArtifact>> {
    const result = await this.dispatch(context);

    // 将可读性叙事 Markdown / JSON 交付物同步导出至项目目录
    if (result.artifact) {
      try {
        const narrativeDir = path.join(context.projectDir, 'narrative');
        fs.mkdirSync(narrativeDir, { recursive: true });

        // 导出 01_story_spine.md（第 1 步交付物）
        if (result.artifact.goldenSpine && result.artifact.goldenSpine.length > 0) {
          spineService.exportMarkdown(context.projectDir, {
            title: result.artifact.title,
            theme: result.artifact.theme,
            style: result.artifact.style,
            logline: result.artifact.logline || '',
            sellingPoints: result.artifact.sellingPoints || [],
            goldenSpine: result.artifact.goldenSpine,
          });
        }

        // 导出 02_pivot_points.md（第 2 步交付物）
        if (result.artifact.pivotPoints && (result.artifact.pivotPoints as any).macroPivotPoints) {
          pivotPointsService.exportMarkdown(context.projectDir, result.artifact.pivotPoints as any);
        }

        // 导出 04_character_profiles.json（第 4 步交付物）
        if (result.artifact.characters && result.artifact.characters.length > 0) {
          characterProfilesService.exportJson(context.projectDir, result.artifact.characters);
        }

        // 导出 05_stage_artifact.json（第 5 步：统一标准交付物）
        const stageArtifact = {
          stage: 'narrative_design',
          title: result.artifact.title,
          theme: result.artifact.theme,
          style: result.artifact.style,
          logline: result.artifact.logline,
          sellingPoints: result.artifact.sellingPoints,
          goldenSpine: result.artifact.goldenSpine,
          pivotPoints: result.artifact.pivotPoints,
          characters: result.artifact.characters,
          characterNames: result.artifact.characterNames,
          episodes: result.artifact.episodes,
          locations: result.artifact.locations,
          storyGraph: result.artifact.storyGraph,
          isLocked: result.artifact.isLocked ?? false,
        };
        fs.writeFileSync(
          path.join(narrativeDir, '05_stage_artifact.json'),
          JSON.stringify(stageArtifact, null, 2),
          'utf-8'
        );

        if (result.artifact.bible) {
          const b = result.artifact.bible;
          let md = `# ${b.title || '故事世界观设定书 (Story Bible)'}\n\n`;
          md += `**类型/题材**: ${b.genreName || b.genreId || '未指定'} | **视觉风格**: ${b.style || '电影感'}\n\n`;
          if (b.logline) md += `## 故事大纲 (Logline)\n${b.logline}\n\n`;
          if (b.theme) md += `## 核心立意 (Theme)\n${b.theme}\n\n`;
          if (b.sellingPoints && b.sellingPoints.length > 0) {
            md += `## 核心看点与卖点 (Selling Points)\n`;
            for (const sp of b.sellingPoints) {
              md += `- ${sp}\n`;
            }
            md += '\n';
          }
          if (b.characters && b.characters.length > 0) {
            md += `## 核心角色小传\n\n`;
            for (const c of b.characters) {
              md += `### ${c.name} (${c.role || '主要人物'})\n`;
              if (c.appearance) md += `- **外貌特征**: ${c.appearance}\n`;
              if (c.personality) md += `- **性格弧光**: ${c.personality}\n`;
              if (c.motivation) md += `- **核心动机**: ${c.motivation}\n`;
              md += '\n';
            }
          }
          fs.writeFileSync(path.join(narrativeDir, 'story_bible.md'), md, 'utf-8');
        }

        if (result.artifact.storyGraph) {
          fs.writeFileSync(
            path.join(narrativeDir, 'story_graph.json'),
            JSON.stringify(result.artifact.storyGraph, null, 2),
            'utf-8'
          );
        }
      } catch (err) {
        console.warn('[NarrativeDesignerAgent] Failed to write narrative export files:', err);
      }
    }

    return result;
  }

  private async dispatch(context: AgentContext): Promise<AgentResult<NarrativeDesignArtifact>> {
    const { session, userFeedback } = context;

    const existingArtifact = session.stageArtifacts[
      WorkflowStage.NARRATIVE_DESIGN
    ] as NarrativeDesignArtifact | undefined;

    let parsedFeedback: any = null;
    if (userFeedback) {
      try {
        parsedFeedback = typeof userFeedback === 'string' ? JSON.parse(userFeedback) : userFeedback;
      } catch {
        parsedFeedback = { instruction: userFeedback };
      }
    }

    // 动作 A：生成或重新生成互动网状故事图
    if (parsedFeedback?.action === 'generate_story_graph' && existingArtifact) {
      const storyGraph = await storyGraphService.generateStoryGraph(context, existingArtifact, parsedFeedback.instruction);
      const updated: NarrativeDesignArtifact = {
        ...existingArtifact,
        storyGraph,
      };
      if (updated.bible) updated.bible.storyGraph = storyGraph;

      return {
        stage: this.stage,
        artifact: updated,
        requiresIntervention: true,
        stopPointTitle: '互动叙事拓扑图就绪',
        stopPointDescription: `已成功生成 ${storyGraph.nodes.length} 个互动节点与分支拓扑图（质检：${storyGraph.validation?.isPass ? '合格' : '待优化'}，收束率：${((storyGraph.validation?.convergenceRate || 0) * 100).toFixed(0)}%）。`,
      };
    }

    // 动作 B：对既有网状拓扑图进行拓扑完整性校验
    if (parsedFeedback?.action === 'validate_story_graph' && existingArtifact?.storyGraph) {
      existingArtifact.storyGraph = storyGraphService.autoHealGraph(existingArtifact.storyGraph);
      const validation = topologyValidator.validate(existingArtifact.storyGraph);
      existingArtifact.storyGraph.validation = validation;

      return {
        stage: this.stage,
        artifact: existingArtifact,
        requiresIntervention: true,
        stopPointTitle: '拓扑图静态质检报告',
        stopPointDescription: `拓扑检测完成：通过=${validation.isPass}，发现问题=${validation.issues.length}项，警告=${validation.warnings.length}项。`,
      };
    }

    // 动作 C：基于创作者自然语言指令修订现有大纲
    if (parsedFeedback?.action === 'revise_bible' || (parsedFeedback?.instruction && existingArtifact?.bible)) {
      return await bibleService.reviseBible(context, existingArtifact, parsedFeedback.instruction || parsedFeedback.prompt || '');
    }

    // 动作 D：生成故事圣经与全流程互动叙事大纲
    return await bibleService.generateBible(
      context,
      existingArtifact,
      parsedFeedback?.instruction,
      parsedFeedback?.preferredGenre
    );
  }
}
