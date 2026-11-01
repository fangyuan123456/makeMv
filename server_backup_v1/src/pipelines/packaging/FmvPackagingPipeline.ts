/**
 * pipelines/packaging/FmvPackagingPipeline.ts
 * 互动影游母带混音与播放器工程清单打包流水线 (Packaging Pipeline SSOT)
 */

import { StagePipeline } from '../../agent-runtime/index.js';
import { ProjectStore } from '../../project-store/index.js';
import { WorkflowStage } from '../../types/index.js';
import { MasterAssemblyStep } from './steps/master-assembly/MasterAssemblyStep.js';
import { ManifestPackagingStep } from './steps/manifest-packaging/ManifestPackagingStep.js';
import type { FmvPackagerArtifact } from './types.js';
import type { PipelineResult } from '../narrative/NarrativePipeline.js';

export interface FmvPackagingInput {
  projectId?: string;
  userFeedback?: any;
  abortSignal?: AbortSignal;
}

export class FmvPackagingPipeline extends StagePipeline {
  private readonly masterStep = new MasterAssemblyStep();
  private readonly manifestStep = new ManifestPackagingStep();

  constructor(projectId?: string) {
    super('FmvPackagingPipeline', projectId);
    this.addContextStep('MasterAssemblyStep', 'masterCut', async (ctx) => {
      return this.masterStep.execute({
        projectId: ctx.projectId,
        clips: ctx.videoArtifact?.clips || [],
      });
    });
    this.addContextStep('ManifestPackagingStep', 'artifact', async (ctx) => {
      return this.manifestStep.execute({
        projectId: ctx.projectId,
        gameTitle: ctx.narrativeArtifact?.title || ctx.session?.title || '互动影游',
        resolution: ctx.session?.meta?.videoResolution || '720P',
        shots: ctx.storyboardArtifact?.shots || [],
        sceneChoicesMap: ctx.sceneChoicesMap,
        masterCut: ctx.masterCut,
      });
    });
  }

  public async execute(
    input: FmvPackagingInput
  ): Promise<PipelineResult<FmvPackagerArtifact>> {
    const startMs = Date.now();
    const activeProjectId = input.projectId || this.projectId;
    if (!activeProjectId) {
      throw new Error('[FmvPackagingPipeline] 执行缺少必须的 projectId');
    }
    this.setProjectId(activeProjectId);

    const store = ProjectStore.getInstance();
    const session = store.getProject(activeProjectId);
    const videoArtifact = store.getArtifact<any>(activeProjectId, WorkflowStage.VIDEO_PRODUCTION);
    const storyboardArtifact = store.getArtifact<any>(activeProjectId, WorkflowStage.STORYBOARD) || {};
    const narrativeArtifact = store.getArtifact<any>(activeProjectId, WorkflowStage.NARRATIVE_DESIGN) || {};
    const scriptArtifact = store.getArtifact<any>(activeProjectId, WorkflowStage.SCENE_SCRIPT) || {};

    const sceneChoicesMap = new Map<string, any[]>();
    for (const ep of scriptArtifact.episodes || []) {
      for (const sc of ep.scenes || []) {
        if (sc.choices && sc.choices.length > 0) {
          sceneChoicesMap.set(sc.sceneId, sc.choices);
        }
      }
    }

    const ctx = await this.run({
      ...input,
      projectId: activeProjectId,
      session,
      videoArtifact,
      storyboardArtifact,
      narrativeArtifact,
      scriptArtifact,
      sceneChoicesMap,
    });

    const artifact: FmvPackagerArtifact = ctx.artifact;

    store.setArtifact(activeProjectId, WorkflowStage.FMV_PACKAGING, artifact);

    const nodeCount = artifact.fmvManifest ? Object.keys(artifact.fmvManifest.nodes).length : 0;

    return {
      success: true,
      data: artifact,
      summary: `影游装配完成：全片母带已导出，包含 ${nodeCount} 个互动节点清单已封装完成`,
      durationMs: Date.now() - startMs,
    };
  }
}
