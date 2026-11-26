/**
 * media/video-frame-extractor.ts
 * 视频高保真尾帧抽取工具 (Video Frame Extractor SSOT)
 */

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import ffmpegPath from 'ffmpeg-static';

export interface ExtractLastFrameOptions {
  videoPath: string;
  outputImagePath: string;
}

/**
 * 从本地 .mp4 视频抽取精准末帧作为下一镜头的接戏母本图
 */
export function extractVideoLastFrame(options: ExtractLastFrameOptions): boolean {
  const { videoPath, outputImagePath } = options;

  if (!fs.existsSync(videoPath)) {
    console.warn(`[VideoFrameExtractor] 视频文件不存在: ${videoPath}`);
    return false;
  }

  const binary = typeof ffmpegPath === 'string' ? ffmpegPath : (ffmpegPath as any)?.default || 'ffmpeg';

  fs.mkdirSync(path.dirname(outputImagePath), { recursive: true });

  // 截取视频最后一瞬间 (-sseof -0.1) 的单一画面帧
  const args = [
    '-sseof',
    '-0.1',
    '-i',
    videoPath,
    '-vframes',
    '1',
    '-q:v',
    '2',
    outputImagePath,
    '-y',
  ];

  try {
    const res = spawnSync(binary, args, { stdio: 'pipe' });
    if (res.status === 0 && fs.existsSync(outputImagePath)) {
      return true;
    }
    console.warn(`[VideoFrameExtractor] 提取尾帧失败:`, res.stderr?.toString());
    return false;
  } catch (err: any) {
    console.warn(`[VideoFrameExtractor] 抽取异常:`, err?.message || err);
    return false;
  }
}
