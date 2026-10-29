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
   * Parse dialogue, speaker, and emotion from shot.dialogueOrAction.
   * Works generically across all stories, formats, and languages.
   */
  parseDialogue(raw?: string): ParsedDialogue {
    if (!raw || !raw.trim()) {
      return { text: '', isDialogue: false };
    }

    const trimmed = raw.trim();

    // Pattern 1: Speaker（Emotion）：Text or Speaker(Emotion): Text or Speaker: Text
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

    // Pattern 2: Quoted speech within text, e.g. "必须阻止它！"
    const quoteMatch = trimmed.match(/["“]([^"”]+)["”]/);
    if (quoteMatch) {
      return {
        text: quoteMatch[1].trim(),
        isDialogue: true,
      };
    }

    // Pattern 3: If string explicitly starts with 旁白 or 对白 or contains dialogue indicators
    if (trimmed.startsWith('旁白') || trimmed.startsWith('独白')) {
      const clean = trimmed.replace(/^(?:旁白|独白)[：:（(]?[^）)]*[）)]?[：:]?/, '').trim();
      return {
        speaker: '旁白',
        text: clean.replace(/^["“'‘]|["”'’]$/g, ''),
        isDialogue: true,
      };
    }

    // If pure action description with no spoken words
    return {
      text: '',
      isDialogue: false,
    };
  }

  /**
   * Determine the most suitable neural voice based on speaker and emotion.
   */
  selectVoice(speaker?: string, emotion?: string): string {
    const s = (speaker || '').toLowerCase();
    const e = (emotion || '').toLowerCase();

    // Female characters
    if (s.includes('女') || s.includes('母') || s.includes('姐') || s.includes('妹') || s.includes('queen') || s.includes('lady')) {
      return 'zh-CN-XiaoxiaoNeural';
    }

    // Deep narrator / trailer / solemn
    if (s.includes('旁白') || s.includes('解说') || s.includes('trailer') || e.includes('低沉') || e.includes('厚重') || e.includes('冷峻')) {
      return 'zh-CN-YunjianNeural';
    }

    // Default dynamic dramatic male voice
    return 'zh-CN-YunxiNeural';
  }

  /**
   * Synthesize high quality neural speech using Edge-TTS.
   * Fast, 100% free, zero external API keys required.
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
   * Generate an atmospheric cinematic ambient BGM drone with FFmpeg.
   * Harmonic frequencies tailored to create deep cinematic suspense and scale.
   */
  async generateCinematicBGM(duration: number, outputFilePath: string, style?: string): Promise<string> {
    const dir = path.dirname(outputFilePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const dur = Math.max(duration, 5);
    const fadeOutStart = Math.max(dur - 2, 1);

    // Multi-harmonic rich cinematic drone (sub-bass 48Hz + fundamental 96Hz + octave overtone + subtle pulse)
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
   * Mux voiceover audio into a video clip with precise timing.
   * If voiceover is provided, it is delayed by 0.4s for natural cinematic pacing.
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

    // If no voiceover provided, ensure video has an audio stream (silent or pass-through)
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

    // Voiceover exists: attach with 400ms delay and proper volume leveling
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
   * Mix final video with global background music track (BGM).
   * Voiceover on video clips remains prominent while BGM creates continuous immersion.
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
