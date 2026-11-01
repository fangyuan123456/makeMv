/**
 * pipelines/scene-script/SceneScriptPipeline.ts
 * 互动影游分场剧本拓展与结构化编剧流水线 (Scene Script Pipeline SSOT)
 */

import fs from 'fs';
import path from 'path';
import { StagePipeline } from '../../agent-runtime/index.js';
import { ProjectStore } from '../../project-store/index.js';
import { WorkflowStage } from '../../types/index.js';
import { ScreenplayExpansionStep } from './steps/screenplay-expansion/ScreenplayExpansionStep.js';
import { SceneStructuringStep } from './steps/scene-structuring/SceneStructuringStep.js';
import type { SceneScriptArtifact } from './types.js';
import type { PipelineResult } from '../narrative/NarrativePipeline.js';

export interface SceneScriptInput {
  projectId?: string;
  userFeedback?: any;
  episodeNumber?: number;
  abortSignal?: AbortSignal;
}

export class SceneScriptPipeline extends StagePipeline {
  private readonly expansionStep = new ScreenplayExpansionStep();
  private readonly structuringStep = new SceneStructuringStep();

  constructor(projectId?: string) {
    super('SceneScriptPipeline', projectId);
    this.addContextStep('ScreenplayExpansionStep', 'expansion', async (ctx) => {
      return this.expansionStep.execute({
        title: ctx.title,
        theme: ctx.theme,
        style: ctx.style,
        episodeNumber: ctx.episodeNumber,
        characters: ctx.characters,
        storyGraph: ctx.storyGraph,
        userFeedback: ctx.userFeedback,
        abortSignal: ctx.abortSignal,
      });
    });
    this.addContextStep('SceneStructuringStep', 'artifact', async (ctx) => {
      return this.structuringStep.execute({
        title: ctx.title,
        theme: ctx.theme,
        style: ctx.style,
        characterNames: ctx.characterNames,
        expansion: ctx.expansion,
        storyGraph: ctx.storyGraph,
        abortSignal: ctx.abortSignal,
      });
    });
  }

  public async execute(input: SceneScriptInput): Promise<PipelineResult<SceneScriptArtifact>> {
    const startMs = Date.now();
    const activeProjectId = input.projectId || this.projectId;
    if (!activeProjectId) {
      throw new Error('[SceneScriptPipeline] 执行缺少必须的 projectId');
    }
    this.setProjectId(activeProjectId);

    const store = ProjectStore.getInstance();
    const session = store.getProject(activeProjectId);
    const narrativeArtifact = store.getArtifact<any>(activeProjectId, WorkflowStage.NARRATIVE_DESIGN) || {};

    const title = narrativeArtifact.title || session?.title || '互动影游';
    const theme = narrativeArtifact.theme || session?.meta?.idea || '未定义主题';
    const style = narrativeArtifact.style || session?.meta?.style || '电影质感';
    const characters = narrativeArtifact.characters || [];
    const storyGraph = narrativeArtifact.storyGraph;
    const episodeNumber = input.episodeNumber || (typeof input.userFeedback === 'object' ? (input.userFeedback as any)?.episodeNumber : 1) || 1;
    const userFeedback = typeof input.userFeedback === 'string' ? input.userFeedback : undefined;

    const ctx = await this.run({
      ...input,
      projectId: activeProjectId,
      title,
      theme,
      style,
      characters,
      characterNames: characters.map((c: any) => c.name),
      storyGraph,
      episodeNumber,
      userFeedback,
    });

    const artifact: SceneScriptArtifact = ctx.artifact;

    store.setArtifact(activeProjectId, WorkflowStage.SCENE_SCRIPT, artifact);

    const projectDir = store.getProjectDir(activeProjectId);
    if (artifact && artifact.scriptText && projectDir) {
      try {
        const scriptsDir = path.join(projectDir, 'scripts');
        fs.mkdirSync(scriptsDir, { recursive: true });
        const filePath = path.join(scriptsDir, 'screenplay.md');
        fs.writeFileSync(filePath, artifact.scriptText, 'utf-8');
      } catch (err) {
        console.warn('[SceneScriptPipeline] Failed to persist screenplay.md to disk:', err);
      }
    }

    return {
      success: true,
      data: artifact,
      summary: `剧本编剧完成：共生成 ${artifact.episodes?.length || 0} 集剧本，包含 ${artifact.episodes?.[0]?.scenes?.length || 0} 个分场`,
      durationMs: Date.now() - startMs,
    };
  }
}
