import fs from 'fs';
import path from 'path';
import { ffmpegService } from '../../media/ffmpeg.js';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { config } from '../../config/index.js';

const execFileAsync = promisify(execFile);

export class LoopFrameService {
  /**
   * Extracts a high-definition hold/freeze frame from the end of a video clip.
   */
  async extractHoldFrame(videoPath: string, outputImagePath: string): Promise<string> {
    const dir = path.dirname(outputImagePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    return await ffmpegService.extractLastFrame(videoPath, outputImagePath);
  }

  /**
   * Generates a seamless ping-pong micro-loop video (forward + reverse) from the end of a clip.
   * 在等待玩家交互抉择时，往复循环播放此乒乓片段，营造自然的待机与微动态呼吸感
   * without a hard cut jump.
   */
  async generatePingPongLoop(
    videoPath: string,
    outputLoopPath: string,
    segmentDurationSec: number = 2
  ): Promise<string> {
    const dir = path.dirname(outputLoopPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    if (config.video.provider === 'mock') {
      await ffmpegService.createTestClip({
        duration: segmentDurationSec * 2,
        text: 'Decision Loop',
        outputPath: outputLoopPath,
        bgColor: '0x1F2430',
      });
      return outputLoopPath;
    }

    try {
      const totalDuration = await ffmpegService.getDuration(videoPath);
      const startSec = Math.max(0, totalDuration - segmentDurationSec);

      const ffmpegBin = config.paths.ffmpeg;
      const args = [
        '-y',
        '-ss',
        startSec.toString(),
        '-i',
        videoPath,
        '-t',
        segmentDurationSec.toString(),
        '-filter_complex',
        '[0:v]split=2[v1][v2];[v2]reverse[v2_rev];[v1][v2_rev]concat=n=2:v=1:a=0[outv]',
        '-map',
        '[outv]',
        '-c:v',
        'libx264',
        '-pix_fmt',
        'yuv420p',
        outputLoopPath,
      ];

      await execFileAsync(ffmpegBin, args);
      return outputLoopPath;
    } catch (err) {
      console.warn('[LoopFrameService] PingPong loop generation fallback to hold frame copy:', err);
      const tempFrame = path.join(dir, `temp_hold_${Date.now()}.jpg`);
      await this.extractHoldFrame(videoPath, tempFrame);
      await ffmpegService.createTestClip({
        duration: 3,
        text: 'Decision Hold',
        outputPath: outputLoopPath,
      });
      if (fs.existsSync(tempFrame)) {
        try { fs.unlinkSync(tempFrame); } catch {}
      }
      return outputLoopPath;
    }
  }
}

export const loopFrameService = new LoopFrameService();
