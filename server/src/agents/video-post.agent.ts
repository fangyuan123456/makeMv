import path from 'path';
import fs from 'fs';
import { BaseAgent, AgentContext, AgentResult } from './base.agent.js';
import { WorkflowStage } from '../types/workflow.js';
import { StoryboardArtifact } from '../types/storyboard.js';
import { ScriptArtifact } from '../types/script.js';
import { VideoPostArtifact, VideoPostClip, VideoPostFinalVideo } from '../types/media.js';
import { videoProvider } from '../providers/video.provider.js';
import { ffmpegService } from '../media/ffmpeg.js';
import { audioService } from '../media/audio.js';
import { enhancePrompt } from '../prompts/loader.js';

export class VideoPostAgent extends BaseAgent<VideoPostArtifact> {
  readonly stage = WorkflowStage.VIDEO_POST;

  async execute(context: AgentContext): Promise<AgentResult<VideoPostArtifact>> {
    const { session, projectDir, userFeedback } = context;

    let parsedFeedback: any = null;
    if (userFeedback) {
      try {
        parsedFeedback = typeof userFeedback === 'string' ? JSON.parse(userFeedback) : userFeedback;
      } catch {
        parsedFeedback = { instruction: userFeedback };
      }
    }

    const storyboardArtifact = session.stageArtifacts[
      WorkflowStage.STORYBOARD
    ] as StoryboardArtifact | undefined;

    const scriptArtifact = (session.stageArtifacts[
      WorkflowStage.EPISODE_SCRIPT
    ] || session.stageArtifacts[
      WorkflowStage.SCRIPT_GENERATION
    ]) as ScriptArtifact | undefined;

    if (!storyboardArtifact || !storyboardArtifact.shots || storyboardArtifact.shots.length === 0) {
      throw new Error('分镜数据缺失，请先在分镜设计阶段生成分镜镜头。');
    }

    const existingArtifact = session.stageArtifacts[
      WorkflowStage.VIDEO_POST
    ] as VideoPostArtifact | undefined;

    const videosDir = path.join(projectDir, 'videos');
    const framesDir = path.join(projectDir, 'frames');
    const audioDir = path.join(projectDir, 'audio');
    const finalDir = path.join(projectDir, 'final');

    fs.mkdirSync(videosDir, { recursive: true });
    fs.mkdirSync(framesDir, { recursive: true });
    fs.mkdirSync(audioDir, { recursive: true });
    fs.mkdirSync(finalDir, { recursive: true });

    // Mode A: Concat / Export final assembled video
    if (parsedFeedback?.action === 'concat' || parsedFeedback?.action === 'export_final') {
      return await this.assembleFinalVideos(context, existingArtifact, storyboardArtifact, scriptArtifact);
    }

    // Mode B: Generate or regenerate specific clip(s)
    const targetShotId = parsedFeedback?.shotId || parsedFeedback?.shot_id;
    const shotsToProcess = targetShotId
      ? storyboardArtifact.shots.filter(s => s.shotId === targetShotId)
      : storyboardArtifact.shots;

    const clips: VideoPostClip[] = existingArtifact?.clips ? [...existingArtifact.clips] : [];

    for (let i = 0; i < shotsToProcess.length; i++) {
      const shot = shotsToProcess[i];
      const rawVideoPath = path.join(videosDir, `raw_clip_${shot.shotId}.mp4`);
      const outputPath = path.join(videosDir, `clip_${shot.shotId}.mp4`);
      const rawPrompt = shot.videoPrompt || shot.imagePrompt || '';
      const enhancedPrompt = enhancePrompt(rawPrompt, session.meta.style);

      let firstFrameUrl = shot.firstFrameImageUrl;
      if (i > 0 && clips[i - 1]?.localPath && fs.existsSync(clips[i - 1].localPath)) {
        try {
          const prevClipPath = clips[i - 1].localPath;
          const prevShotId = storyboardArtifact.shots[i - 1]?.shotId || `shot_${i}`;
          const lastFramePath = path.join(framesDir, `last_frame_${prevShotId}.jpg`);

          console.log(`[VideoPostAgent] Extracting last frame from ${prevShotId} for shot ${shot.shotId}...`);
          await ffmpegService.extractLastFrame(prevClipPath, lastFramePath);

          if (fs.existsSync(lastFramePath)) {
            firstFrameUrl = ffmpegService.imageToBase64(lastFramePath);
            shot.firstFrameImageUrl = firstFrameUrl;
          }
        } catch (err) {
          console.warn(`[VideoPostAgent] Frame continuity fallback for ${shot.shotId}:`, err);
        }
      }

      console.log(`[VideoPostAgent] Generating video clip for shot [${shot.shotId}]...`);
      const res = await videoProvider.generateVideo(
        {
          prompt: enhancedPrompt,
          firstFrameImageUrl: firstFrameUrl,
          duration: shot.duration || 5,
          ratio: session.meta.videoRatio || '16:9',
          resolution: session.meta.videoResolution || '720P',
        },
        rawVideoPath
      );

      // Audio Alignment: TTS & Voiceover muxing
      let voiceoverAudioPath: string | undefined;
      const parsedAudio = audioService.parseDialogue(shot.dialogueOrAction || '');

      if (parsedAudio.isDialogue && parsedAudio.text) {
        try {
          const voicePath = path.join(audioDir, `voice_${shot.shotId}.mp3`);
          const voice = audioService.selectVoice(parsedAudio.speaker, parsedAudio.emotion);
          console.log(`[VideoPostAgent] Generating TTS voiceover for ${shot.shotId} (${parsedAudio.speaker || '旁白'}): "${parsedAudio.text}"`);
          const ttsRes = await audioService.synthesizeSpeech(parsedAudio.text, voicePath, { voice });
          voiceoverAudioPath = ttsRes.audioPath;
          shot.voiceoverAudioUrl = `/data/projects/${path.relative(path.resolve(projectDir, '..', '..'), voicePath).replace(/\\/g, '/')}`;
        } catch (ttsErr: any) {
          console.warn(`[VideoPostAgent] TTS voiceover skipped for ${shot.shotId}:`, ttsErr.message);
        }
      }

      await audioService.attachVoiceoverToClip({
        videoPath: rawVideoPath,
        voicePath: voiceoverAudioPath,
        outputPath: outputPath,
        clipDuration: res.duration,
      });

      if (fs.existsSync(outputPath) && fs.existsSync(rawVideoPath) && outputPath !== rawVideoPath) {
        try { fs.unlinkSync(rawVideoPath); } catch {}
      }

      shot.videoClipUrl = res.url;
      const webPath = `/media/${session.id}/videos/${path.basename(outputPath)}`;
      const existingClipIndex = clips.findIndex(c => c.shotId === shot.shotId);

      const clipData: VideoPostClip = {
        id: shot.shotId,
        shotId: shot.shotId,
        videoUrl: webPath,
        localPath: outputPath,
        duration: res.duration || shot.duration || 5,
        prompt: rawPrompt,
        selected: webPath,
        versions: existingClipIndex >= 0 && clips[existingClipIndex]?.versions
          ? [webPath, ...clips[existingClipIndex].versions.filter(v => v !== webPath)]
          : [webPath],
        episode: (shot as any).episode || 1,
        rewrite_result: res.rewrite_result,
      };

      if (res.rewrite_result) {
        (shot as any).rewrite_result = res.rewrite_result;
      }

      if (existingClipIndex >= 0) {
        clips[existingClipIndex] = clipData;
      } else {
        clips.push(clipData);
      }
    }

    const artifact: VideoPostArtifact = {
      ...existingArtifact,
      clips,
      totalClips: clips.length,
    };

    // Auto-assemble final video if all shots have clips
    if (clips.length >= storyboardArtifact.shots.length) {
      try {
        const assembled = await this.assembleFinalVideos(context, artifact, storyboardArtifact, scriptArtifact);
        return assembled;
      } catch (err) {
        console.warn('[VideoPostAgent] Auto final video assembly skipped:', err);
      }
    }

    return {
      stage: this.stage,
      artifact,
      requiresIntervention: true,
      stopPointTitle: '分镜头视频生成就绪',
      stopPointDescription: `已成功生成 ${clips.length} 个分镜头动态视频片段。您可以在下方预览单个镜头或一键执行成片后期剪辑合成。`,
    };
  }

