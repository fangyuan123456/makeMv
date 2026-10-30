import path from 'path';
import fs from 'fs';
import { FmvFinalVideo } from './types.js';
import { ffmpegService } from '../../media/ffmpeg.js';
import { audioService } from '../../media/audio.js';

export class MasterStitcherService {
  /**
   * 拼接所有镜头片段、混音背景音乐（BGM），并合成母带级全片视频。
   */
  async assembleMasterCut(options: {
    clips: Array<{ localPath: string }>;
    projectDir: string;
    sessionId: string;
    title: string;
    style: string;
  }): Promise<{ finalVideoPath: string; webPath: string; actualDuration: number; finalVideos: FmvFinalVideo[] }> {
    const { clips, projectDir, sessionId, title, style } = options;

    const outputDir = path.join(projectDir, 'final');
    const audioDir = path.join(projectDir, 'audio');
    fs.mkdirSync(outputDir, { recursive: true });
    fs.mkdirSync(audioDir, { recursive: true });

    const safeTitle = (title || 'final_cut').replace(/[\\/:*?"<>|]/g, '_').trim();
    const tempConcatVideoPath = path.join(outputDir, `temp_concat_${Date.now()}.mp4`);
    const finalVideoPath = path.join(outputDir, `${safeTitle}.mp4`);
    const clipLocalPaths = clips.map((c) => c.localPath).filter(Boolean);

    console.log(`[MasterStitcher] Concatenating ${clipLocalPaths.length} video clips...`);
    await ffmpegService.concatClips(clipLocalPaths, tempConcatVideoPath);

    const actualDuration = await ffmpegService.getDuration(tempConcatVideoPath);
    console.log(`[MasterStitcher] Master cut duration: ${actualDuration.toFixed(2)}s`);

    const bgmPath = path.join(audioDir, 'cinematic_bgm.mp3');
    try {
      console.log(`[MasterStitcher] Generating cinematic soundtrack (${actualDuration.toFixed(1)}s)...`);
      await audioService.generateCinematicBGM(actualDuration, bgmPath, style);

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
    } finally {
      // 安全删除无音轨的中间拼接视频以释放磁盘空间
      if (fs.existsSync(tempConcatVideoPath) && fs.existsSync(finalVideoPath)) {
        try {
          fs.unlinkSync(tempConcatVideoPath);
        } catch {
          // 忽略清理临时文件时的异常
        }
      }
    }

    const webPath = `/media/${sessionId}/final/${path.basename(finalVideoPath)}`;
    const finalVideos: FmvFinalVideo[] = [
      {
        name: `${title || '完整成片'}`,
        path: finalVideoPath,
        url: webPath,
        episode: 1,
        duration: Math.round(actualDuration),
      },
    ];

    return { finalVideoPath, webPath, actualDuration, finalVideos };
  }
}

export const masterStitcherService = new MasterStitcherService();
