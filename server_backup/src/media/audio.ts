import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';
import { config } from '../config/index.js';
import { ffmpegService } from './ffmpeg.js';

const execFileAsync = promisify(execFile);

export interface TTSOptions {
  voice?: string;
  rate?: string;
  pitch?: string;
}

export interface ParsedDialogue {
  speaker?: string;
  text: string;
  emotion?: string;
  isDialogue: boolean;
}

export class AudioService {
  private ffmpegPath: string;

  constructor() {
    this.ffmpegPath = config.paths.ffmpeg;
  }

  /**
   * 从分镜的 dialogueOrAction 描述中解析对白文本、说话人及情绪。
 * 通用兼容各类题材、格式规范与多语种表达。
   */
  parseDialogue(raw?: string): ParsedDialogue {
    if (!raw || !raw.trim()) {
      return { text: '', isDialogue: false };
    }

    const trimmed = raw.trim();

    // 模式 1：说话人（情绪）：文本 或 说话人(情绪): 文本 或 说话人: 文本
    const matchWithColon = trimmed.match(/^([^：:()（）]+)(?:[（(]([^）)]+)[）)])?[：:]\s*(.+)$/);
    if (matchWithColon) {
      const speaker = matchWithColon[1].trim();
      const emotion = matchWithColon[2]?.trim();
      const text = matchWithColon[3].trim().replace(/^["“'‘]|["”'’]$/g, '');
      return {
        speaker,
        emotion,
        text,
        isDialogue: true,
      };
    }

    // 模式 2：文本中被引号包裹的直接引语，例如 "必须阻止它！"
    const quoteMatch = trimmed.match(/["“]([^"”]+)["”]/);
    if (quoteMatch) {
      return {
        text: quoteMatch[1].trim(),
        isDialogue: true,
      };
    }

    // 模式 3：若文本显式以“旁白”或“对白”开头，或包含对白引导词
    if (trimmed.startsWith('旁白') || trimmed.startsWith('独白')) {
      const clean = trimmed.replace(/^(?:旁白|独白)[：:（(]?[^）)]*[）)]?[：:]?/, '').trim();
      return {
        speaker: '旁白',
        text: clean.replace(/^["“'‘]|["”'’]$/g, ''),
        isDialogue: true,
      };
    }

    // 若纯属动作或环境描写，无角色口头台词
    return {
      text: '',
      isDialogue: false,
    };
  }

  /**
   * 根据说话人身份与情绪特征，智能匹配最契合的神经语音模型。
   */
  selectVoice(speaker?: string, emotion?: string): string {
    const s = (speaker || '').toLowerCase();
    const e = (emotion || '').toLowerCase();

    // 女性角色音色映射
    if (s.includes('女') || s.includes('母') || s.includes('姐') || s.includes('妹') || s.includes('queen') || s.includes('lady')) {
      return 'zh-CN-XiaoxiaoNeural';
    }

    // 旁白/预告片/沉稳庄重型音色
    if (s.includes('旁白') || s.includes('解说') || s.includes('trailer') || e.includes('低沉') || e.includes('厚重') || e.includes('冷峻')) {
      return 'zh-CN-YunjianNeural';
    }

    // 默认戏剧张力男声音色
    return 'zh-CN-YunxiNeural';
  }

  /**
   * 使用 Edge-TTS 高保真神经语音合成服务生成配音音频。
 * 极速合成、完全免费且无需额外申请外部 API 秘钥。
   */
  async synthesizeSpeech(
    text: string,
    outputFilePath: string,
    options?: TTSOptions
  ): Promise<{ audioPath: string; duration: number }> {
    const dir = path.dirname(outputFilePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const tempDir = path.join(dir, `tts_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`);
    fs.mkdirSync(tempDir, { recursive: true });

    const tts = new MsEdgeTTS();
    const voice = options?.voice || 'zh-CN-YunjianNeural';
    await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);

    try {
      const res = await tts.toFile(tempDir, text, {
        rate: options?.rate || '0%',
        pitch: options?.pitch || '0Hz',
      });

      if (fs.existsSync(res.audioFilePath)) {
        fs.renameSync(res.audioFilePath, outputFilePath);
      }

      const duration = await ffmpegService.getDuration(outputFilePath);
      return { audioPath: outputFilePath, duration };
    } finally {
      tts.close();
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch {}
    }
  }

  /**
   * 使用 FFmpeg 算法实时生成高质感电影级氛围背景音（BGM Drone）。
 * 针对悬疑沉浸与电影宏大感精调泛音频段。
   */
  async generateCinematicBGM(duration: number, outputFilePath: string, style?: string): Promise<string> {
    const dir = path.dirname(outputFilePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const dur = Math.max(duration, 5);
    const fadeOutStart = Math.max(dur - 2, 1);

    // 多谐波丰富电影基音（超低音48Hz + 基频96Hz + 八度泛音 + 微脉冲震颤）
    const synthExpr = '0.08*sin(2*PI*48*t)+0.05*sin(2*PI*96*t)+0.025*sin(2*PI*144*t)+0.015*sin(2*PI*192*t)';

    const args = [
      '-y',
      '-f',
      'lavfi',
      '-i',
      `aevalsrc=${synthExpr}:d=${dur}:s=44100`,
      '-filter_complex',
      `[0:a]volume=0.35,afade=t=in:ss=0:d=1.5,afade=t=out:st=${fadeOutStart}:d=1.5[aout]`,
      '-map',
      '[aout]',
      '-c:a',
      'mp3',
      '-b:a',
      '128k',
      outputFilePath,
    ];

    await execFileAsync(this.ffmpegPath, args);
    return outputFilePath;
  }

  /**
   * 将配音音轨按精确时间戳混流合成到视频片段中。
 * 若包含配音，延迟 0.4 秒进入以营造更自然的电影级叙事节奏。
   */
  async attachVoiceoverToClip(options: {
    videoPath: string;
    voicePath?: string;
    outputPath: string;
    clipDuration?: number;
  }): Promise<string> {
    const { videoPath, voicePath, outputPath } = options;

    const dir = path.dirname(outputPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    // 若无配音音频，确保视频具备基础静音轨或直通流
    if (!voicePath || !fs.existsSync(voicePath)) {
      const args = [
        '-y',
        '-i',
        videoPath,
        '-f',
        'lavfi',
        '-i',
        'anullsrc=r=44100:cl=stereo',
        '-c:v',
        'copy',
        '-c:a',
        'aac',
        '-b:a',
        '128k',
        '-shortest',
        outputPath,
      ];
      await execFileAsync(this.ffmpegPath, args);
      return outputPath;
    }

    // 存在配音音频：延迟 400ms 切入并平衡音量响度
    const args = [
      '-y',
      '-i',
      videoPath,
      '-i',
      voicePath,
      '-filter_complex',
      '[1:a]volume=1.2,adelay=400|400,apad[aout]',
      '-map',
      '0:v',
      '-map',
      '[aout]',
      '-c:v',
      'copy',
      '-c:a',
      'aac',
      '-b:a',
      '128k',
      '-shortest',
      outputPath,
    ];

    try {
      await execFileAsync(this.ffmpegPath, args);
    } catch (err: any) {
      console.warn(`[AudioService] Error muxing voiceover: ${err.message}. Falling back to copy.`);
      fs.copyFileSync(videoPath, outputPath);
    }

    return outputPath;
  }

  /**
   * 将成片视频与全局背景音乐（BGM）进行多通道混音。
 * 保持分镜配音对白清晰突出，同时背景音乐提供连贯的沉浸氛围。
   */
  async mixVideoWithBGM(options: {
    videoPath: string;
    bgmPath: string;
    outputPath: string;
    bgmVolume?: number;
  }): Promise<string> {
    const { videoPath, bgmPath, outputPath, bgmVolume = 0.28 } = options;

    const dir = path.dirname(outputPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    if (!fs.existsSync(bgmPath)) {
      fs.copyFileSync(videoPath, outputPath);
      return outputPath;
    }

    const args = [
      '-y',
      '-i',
      videoPath,
      '-i',
      bgmPath,
      '-filter_complex',
      `[0:a]volume=1.1[voice];[1:a]volume=${bgmVolume}[bgm];[voice][bgm]amix=inputs=2:duration=first:dropout_transition=2[aout]`,
      '-map',
      '0:v',
      '-map',
      '[aout]',
      '-c:v',
      'copy',
      '-c:a',
      'aac',
      '-b:a',
      '192k',
      outputPath,
    ];

    try {
      await execFileAsync(this.ffmpegPath, args);
    } catch (err: any) {
      console.warn(`[AudioService] amix with BGM failed: ${err.message}. Falling back.`);
      fs.copyFileSync(videoPath, outputPath);
    }

    return outputPath;
  }
}

export const audioService = new AudioService();