  /**
   * Post-Production: Concatenates clips, mixes BGM/dialogue, and generates final full episode video.
   */
  async assembleFinalVideos(
    context: AgentContext,
    currentArtifact: VideoPostArtifact | undefined,
    storyboardArtifact: StoryboardArtifact,
    scriptArtifact?: ScriptArtifact
  ): Promise<AgentResult<VideoPostArtifact>> {
    const { session, projectDir } = context;

    const clips = currentArtifact?.clips || [];
    if (clips.length === 0) {
      throw new Error('未检测到可用于剪辑的镜头视频片段。请先生成镜头视频。');
    }

    const outputDir = path.join(projectDir, 'final');
    const audioDir = path.join(projectDir, 'audio');
    fs.mkdirSync(outputDir, { recursive: true });
    fs.mkdirSync(audioDir, { recursive: true });

    const safeTitle = (session.title || 'final_cut').replace(/[\\/:*?"<>|]/g, '_').trim();
    const tempConcatVideoPath = path.join(outputDir, `temp_concat_${Date.now()}.mp4`);
    const finalVideoPath = path.join(outputDir, `${safeTitle}.mp4`);
    const clipLocalPaths = clips.map(c => c.localPath).filter(Boolean);

    console.log(`[VideoPostAgent] Concatenating ${clipLocalPaths.length} video clips...`);
    await ffmpegService.concatClips(clipLocalPaths, tempConcatVideoPath);

    const actualDuration = await ffmpegService.getDuration(tempConcatVideoPath);
    console.log(`[VideoPostAgent] Master cut duration: ${actualDuration.toFixed(2)}s`);

    const bgmPath = path.join(audioDir, 'cinematic_bgm.mp3');
    try {
      console.log(`[VideoPostAgent] Generating cinematic soundtrack (${actualDuration.toFixed(1)}s)...`);
      await audioService.generateCinematicBGM(actualDuration, bgmPath, session.meta.style);

      await audioService.mixVideoWithBGM({
        videoPath: tempConcatVideoPath,
        bgmPath: bgmPath,
        outputPath: finalVideoPath,
        bgmVolume: 0.28,
      });
    } catch {
      if (fs.existsSync(tempConcatVideoPath)) {
        fs.copyFileSync(tempConcatVideoPath, finalVideoPath);
      }
    }

    const webPath = `/media/${session.id}/final/${path.basename(finalVideoPath)}`;
    const finalVideos: VideoPostFinalVideo[] = [
      {
        name: `${session.title || '完整剧集成片'}`,
        path: finalVideoPath,
        url: webPath,
        episode: 1,
        duration: Math.round(actualDuration),
      },
    ];

    const updatedArtifact: VideoPostArtifact = {
      ...currentArtifact,
      clips,
      totalClips: clips.length,
      final_video: webPath,
      outputVideoPath: finalVideoPath,
      outputVideoUrl: webPath,
      final_videos: finalVideos,
      totalDuration: actualDuration,
      resolution: session.meta.videoResolution || '720P',
    };

    return {
      stage: this.stage,
      artifact: updatedArtifact,
      requiresIntervention: true,
      stopPointTitle: '视频后期成片剪辑完成',
      stopPointDescription: `已成功完成视频后期合成！成片总时长 ${Math.round(actualDuration)} 秒，已合成背景音乐与声画轨道。`,
    };
  }
}
