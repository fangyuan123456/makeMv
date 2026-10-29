import path from 'path';
import fs from 'fs';
import { BaseAgent, AgentContext, AgentResult } from './base.agent.js';
import { WorkflowStage } from '../types/workflow.js';
import { StoryboardArtifact } from '../types/storyboard.js';
import { ReferenceGenerationArtifact } from '../types/media.js';
import { imageProvider } from '../providers/image.provider.js';
import { config } from '../config/index.js';

export class ReferenceGeneratorAgent extends BaseAgent<ReferenceGenerationArtifact> {
  readonly stage = WorkflowStage.REFERENCE_GENERATION;

  async execute(context: AgentContext): Promise<AgentResult<ReferenceGenerationArtifact>> {
    const { session, projectDir } = context;
    const storyboardArtifact = session.stageArtifacts[
      WorkflowStage.STORYBOARD
    ] as StoryboardArtifact;

    if (!storyboardArtifact || !storyboardArtifact.shots) {
      throw new Error('Storyboard artifact missing. Please run STORYBOARD stage first.');
    }

    const refDir = path.join(projectDir, 'references');
    fs.mkdirSync(refDir, { recursive: true });

    const results: ReferenceGenerationArtifact['shots'] = [];

    const ratio = session.meta.videoRatio || '16:9';
    const isFastMode = config.image.qualityLevel === 'fast';

    let reqWidth = 1280;
    let reqHeight = 720;
    if (ratio === '9:16') {
      reqWidth = isFastMode ? 512 : 720;
      reqHeight = isFastMode ? 912 : 1280;
    } else if (ratio === '1:1') {
      reqWidth = isFastMode ? 512 : 1024;
      reqHeight = isFastMode ? 512 : 1024;
    } else {
      // 16:9 (Wanx requires both dimensions >= 512; 912*512 is 16:9 divisible by 16)
      reqWidth = isFastMode ? 912 : 1280;
      reqHeight = isFastMode ? 512 : 720;
    }

    const charArtifact = session.stageArtifacts[
      WorkflowStage.CHARACTER_DESIGN
    ] as any;
    const scriptArtifactForRef = (session.stageArtifacts[WorkflowStage.EPISODE_SCRIPT] ||
      session.stageArtifacts[WorkflowStage.SCRIPT_GENERATION]) as any;

    const charList: any[] = (charArtifact?.characters && charArtifact.characters.length > 0)
      ? charArtifact.characters
      : (scriptArtifactForRef?.characters || scriptArtifactForRef?.bible?.characters || []);
    const settingsList: any[] = charArtifact?.settings || [];

    // Extract unified scene lighting & atmosphere anchor from settings to lock continuity
    const primarySceneId = storyboardArtifact.shots[0]?.sceneId;
    let sceneLightingStyle = '';
    for (const setting of settingsList) {
      if (
        setting.id === primarySceneId ||
        (setting.location && storyboardArtifact.shots[0]?.visualContent?.includes(setting.location))
      ) {
        const lighting = setting.lightingPrompt ? `${setting.lightingPrompt}` : '';
        const atmosphere = setting.atmospherePrompt ? `${setting.atmospherePrompt}` : '';
        sceneLightingStyle = [atmosphere, lighting].filter(Boolean).join(', ');
        break;
      }
    }

    for (const shot of storyboardArtifact.shots) {
      const ext = config.image.provider === 'mock' ? '.svg' : '.jpg';
      const outputPath = path.join(refDir, `ref_${shot.shotId}${ext}`);

      // Ensure the prompt incorporates character specific visual traits
      let fullPrompt = shot.imagePrompt;
      for (const char of charList) {
        if (
          shot.charactersInShot?.includes(char.name) ||
          fullPrompt.toLowerCase().includes(char.name.toLowerCase())
        ) {
          const appearance = char.appearancePrompt || char.appearance || '';
          if (appearance && !fullPrompt.toLowerCase().includes(appearance.slice(0, 20).toLowerCase())) {
            const clothing = char.clothingPrompt ? `, wearing ${char.clothingPrompt}` : '';
            fullPrompt = `${char.name} (${appearance}${clothing}), ${fullPrompt}`;
          }
        }
      }

      // Lock cohesive lighting and palette continuity across the entire sequence
      if (sceneLightingStyle && !fullPrompt.toLowerCase().includes(sceneLightingStyle.slice(0, 20).toLowerCase())) {
        fullPrompt = `${fullPrompt}, environment lighting: ${sceneLightingStyle}`;
      }

      fullPrompt = `${fullPrompt}, cohesive cinematic sequence, 35mm film grain, consistent lighting direction and color palette`;

      // AI natively renders at minimum required resolution (fastest cloud compute)
      const res = await imageProvider.generateImage(
        {
          prompt: fullPrompt,
          style: session.meta.style,
          width: reqWidth,
          height: reqHeight,
        },
        outputPath
      );

      shot.firstFrameImageUrl = res.url;
      const refItem: any = {
        shotId: shot.shotId,
        imageUrl: res.url,
        localPath: res.localPath,
        prompt: shot.imagePrompt,
      };
      if (res.rewrite_result) {
        refItem.rewrite_result = res.rewrite_result;
        (shot as any).rewrite_result = res.rewrite_result;
      }
      results.push(refItem);
    }

    const artifact: ReferenceGenerationArtifact = {
      shots: results,
    };

    return {
      stage: this.stage,
      artifact,
      requiresIntervention: true,
      stopPointTitle: '分镜关键帧参考图确认',
      stopPointDescription: `已完成全部 ${results.length} 个分镜画面的首帧参考图生成。请检查画面构图、人物站位与光影质量，确认后开始生成视频动态片段。`,
    };
  }
}
