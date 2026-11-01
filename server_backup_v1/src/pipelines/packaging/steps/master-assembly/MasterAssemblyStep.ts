import fs from 'fs';
import path from 'path';
import { BaseStep } from '../../../../agent-runtime/index.js';
import { ProjectStore } from '../../../../project-store/index.js';
import type {
  FmvFinalVideo,
  MasterAssemblyInput,
  MasterCutResult,
} from '../../types.js';

export class MasterAssemblyStep extends BaseStep<MasterAssemblyInput, MasterCutResult> {
  public readonly name = 'master-assembly';
  public readonly stepIndex = 'master_assembly';

  constructor(projectId?: string) {
    super('FMV_PACKAGER', projectId);
  }

  public async run(input: MasterAssemblyInput): Promise<MasterCutResult> {
    const projectId = input.projectId || this.projectId;
    if (!projectId) {
      throw new Error('[MasterAssemblyStep] 运行缺少必须的 projectId');
    }
    const store = ProjectStore.getInstance();
    const clips = input.clips || [];
    const projectDir = store.getProjectDir(projectId);

    const exportDir = path.join(projectDir, 'export');
    fs.mkdirSync(exportDir, { recursive: true });

    const finalVideoPath = path.join(exportDir, 'master_cut.mp4');
    if (!fs.existsSync(finalVideoPath)) {
      fs.writeFileSync(finalVideoPath, Buffer.from('MASTER_CUT_FULL_VIDEO_BINARY_DATA'), 'utf-8');
    }

    const outputVideoUrl = `/media/${projectId}/export/master_cut.mp4`;

    let totalDuration = 0;
    for (const c of clips) {
      totalDuration += c.duration || 4;
    }

    const finalVideos: FmvFinalVideo[] = [
      {
        name: 'master_cut.mp4',
        path: finalVideoPath,
        url: outputVideoUrl,
        episode: 1,
        duration: totalDuration,
      },
    ];

    return {
      outputVideoPath: finalVideoPath,
      outputVideoUrl,
      finalVideos,
      totalDuration,
    };
  }
}
