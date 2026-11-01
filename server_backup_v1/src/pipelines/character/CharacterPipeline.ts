/**
 * pipelines/character/CharacterPipeline.ts
 * 互动影游角色设计与定妆照生成流水线 (Character Pipeline SSOT)
 *
 * 核心机制：
 * 1. 继承 StagePipeline，原生持有 projectId；
 * 2. 声明式驱动 3 大工序 (visual-spec ➔ portrait-render ➔ quality-eval)；
 * 3. 产物双向落盘与资产双向同步。
 */

import fs from 'fs';
import path from 'path';
import { StagePipeline } from '../../agent-runtime/index.js';
import { ProjectStore } from '../../project-store/index.js';
import { WorkflowStage } from '../../types/index.js';
import { VisualSpecStep } from './steps/visual-spec/VisualSpecStep.js';
import { PortraitRenderStep } from './steps/portrait-render/PortraitRenderStep.js';
import { QualityEvalStep } from './steps/quality-eval/QualityEvalStep.js';
import type { NarrativeArtifact, CharacterProfile } from '../narrative/types.js';
import type {
  CharacterDesignerInput,
  CharacterDesignArtifact,
  CharacterSheet,
} from './types.js';
import type { PipelineResult } from '../narrative/NarrativePipeline.js';

export class CharacterPipeline extends StagePipeline {
  private readonly visualSpecStep = new VisualSpecStep();
  private readonly portraitRenderStep = new PortraitRenderStep();
  private readonly qualityEvalStep = new QualityEvalStep();

  constructor(projectId?: string) {
    super('CharacterDesignPipeline', projectId);
    this.addContextStep('VisualSpecStep', 'specs', async (ctx) => {
      return this.visualSpecStep.execute({
        rawCharacters: ctx.rawCharacters,
        style: ctx.style,
        userFeedback: ctx.userFeedback,
        abortSignal: ctx.abortSignal,
      });
    });
    this.addContextStep('PortraitRenderStep', 'renderedSheets', async (ctx) => {
      return this.portraitRenderStep.execute({
        projectId: ctx.projectId,
        rawCharacters: ctx.rawCharacters,
        specs: ctx.specs,
        versionsPerCharacter: ctx.versionsPerCharacter || 1,
        abortSignal: ctx.abortSignal,
      });
    });
    this.addContextStep('QualityEvalStep', 'characterSheets', async (ctx) => {
      return this.qualityEvalStep.execute({
        characterSheets: ctx.renderedSheets,
        abortSignal: ctx.abortSignal,
      });
    });
  }

  public async execute(
    input: CharacterDesignerInput,
  ): Promise<PipelineResult<CharacterDesignArtifact>> {
    const startMs = Date.now();
    const activeProjectId = input.projectId || this.projectId;
    if (!activeProjectId) {
      throw new Error('[CharacterPipeline] 执行缺少必须的 projectId');
    }
    this.setProjectId(activeProjectId);

    const store = ProjectStore.getInstance();

    const narrativeArtifact = store.getArtifact<NarrativeArtifact>(
      activeProjectId,
      WorkflowStage.NARRATIVE_DESIGN,
    );

    let rawCharacters: CharacterProfile[] = narrativeArtifact?.characters || [];

    if (input.targetCharacterNames && input.targetCharacterNames.length > 0) {
      rawCharacters = rawCharacters.filter((c) =>
        input.targetCharacterNames!.includes(c.name),
      );
    }

    if (rawCharacters.length === 0) {
      throw new Error('[CharacterPipeline] 缺少前序角色设计数据 (Narrative Artifact: characters 为空)，请先执行叙事设计阶段生成角色小传');
    }

    const style =
      input.styleOverride || narrativeArtifact?.style || '电影质感，冷色调高对比度光影';

    const ctx = await this.run({
      ...input,
      projectId: activeProjectId,
      rawCharacters,
      style,
    });

    const characterSheets = ctx.characterSheets || [];

    const artifact: CharacterDesignArtifact = {
      characters: characterSheets,
      totalCharacters: characterSheets.length,
      completedCharacters: characterSheets.filter((c: CharacterSheet) => c.imageUrl).length,
      style,
      createdAt: new Date().toISOString(),
    };

    store.setArtifact(activeProjectId, WorkflowStage.CHARACTER_DESIGN, artifact);

    if (narrativeArtifact) {
      narrativeArtifact.characters = narrativeArtifact.characters.map((nc: CharacterProfile) => {
        const updated = characterSheets.find((cs: CharacterSheet) => cs.name === nc.name);
        return updated
          ? {
              ...nc,
              imageUrl: updated.imageUrl,
              referenceImageUrl: updated.referenceImageUrl,
              selected: true,
            }
          : nc;
      });
      if (narrativeArtifact.bible) {
        narrativeArtifact.bible.characters = narrativeArtifact.characters;
      }
      store.setArtifact(activeProjectId, WorkflowStage.NARRATIVE_DESIGN, narrativeArtifact);
    }

    this.exportToLocalDisk(activeProjectId, artifact);

    return {
      success: true,
      data: artifact,
      summary: `角色设计与定妆照生成完成：共计 ${artifact.completedCharacters} 位角色定妆就绪`,
      durationMs: Date.now() - startMs,
    };
  }

  private exportToLocalDisk(projectId: string, artifact: CharacterDesignArtifact): void {
    try {
      const store = ProjectStore.getInstance();
      const projectDir = store.getProjectDir(projectId);
      const charDir = path.join(projectDir, 'characters');
      if (!fs.existsSync(charDir)) {
        fs.mkdirSync(charDir, { recursive: true });
      }

      fs.writeFileSync(
        path.join(charDir, 'character_sheets.json'),
        JSON.stringify(artifact, null, 2),
        'utf-8',
      );

      let md = `# 全剧核心角色定妆档案集 (Character Lookbook)\n\n> **生成时间**: ${artifact.createdAt}\n> **统一视觉风格**: ${artifact.style}\n\n`;
      for (const c of artifact.characters) {
        md += `## ${c.name} (${c.role})\n\n`;
        if (c.imageUrl) {
          md += `![${c.name} 定妆照](${c.imageUrl})\n\n`;
        }
        md += `- **外貌特征**: ${c.appearance}\n`;
        md += `- **标志服装**: ${c.visualSpec?.clothingDetails || '未指定'}\n`;
        md += `- **影视布光**: ${c.visualSpec?.lighting || '未指定'}\n`;
        md += `- **正向提示词**: \`${c.visualSpec?.positivePrompt || ''}\`\n\n`;
      }

      fs.writeFileSync(path.join(charDir, 'character_lookbook.md'), md, 'utf-8');
    } catch (err) {
      console.warn('[CharacterPipeline] 本地导出警告:', err);
    }
  }
}
