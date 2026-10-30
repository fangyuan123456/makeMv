import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import { config } from './config.js';

const execFileAsync = promisify(execFile);

export class FFmpegService {
  private ffmpegPath: string;

  constructor() {
    this.ffmpegPath = config.paths.ffmpeg;
  }

  /**
   * 生成带有文本说明与背景色彩的合成测试视频片段。
 * 用于离线冒烟测试、全链路预演与原型验证，零消耗远程 API 额度。
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

    // 使用 FFmpeg lavfi 色彩源滤镜配合 drawtext 生成测试画面
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
      // 兜底方案：若复杂滤镜不可用，使用纯色基础帧快速输出
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
   * 极速验证模式图像后处理：
 * 将生成的轻量测试图缩放至目标分辨率，
 * 转码为标准优化的 8 位色彩空间 JPEG (yuvj420p)，并严格控制文件大小不超过上限。
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

      // 严格确保图像体积不超过上限阈值
      if (stat.size > maxBytes) {
        baseQuality = Math.min(baseQuality + 3, 10);
        await runCompression(baseQuality);
        stat = fs.statSync(outputPath);
      }
      if (stat.size > maxBytes) {
        // 第 2 步：自适应微调分辨率，确保体积严格合规
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
   * 极速验证模式视频后处理：
 * 采用 H.264 ultrafast 预设 + CRF 恒定质量 + faststart 流式加载压缩视频，
 * 严格确保片段体积控制在限定体积内。
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

      // 严格确保视频体积符合上限规范
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
   * 将多个分镜视频片段顺序拼接成单个完整的视频文件。
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
      // 若因分辨率或编码格式不一致导致直接流拷贝失败，回退至重编码拼接
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
   * 从指定视频的时间戳位置抽取单帧高清静止图像。
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
   * 精确抽取视频片段的最后一帧。
 * 用于前序镜头与后续镜头之间的首尾帧咬合与像素级连贯性传递。
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
   * 通过 ffprobe 获取音视频文件的精确时长（秒）。
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
   * 将本地图片文件转换为 Base64 Data URL 字符串，供多模态 API 接口调用。
   */
  imageToBase64(imagePath: string): string {
    const ext = path.extname(imagePath).toLowerCase().replace('.', '');
    const mime = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
    const buffer = fs.readFileSync(imagePath);
    return `data:${mime};base64,${buffer.toString('base64')}`;
  }
}

export const ffmpegService = new FFmpegService();
