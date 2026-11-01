/**
 * pipelines/storyboard/StoryboardPipeline.ts
 * 互动影游视听分镜与镜头构图规划流水线 (Storyboard Pipeline SSOT)
 */

import fs from 'fs';
import path from 'path';
import { StagePipeline } from '../../agent-runtime/index.js';
import { ProjectStore } from '../../project-store/index.js';
import { WorkflowStage } from '../../types/index.js';
import { ShotCompositionStep } from './steps/shot-composition/ShotCompositionStep.js';
import { ContinuityAuditStep } from './steps/continuity-audit/ContinuityAuditStep.js';
import type { StoryboardArtifact } from './types.js';
import type { PipelineResult } from '../narrative/NarrativePipeline.js';

export interface StoryboardInput {
  projectId?: string;
  userFeedback?: any;
  abortSignal?: AbortSignal;
}

export class StoryboardPipeline extends StagePipeline {
  private readonly compositionStep = new ShotCompositionStep();
  private readonly auditStep = new ContinuityAuditStep();

  constructor(projectId?: string) {
    super('StoryboardPipeline', projectId);
    this.addContextStep('ShotCompositionStep', 'compResult', async (ctx) => {
      return this.compositionStep.execute({
        title: ctx.title,
        theme: ctx.theme,
        scriptText: ctx.scriptText,
        characterVisuals: ctx.characterVisuals,
        scenes: ctx.scenes,
        userFeedback: ctx.userFeedback,
        abortSignal: ctx.abortSignal,
      });
    });
    this.addContextStep('ContinuityAuditStep', 'artifact', async (ctx) => {
      return this.auditStep.execute({
        rawShots: ctx.compResult.rawShots,
        episodeNumber: ctx.compResult.episodeNumber,
        title: ctx.title,
        scenes: ctx.scenes,
        abortSignal: ctx.abortSignal,
      });
    });
  }

  public async execute(input: StoryboardInput): Promise<PipelineResult<StoryboardArtifact>> {
    const startMs = Date.now();
    const activeProjectId = input.projectId || this.projectId;
    if (!activeProjectId) {
      throw new Error('[StoryboardPipeline] 执行缺少必须的 projectId');
    }
    this.setProjectId(activeProjectId);

    const store = ProjectStore.getInstance();
    const session = store.getProject(activeProjectId);
    const scriptArtifact = store.getArtifact<any>(activeProjectId, WorkflowStage.SCENE_SCRIPT) || {};
    const narrativeArtifact = store.getArtifact<any>(activeProjectId, WorkflowStage.NARRATIVE_DESIGN) || {};
    const charArtifact = store.getArtifact<any>(activeProjectId, WorkflowStage.CHARACTER_DESIGN) || {};

    const title = scriptArtifact.title || narrativeArtifact.title || session?.title || '互动影游';
    const theme = scriptArtifact.theme || narrativeArtifact.theme || session?.meta?.idea || '未定义主题';

    let scenes = (scriptArtifact.episodes || []).flatMap((ep: any) =>
      (ep.scenes || []).map((sc: any) => ({
        sceneId: sc.sceneId,
        title: sc.title,
        location: sc.location,
        characters: sc.characters || [],
        actions: (sc.items || [])
          .filter((it: any) => it.type === 'action')
          .map((it: any) => it.action?.description)
          .join('; '),
      }))
    );

    if (scenes.length === 0) {
      throw new Error('[StoryboardPipeline] 缺少前序分场剧本数据 (SceneScript Artifact: scenes 为空)，请先执行剧本分场阶段');
    }

    const characterVisuals = (charArtifact.characters || []).map((c: any) => ({
      name: c.name,
      role: c.role,
      appearancePrompt: c.visualAnchor?.appearancePrompt || c.appearance || '',
      clothingPrompt: c.visualAnchor?.clothingPrompt || '',
      negativePrompt: c.visualAnchor?.negativePrompt || '',
    }));

    const ctx = await this.run({
      ...input,
      projectId: activeProjectId,
      title,
      theme,
      scriptText: scriptArtifact.scriptText,
      characterVisuals,
      scenes,
      userFeedback: typeof input.userFeedback === 'string' ? input.userFeedback : undefined,
    });

    const artifact: StoryboardArtifact = ctx.artifact;

    store.setArtifact(activeProjectId, WorkflowStage.STORYBOARD, artifact);

    const projectDir = store.getProjectDir(activeProjectId);
    if (artifact && artifact.shots?.length && projectDir) {
      try {
        const sbDir = path.join(projectDir, 'storyboards');
        fs.mkdirSync(sbDir, { recursive: true });

        const session = store.getProject(activeProjectId);
        let md = `# ${session?.title || '视听导演分镜表 (Storyboard)'}\n\n`;
        md += `**总预估时长**: ${artifact.totalDuration || 0} 秒 | **镜头总数**: ${artifact.shots.length} 个\n\n`;
        md += `| 镜头编号 | 归属单元/节点 | 景别 | 运镜与角度 | 时长 | 画面视觉构图 | 声音/对白 |\n`;
        md += `| :--- | :--- | :--- | :--- | :--- | :--- | :--- |\n`;

        for (const s of artifact.shots) {
          const visual = (s.visualContent || '').replace(/\|/g, '/').trim();
          const dialogue = (s.dialogueOrAction || '').replace(/\|/g, '/').trim();
          md += `| \`${s.shotId}\` | ${s.unitId || s.sceneId || '-'} | ${s.shotType || '-'} | ${s.cameraMovement || '-'} (${s.cameraAngle || '-'}) | ${s.duration}s | ${visual} | ${dialogue} |\n`;
        }

        fs.writeFileSync(path.join(sbDir, 'shots_table.md'), md, 'utf-8');
        fs.writeFileSync(path.join(sbDir, 'shots.json'), JSON.stringify(artifact, null, 2), 'utf-8');
      } catch (err) {
        console.warn('[StoryboardPipeline] Failed to write shots_table.md:', err);
      }
    }

    return {
      success: true,
      data: artifact,
      summary: `分镜规划完成：共切分 ${artifact.shots?.length || 0} 个镜头，预计总成片时长 ${artifact.totalDuration || 0} 秒`,
      durationMs: Date.now() - startMs,
    };
  }
}
