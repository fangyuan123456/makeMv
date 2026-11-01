/**
 * pipelines/character/steps/portrait-render/PortraitRenderStep.ts
 * 工步 2：定妆照多版本渲染与本地永久化落盘 (声明式 Pipeline Step)
 */

import fs from 'fs';
import path from 'path';
import { BaseStep } from '../../../../agent-runtime/index.js';
import { ProjectStore } from '../../../../project-store/index.js';
import { formatPortraitPrompt } from './prompt.js';
import type { PortraitRenderInput, CharacterSheet } from '../../types.js';
import type { CharacterVersionData } from './schema.js';

export class PortraitRenderStep extends BaseStep<PortraitRenderInput, CharacterSheet[]> {
  public readonly name = 'PortraitRenderStep';
  public readonly stepIndex = 'portrait_render';

  constructor(projectId?: string) {
    super('CHARACTER_DESIGNER', projectId);
  }

  public async run(input: PortraitRenderInput): Promise<CharacterSheet[]> {
    const activeProjectId = input.projectId || this.projectId;
    if (!activeProjectId) {
      throw new Error('[PortraitRenderStep] 运行缺少必须的 projectId');
    }

    const store = ProjectStore.getInstance();
    const projectDir = store.getProjectDir(activeProjectId);
    const versionsCount = Math.max(1, input.versionsPerCharacter || 1);
    const specs = input.specs || [];

    const characterSheets: CharacterSheet[] = [];

    for (const charProfile of input.rawCharacters) {
      const spec = specs.find((s) => s.name === charProfile.name) || {
        name: charProfile.name,
        role: charProfile.role,
        positivePrompt: `cinematic portrait, ${charProfile.appearance}, 8k, photorealistic`,
        negativePrompt: 'low quality, blurry, deformed',
        lighting: 'cinematic lighting',
        shotType: 'medium close-up',
        aspectRatio: '16:9',
        clothingDetails: 'detailed outfit',
        facialFeatures: 'clear facial features',
      };

      const charSafeName = charProfile.name.replace(/[\/\\:*?"<>|]/g, '_');
      const targetDir = path.join(projectDir, 'characters', charSafeName);
      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
      }

      const versions: CharacterVersionData[] = [];
      for (let i = 1; i <= versionsCount; i++) {
        const versionId = `v${i}`;
        const fileName = `portrait_${versionId}.png`;
        const localFilePath = path.join(targetDir, fileName);
        const relativeMediaPath = `/media/${activeProjectId}/characters/${encodeURIComponent(charSafeName)}/${fileName}`;
        const promptUsed = formatPortraitPrompt(spec, i);

        if (!fs.existsSync(localFilePath)) {
          await this.generatePortraitFile(
            localFilePath,
            charProfile.name,
            charProfile.role,
            versionId,
          );
        }

        versions.push({
          versionId,
          imageUrl: relativeMediaPath,
          localPath: localFilePath,
          promptUsed,
          createdAt: new Date().toISOString(),
        });
      }

      characterSheets.push({
        ...charProfile,
        visualSpec: spec,
        currentVersionId: versions[0]?.versionId || 'v1',
        imageUrl: versions[0]?.imageUrl || '',
        referenceImageUrl: versions[0]?.imageUrl || '',
        selected: true,
        versions,
      });
    }

    return characterSheets;
  }

  private async generatePortraitFile(
    outputPath: string,
    characterName: string,
    role: string,
    versionId: string,
  ): Promise<void> {
    const svg = `
<svg width="1280" height="720" xmlns="http://www.w3.org/2000/svg">
  <rect width="100%" height="100%" fill="#1a1c23"/>
  <text x="50%" y="45%" font-family="sans-serif" font-size="42" fill="#e2e8f0" text-anchor="middle">
    ${characterName} - ${versionId}
  </text>
  <text x="50%" y="55%" font-family="sans-serif" font-size="24" fill="#94a3b8" text-anchor="middle">
    角色身份: ${role} | 16:9 电影定妆图
  </text>
</svg>`;
    fs.writeFileSync(outputPath, Buffer.from(svg), 'utf-8');
  }
}
