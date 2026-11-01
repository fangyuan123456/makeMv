import fs from 'fs';
import path from 'path';
import { BaseStep } from '../../../../agent-runtime/index.js';
import { ProjectStore } from '../../../../project-store/index.js';
import type {
  ReferenceGenerationShot,
  ReferenceGenerationArtifact,
  ImageBatchRenderInput,
} from '../../types.js';

export class ImageBatchRenderStep extends BaseStep<ImageBatchRenderInput, ReferenceGenerationArtifact> {
  public readonly name = 'image-batch-render';
  public readonly stepIndex = 'image_batch_render';

  constructor(projectId?: string) {
    super('KEYFRAME_REFERENCE', projectId);
  }

  public async run(input: ImageBatchRenderInput): Promise<ReferenceGenerationArtifact> {
    const projectId = input.projectId || this.projectId;
    if (!projectId) {
      throw new Error('[ImageBatchRenderStep] 运行缺少必须的 projectId');
    }
    const store = ProjectStore.getInstance();
    const shots = input.shots || [];
    const promptMap: Map<string, string> = input.promptMap || new Map();

    const projectDir = store.getProjectDir(projectId);
    const referencesDir = path.join(projectDir, 'references');
    fs.mkdirSync(referencesDir, { recursive: true });

    const renderedShots: ReferenceGenerationShot[] = [];

    for (const shot of shots) {
      if (input.abortSignal?.aborted) {
        throw new Error('[ImageBatchRenderStep] 关键帧渲染已被外部中断');
      }
      const prompt = promptMap.get(shot.shotId) || shot.imagePrompt || '';
      const fileName = `ref_${shot.shotId}.svg`;
      const filePath = path.join(referencesDir, fileName);

      const svgContent = `
<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720">
  <defs>
    <linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#0a0f1d" />
      <stop offset="100%" stop-color="#1e293b" />
    </linearGradient>
  </defs>
  <rect width="1280" height="720" fill="url(#bgGrad)" />
  <rect x="40" y="40" width="1200" height="640" fill="none" stroke="#3b82f6" stroke-width="2" stroke-dasharray="8 8" opacity="0.6" />
  <circle cx="640" cy="360" r="120" fill="#2563eb" opacity="0.2" />
  <text x="640" y="300" font-family="system-ui, sans-serif" font-size="36" font-weight="bold" fill="#60a5fa" text-anchor="middle">分镜关键帧参考图: ${shot.shotId}</text>
  <text x="640" y="360" font-family="system-ui, sans-serif" font-size="22" fill="#94a3b8" text-anchor="middle">景别: ${shot.shotType} | 机位: ${shot.cameraAngle} | 运镜: ${shot.cameraMovement}</text>
  <text x="640" y="420" font-family="system-ui, sans-serif" font-size="16" fill="#cbd5e1" text-anchor="middle">登场角色: ${(shot.charactersInShot || []).join('、') || '环境空镜'}</text>
  <text x="640" y="480" font-family="system-ui, sans-serif" font-size="14" fill="#64748b" text-anchor="middle">${(shot.visualContent || '').slice(0, 60)}</text>
</svg>`.trim();

      fs.writeFileSync(filePath, svgContent, 'utf-8');

      const permanentLocalUrl = `/media/${projectId}/references/${fileName}`;
      shot.firstFrameImageUrl = permanentLocalUrl;

      renderedShots.push({
        shotId: shot.shotId,
        imageUrl: permanentLocalUrl,
        localPath: filePath,
        prompt,
      });
    }

    const artifact: ReferenceGenerationArtifact = {
      shots: renderedShots,
    };

    return artifact;
  }
}
