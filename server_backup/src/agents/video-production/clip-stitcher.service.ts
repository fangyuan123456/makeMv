import path from 'path';
import fs from 'fs';
import { VideoProductionClip } from './types.js';
import { StoryboardShot } from '../storyboard/types.js';
import { videoProvider } from '../../providers/video.provider.js';
import { ffmpegService } from '../../media/ffmpeg.js';
import { audioService } from '../../media/audio.js';
import { enhancePrompt } from '../../prompts/loader.js';

export class ClipStitcherService {
  /**
   * 渲染单个分镜视频镜头，合成 TTS 对白语音配音，并完成音画精准对齐。
   */
  async renderAndMuxShot(options: {
    shot: StoryboardShot;
    prevClip?: VideoProductionClip;
    projectDir: string;
    sessionId: string;
    style: string;
    videoRatio: '16:9' | '9:16' | '1:1';
    videoResolution: '480P' | '720P' | '1080P';
  }): Promise<VideoProductionClip> {
    const { shot, prevClip, projectDir, sessionId, style, videoRatio, videoResolution } = options;

    const videosDir = path.join(projectDir, 'videos');
    const framesDir = path.join(projectDir, 'frames');
    const audioDir = path.join(projectDir, 'audio');

    fs.mkdirSync(videosDir, { recursive: true });
    fs.mkdirSync(framesDir, { recursive: true });
    fs.mkdirSync(audioDir, { recursive: true });

    const rawVideoPath = path.join(videosDir, `raw_clip_${shot.shotId}.mp4`);
    const outputPath = path.join(videosDir, `clip_${shot.shotId}.mp4`);
    const rawPrompt = shot.videoPrompt || shot.imagePrompt || '';
    const enhancedPrompt = enhancePrompt(rawPrompt, style);

    let firstFrameUrl = shot.firstFrameImageUrl;

    // 提取前一个镜头片段的尾帧用于当前镜头的首帧连贯性咬合
    if (prevClip?.localPath && fs.existsSync(prevClip.localPath)) {
      try {
        const lastFramePath = path.join(framesDir, `last_frame_${prevClip.shotId}.jpg`);
        console.log(`[ClipStitcher] Extracting continuity frame from ${prevClip.shotId} for shot ${shot.shotId}...`);
        await ffmpegService.extractLastFrame(prevClip.localPath, lastFramePath);

        if (fs.existsSync(lastFramePath)) {
          firstFrameUrl = ffmpegService.imageToBase64(lastFramePath);
          shot.firstFrameImageUrl = firstFrameUrl;
        }
      } catch (err) {
        console.warn(`[ClipStitcher] Continuity frame fallback for ${shot.shotId}:`, err);
      }
    }

    console.log(`[ClipStitcher] Generating video clip for shot [${shot.shotId}]...`);
    const res = await videoProvider.generateVideo(
      {
        prompt: enhancedPrompt,
        firstFrameImageUrl: firstFrameUrl,
        duration: shot.duration || 5,
        ratio: videoRatio || '16:9',
        resolution: videoResolution || '720P',
      },
      rawVideoPath
    );

    // 对白语音合成与音画对齐 (TTS)
    let voiceoverAudioPath: string | undefined;
    const parsedAudio = audioService.parseDialogue(shot.dialogueOrAction || '');

    if (parsedAudio.isDialogue && parsedAudio.text) {
      try {
        const voicePath = path.join(audioDir, `voice_${shot.shotId}.mp3`);
        const voice = audioService.selectVoice(parsedAudio.speaker, parsedAudio.emotion);
        console.log(`[ClipStitcher] Synthesizing TTS voice for ${shot.shotId} (${parsedAudio.speaker || '旁白'}): "${parsedAudio.text}"`);
        const ttsRes = await audioService.synthesizeSpeech(parsedAudio.text, voicePath, { voice });
        voiceoverAudioPath = ttsRes.audioPath;
        shot.voiceoverAudioUrl = `/data/projects/${path.relative(path.resolve(projectDir, '..', '..'), voicePath).replace(/\\/g, '/')}`;
      } catch (ttsErr: any) {
        console.warn(`[ClipStitcher] TTS voice skipped for ${shot.shotId}:`, ttsErr.message);
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
    const webPath = `/media/${sessionId}/videos/${path.basename(outputPath)}`;

    return {
      id: shot.shotId,
      shotId: shot.shotId,
      videoUrl: webPath,
      localPath: outputPath,
      duration: res.duration || shot.duration || 5,
      prompt: rawPrompt,
      selected: webPath,
      versions: [webPath],
      episode: (shot as any).episode || 1,
      rewrite_result: res.rewrite_result,
    };
  }
}

export const clipStitcherService = new ClipStitcherService();
