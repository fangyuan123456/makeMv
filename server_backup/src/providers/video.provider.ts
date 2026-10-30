import fs from 'fs';
import path from 'path';
import { config } from '../config/index.js';
import { VideoGenerationRequest, VideoGenerationResponse } from '../types/media.js';
import { ffmpegService } from '../media/ffmpeg.js';
import { doctorAgent } from '../agents/doctor/index.js';

export class VideoProvider {
  private apiKey: string;
  private baseUrl: string;
  private model: string;
  private mockMode: boolean;

  constructor() {
    this.apiKey = config.video.apiKey;
    this.baseUrl = config.video.baseUrl;
    let model = config.video.model || 'wanx2.1-i2v-turbo';
    // 自动纠正常见模型名称笔误：'wan2.1' -> 'wanx2.1'
    if (model.startsWith('wan2.1-')) {
      model = model.replace('wan2.1-', 'wanx2.1-');
    }
    this.model = model;
    this.mockMode = config.mockMode || !this.apiKey;
  }

  async generateVideo(
    request: VideoGenerationRequest,
    outputLocalPath: string
  ): Promise<VideoGenerationResponse> {
    const dir = path.dirname(outputLocalPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    if (this.mockMode || !this.apiKey) {
      return this.generateMockVideo(request, outputLocalPath);
    }

    try {
      if (config.video.provider === 'dashscope') {
        return await this.callDashscopeVideo(request, outputLocalPath);
      } else if (config.video.provider === 'kling') {
        return await this.callKlingVideo(request, outputLocalPath);
      } else {
        return await this.generateMockVideo(request, outputLocalPath);
      }
    } catch (err: any) {
      console.warn(`[VideoProvider] API call attempt 1 failed: ${err.message}. Invoking DoctorAgent self-healing...`);
      try {
        const healing = await doctorAgent.heal({
          stage: 'video_generation',
          model: this.model,
          error: err.message || String(err),
          originalPrompt: request.prompt,
        });

        if (healing.shouldRetry && healing.healedPrompt && healing.healedPrompt !== request.prompt) {
          console.log(`[VideoProvider] DoctorAgent healed prompt (${healing.diagnosis.reason_type}): "${healing.diagnosis.reason}". Retrying video synthesis with safe prompt...`);
          const healedReq = { ...request, prompt: healing.healedPrompt };
          let healedRes: VideoGenerationResponse | null = null;
          if (config.video.provider === 'dashscope') {
            healedRes = await this.callDashscopeVideo(healedReq, outputLocalPath);
          } else if (config.video.provider === 'kling') {
            healedRes = await this.callKlingVideo(healedReq, outputLocalPath);
          }
          if (healedRes) {
            healedRes.rewrite_result = {
              originalPrompt: request.prompt,
              healedPrompt: healing.healedPrompt,
              reason: healing.diagnosis.reason,
              reasonType: healing.diagnosis.reason_type,
            };
            return healedRes;
          }
        }
      } catch (retryErr: any) {
        console.warn(`[VideoProvider] Doctor retry failed: ${retryErr.message}.`);
      }

      console.warn(`[VideoProvider] Falling back to mock video.`);
      return this.generateMockVideo(request, outputLocalPath);
    }
  }

  private async callDashscopeVideo(
    request: VideoGenerationRequest,
    outputLocalPath: string
  ): Promise<VideoGenerationResponse> {
    const url = `${this.baseUrl}/services/aigc/video-generation/video-synthesis`;
    const input: any = { prompt: request.prompt };

    if (request.firstFrameImageUrl) {
      input.img_url = request.firstFrameImageUrl;
      input.image_url = request.firstFrameImageUrl;
    }

    const effectiveRes = request.resolution || config.video.resolution || '480P';
    const is480P = effectiveRes === '480P';
    const isPortrait = request.ratio === '9:16';
    const size = is480P
      ? (isPortrait ? '480*832' : '832*480')
      : (isPortrait ? '720*1280' : '1280*720');

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
        'X-DashScope-Async': 'enable',
      },
      body: JSON.stringify({
        model: this.model,
        input,
        parameters: {
          size,
          duration: request.duration || 5,
        },
      }),
    });

    const data = (await res.json()) as any;
    if (!res.ok) {
      throw new Error(`DashScope video API error: ${JSON.stringify(data)}`);
    }

    const taskId = data.output?.task_id;
    if (!taskId) throw new Error('No task_id returned from DashScope');

    const videoUrl = await this.pollDashscopeVideoTask(taskId);
    await this.downloadFile(videoUrl, outputLocalPath);

    return {
      url: videoUrl,
      localPath: outputLocalPath,
      duration: request.duration || 5,
      provider: 'dashscope',
      taskId,
    };
  }

  private async pollDashscopeVideoTask(taskId: string, timeoutSec: number = 300): Promise<string> {
    const checkUrl = `${this.baseUrl}/tasks/${taskId}`;
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutSec * 1000) {
      await new Promise((r) => setTimeout(r, 5000));
      const res = await fetch(checkUrl, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
      });
      const data = (await res.json()) as any;
      const status = data.output?.task_status;

      if (status === 'SUCCEEDED') {
        const videoUrl = data.output?.video_url;
        if (videoUrl) return videoUrl;
        throw new Error('Task succeeded but video_url is missing');
      } else if (status === 'FAILED') {
        throw new Error(`DashScope video task failed: ${data.output?.message}`);
      }
    }
    throw new Error('DashScope video task timed out');
  }

  private async callKlingVideo(
    request: VideoGenerationRequest,
    outputLocalPath: string
  ): Promise<VideoGenerationResponse> {
    // 快手快意 (Kling AI) 视频大模型客户端适配器
    const url = `${this.baseUrl}/v1/videos/image2video`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: 'kling-v1',
        prompt: request.prompt,
        image: request.firstFrameImageUrl,
        duration: request.duration?.toString() || '5',
      }),
    });

    const data = (await res.json()) as any;
    if (!res.ok || !data.data?.task_id) {
      throw new Error(`Kling video error: ${JSON.stringify(data)}`);
    }

    const taskId = data.data.task_id;
    // 轮询快手快意生视频任务状态
    const videoUrl = await this.pollKlingVideoTask(taskId);
    await this.downloadFile(videoUrl, outputLocalPath);

    return {
      url: videoUrl,
      localPath: outputLocalPath,
      duration: request.duration || 5,
      provider: 'kling',
      taskId,
    };
  }

  private async pollKlingVideoTask(taskId: string, timeoutSec: number = 300): Promise<string> {
    const checkUrl = `${this.baseUrl}/v1/videos/image2video/${taskId}`;
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutSec * 1000) {
      await new Promise((r) => setTimeout(r, 5000));
      const res = await fetch(checkUrl, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
      });
      const data = (await res.json()) as any;
      const task = data.data;

      if (task?.task_status === 'succeed') {
        return task.task_result?.videos?.[0]?.url;
      } else if (task?.task_status === 'failed') {
        throw new Error(`Kling video task failed: ${task.task_status_msg}`);
      }
    }
    throw new Error('Kling video task timed out');
  }

  private async downloadFile(
    url: string,
    destPath: string,
    targetWidth?: number,
    targetHeight?: number
  ): Promise<void> {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to download video from ${url}`);
    const buffer = Buffer.from(await res.arrayBuffer());

    // 极速验证模式：通过 FFmpeg 自动压制为超小体积
    const tempPath = `${destPath}.tmp.mp4`;
    fs.writeFileSync(tempPath, buffer);
    try {
      await ffmpegService.compressVideo({
        inputPath: tempPath,
        outputPath: destPath,
        targetWidth,
        targetHeight,
        crf: config.video.crf,
        maxMb: config.video.maxMb,
      });
    } finally {
      if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
    }
  }

  private async generateMockVideo(
    request: VideoGenerationRequest,
    outputLocalPath: string
  ): Promise<VideoGenerationResponse> {
    const duration = request.duration || 3;
    const shortText = request.prompt.slice(0, 30);

    // 调用 ffmpegService 实时合成可完整播放的 MP4 视频！
    await ffmpegService.createTestClip({
      duration,
      text: shortText,
      outputPath: outputLocalPath,
      width: 1280,
      height: 720,
      bgColor: '0x161823',
    });

    const relUrl = outputLocalPath.startsWith(config.paths.projects)
      ? `/data/projects/${path.relative(config.paths.projects, outputLocalPath).replace(/\\/g, '/')}`
      : `/data/${path.relative(config.paths.data, outputLocalPath).replace(/\\/g, '/')}`;

    return {
      url: relUrl,
      localPath: outputLocalPath,
      duration,
      provider: 'mock',
      taskId: `mock_${Date.now()}`,
    };
  }
}

export const videoProvider = new VideoProvider();
