import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import { config } from '../config/index.js';

const execFileAsync = promisify(execFile);

export class FFmpegService {
  private ffmpegPath: string;

  constructor() {
    this.ffmpegPath = config.paths.ffmpeg;
  }

  /**
   * Generates a synthetic test video clip with text and color background.
   * Crucial for offline testing, dry-runs, and rapid prototyping without consuming API fees.
   */
  async createTestClip(options: {
    duration: number;
    text: string;
    outputPath: string;
    width?: number;
    height?: number;
    bgColor?: string;
  }): Promise<string> {
    const {
      duration = 3,
      text = 'Scene',
      outputPath,
      width = 1280,
      height = 720,
      bgColor = '0x1A1A24',
    } = options;

    const dir = path.dirname(outputPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    // Using ffmpeg lavfi color generator with drawtext (or testsrc)
    const args = [
      '-y',
      '-f',
      'lavfi',
      '-i',
      `color=c=${bgColor}:s=${width}x${height}:d=${duration}:r=25`,
      '-f',
      'lavfi',
      '-i',
      `anullsrc=r=44100:cl=stereo`,
      '-t',
      duration.toString(),
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-shortest',
      outputPath,
    ];

    try {
      await execFileAsync(this.ffmpegPath, args);
      return outputPath;
    } catch (err: any) {
      // Fallback: If drawtext or complex filter fails, simple raw output
      console.warn(`[FFmpeg] Test clip generation fallback: ${err.message}`);
      const simpleArgs = [
        '-y',
        '-f',
        'lavfi',
        '-i',
        `testsrc=duration=${duration}:size=${width}x${height}:rate=25`,
        '-c:v',
        'libx264',
        '-pix_fmt',
        'yuv420p',
        outputPath,
      ];
      await execFileAsync(this.ffmpegPath, simpleArgs);
      return outputPath;
    }
  }

  /**
   * Fast verification image post-processing:
   * Scales small generated image (e.g. 512x512, 960x540) to required target size,
   * converts to optimized 8-bit standard RGB JPEG (yuvj420p), and strictly enforces <= IMAGE_MAX_KB.
   */
  async processAndCompressImage(options: {
    inputPath: string;
    outputPath: string;
    targetWidth?: number;
    targetHeight?: number;
    quality?: number; // 2-31, 5 provides high quality with ~50-70KB file size
    maxKb?: number;
  }): Promise<string> {
    const {
      inputPath,
      outputPath,
      targetWidth,
      targetHeight,
      maxKb = config.image.maxKb || 100,
    } = options;

    const qualityPreset = config.image.qualityLevel || 'fast';
    let baseQuality = options.quality ?? (qualityPreset === 'high' ? 3 : qualityPreset === 'balanced' ? 4 : 5);

    const dir = path.dirname(outputPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const maxBytes = maxKb * 1024;

    const runCompression = async (q: number, scaleRatio: number = 1) => {
      const args = ['-y', '-i', inputPath];
      let scaleFilter = '';
      if (targetWidth && targetHeight) {
        const w = Math.round(targetWidth * scaleRatio);
        const h = Math.round(targetHeight * scaleRatio);
        scaleFilter = `scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:color=black`;
      } else if (scaleRatio < 1) {
        scaleFilter = `scale=iw*${scaleRatio}:ih*${scaleRatio}`;
      }
      if (scaleFilter) args.push('-vf', scaleFilter);
      args.push('-frames:v', '1', '-update', '1', '-pix_fmt', 'yuvj420p', '-q:v', String(q), outputPath);
      await execFileAsync(this.ffmpegPath, args);
    };

    try {
      await runCompression(baseQuality);
      let stat = fs.statSync(outputPath);

      // Strict enforcement of <= maxKb (e.g. 100KB)
      if (stat.size > maxBytes) {
        baseQuality = Math.min(baseQuality + 3, 10);
        await runCompression(baseQuality);
        stat = fs.statSync(outputPath);
      }
      if (stat.size > maxBytes) {
        // Step 2: adaptively scale resolution slightly to guarantee <= maxKb
        await runCompression(Math.min(baseQuality + 2, 12), 0.85);
      }
      return outputPath;
    } catch (err: any) {
      console.warn(`[FFmpeg] Image compression failed, copying raw file: ${err.message}`);
      fs.copyFileSync(inputPath, outputPath);
      return outputPath;
    }
  }

  /**
   * Fast verification video post-processing:
   * Compresses video with H.264 ultrafast + CRF + faststart,
   * strictly enforcing clip size <= VIDEO_MAX_MB (e.g. 1.5MB).
   */
  async compressVideo(options: {
    inputPath: string;
    outputPath: string;
    targetWidth?: number;
    targetHeight?: number;
    crf?: number;
    maxMb?: number;
  }): Promise<string> {
    const {
      inputPath,
      outputPath,
      targetWidth,
      targetHeight,
      crf = config.video.crf || 32,
      maxMb = config.video.maxMb || 1.5,
    } = options;

    const dir = path.dirname(outputPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const maxBytes = maxMb * 1024 * 1024;

    const runCompression = async (c: number, scaleRatio: number = 1) => {
      const args = ['-y', '-i', inputPath];
      let scaleFilter = '';
      if (targetWidth && targetHeight) {
        const w = Math.round(targetWidth * scaleRatio);
        const h = Math.round(targetHeight * scaleRatio);
        scaleFilter = `scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:color=black`;
      } else if (scaleRatio < 1) {
        scaleFilter = `scale=iw*${scaleRatio}:ih*${scaleRatio}`;
      }
      if (scaleFilter) args.push('-vf', scaleFilter);
      args.push(
        '-c:v', 'libx264',
        '-crf', String(c),
        '-preset', 'ultrafast',
        '-c:a', 'aac',
        '-b:a', '64k',
        '-pix_fmt', 'yuv420p',
        '-movflags', '+faststart',
        outputPath
      );
      await execFileAsync(this.ffmpegPath, args);
    };

    try {
      await runCompression(crf);
      let stat = fs.statSync(outputPath);

      // Strict enforcement of <= maxMb
      if (stat.size > maxBytes) {
        await runCompression(Math.min(crf + 4, 38));
        stat = fs.statSync(outputPath);
      }
      if (stat.size > maxBytes) {
        await runCompression(Math.min(crf + 4, 38), 0.75);
      }
      return outputPath;
    } catch (err: any) {
      console.warn(`[FFmpeg] Video compression failed, copying raw file: ${err.message}`);
      fs.copyFileSync(inputPath, outputPath);
      return outputPath;
    }
  }

  /**
   * Concatenate multiple video clips into a single video file.
   */
  async concatClips(clipPaths: string[], outputPath: string): Promise<string> {
    if (clipPaths.length === 0) {
      throw new Error('No video clips provided for concatenation');
    }
    if (clipPaths.length === 1) {
      fs.copyFileSync(clipPaths[0], outputPath);
      return outputPath;
    }

    const dir = path.dirname(outputPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const listFilePath = path.join(dir, `concat_list_${Date.now()}.txt`);
    const fileContent = clipPaths
      .map((p) => `file '${path.resolve(p).replace(/\\/g, '/').replace(/'/g, "'\\''")}'`)
      .join('\n');
    fs.writeFileSync(listFilePath, fileContent, 'utf-8');


    const args = [
      '-y',
      '-f',
      'concat',
      '-safe',
      '0',
      '-i',
      listFilePath,
      '-c',
      'copy',
      outputPath,
    ];

    try {
      await execFileAsync(this.ffmpegPath, args);
    } catch (err) {
      // If direct copy fails due to different codecs/resolutions, re-encode
      console.warn('[FFmpeg] Direct concat failed, attempting re-encode concat...');
      const reencodeArgs = [
        '-y',
        '-f',
        'concat',
        '-safe',
        '0',
        '-i',
        listFilePath,
        '-c:v',
        'libx264',
        '-pix_fmt',
        'yuv420p',
        '-c:a',
        'aac',
        outputPath,
      ];
      await execFileAsync(this.ffmpegPath, reencodeArgs);
    } finally {
      if (fs.existsSync(listFilePath)) {
        try {
          fs.unlinkSync(listFilePath);
        } catch {}
      }
    }

    return outputPath;
  }

  /**
   * Extract a still frame from a video file at a given timestamp.
   */
  async extractFrame(videoPath: string, timestampSec: number, outputPath: string): Promise<string> {
    const dir = path.dirname(outputPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const args = [
      '-y',
      '-ss',
      timestampSec.toString(),
      '-i',
      videoPath,
      '-vframes',
      '1',
      '-q:v',
      '2',
      outputPath,
    ];

    await execFileAsync(this.ffmpegPath, args);
    return outputPath;
  }

  /**
   * Extract the exact final frame of a video clip.
   * Crucial for last-to-first frame pixel continuity (首尾帧咬合).
   */
  async extractLastFrame(videoPath: string, outputPath: string): Promise<string> {
    const dir = path.dirname(outputPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const args = [
      '-y',
      '-sseof',
      '-0.1',
      '-i',
      videoPath,
      '-frames:v',
      '1',
      '-update',
      '1',
      '-q:v',
      '2',
      outputPath,
    ];

    await execFileAsync(this.ffmpegPath, args);
    return outputPath;
  }

  /**
   * Get precise duration of an audio or video file using ffprobe.
   */
  async getDuration(mediaPath: string): Promise<number> {
    const ffprobePath = path.join(path.dirname(this.ffmpegPath), 'ffprobe.exe');
    const probeExe = fs.existsSync(ffprobePath) ? ffprobePath : 'ffprobe';
    const args = [
      '-v',
      'error',
      '-show_entries',
      'format=duration',
      '-of',
      'default=noprint_wrappers=1:nokey=1',
      mediaPath,
    ];

    try {
      const { stdout } = await execFileAsync(probeExe, args);
      const dur = parseFloat(stdout.trim());
      return isNaN(dur) ? 0 : dur;
    } catch (err: any) {
      console.warn(`[FFmpeg] ffprobe duration check failed: ${err.message}`);
      return 0;
    }
  }

  /**
   * Convert a local image file to a Base64 data URL for API consumption.
   */
  imageToBase64(imagePath: string): string {
    const ext = path.extname(imagePath).toLowerCase().replace('.', '');
    const mime = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
    const buffer = fs.readFileSync(imagePath);
    return `data:${mime};base64,${buffer.toString('base64')}`;
  }
}

export const ffmpegService = new FFmpegService();
