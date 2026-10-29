import fs from 'fs';
import path from 'path';
import { config } from '../config/index.js';
import { ImageGenerationRequest, ImageGenerationResponse } from '../types/media.js';
import { ffmpegService } from '../media/ffmpeg.js';
import { doctorAgent } from '../agents/doctor.agent.js';

export class ImageProvider {
  private apiKey: string;
  private baseUrl: string;
  private model: string;
  private mockMode: boolean;

  constructor() {
    this.apiKey = config.image.apiKey;
    this.baseUrl = config.image.baseUrl;
    this.model = config.image.model;
    this.mockMode = config.mockMode || !this.apiKey;
  }

  async generateImage(
    request: ImageGenerationRequest,
    outputLocalPath: string
  ): Promise<ImageGenerationResponse> {
    const dir = path.dirname(outputLocalPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    if (this.mockMode || !this.apiKey || config.image.provider === 'mock') {
      return this.generateMockImage(request, outputLocalPath);
    }

    const callApi = async (promptOverride?: string) => {
      const activeReq = promptOverride ? { ...request, prompt: promptOverride } : request;
      if (config.image.provider === 'dashscope') {
        return await this.callDashscopeImage(activeReq, outputLocalPath);
      } else if (config.image.provider === 'ark') {
        return await this.callArkImage(activeReq, outputLocalPath);
      } else if (config.image.provider === 'openai') {
        return await this.callOpenAIImage(activeReq, outputLocalPath);
      } else {
        return await this.generateMockImage(activeReq, outputLocalPath);
      }
    };

    try {
      return await callApi();
    } catch (err: any) {
      console.warn(`[ImageProvider] API call attempt 1 failed: ${err.message}. Invoking DoctorAgent self-healing...`);
      try {
        const healing = await doctorAgent.heal({
          stage: 'image_generation',
          model: this.model,
          error: err.message || String(err),
          originalPrompt: request.prompt,
        });

        if (healing.shouldRetry && healing.healedPrompt && healing.healedPrompt !== request.prompt) {
          console.log(`[ImageProvider] DoctorAgent healed prompt (${healing.diagnosis.reason_type}): "${healing.diagnosis.reason}". Retrying with safe prompt...`);
          const healedRes = await callApi(healing.healedPrompt);
          healedRes.rewrite_result = {
            stage: 'image_generation',
            model: this.model,
            error: err.message,
            original_prompt: request.prompt,
            optimized_prompt: healing.healedPrompt,
            doctor_reason_type: healing.diagnosis.reason_type,
            doctor_reason: healing.diagnosis.reason,
            confidence: healing.diagnosis.confidence,
          };
          return healedRes;
        } else {
          // Retry with slight delay
          await new Promise((r) => setTimeout(r, 2000));
          return await callApi();
        }
      } catch (retryErr: any) {
        console.warn(`[ImageProvider] API call retry also failed: ${retryErr.message}. Falling back to mock image.`);
        return this.generateMockImage(request, outputLocalPath);
      }
    }
  }

  private async callDashscopeImage(
    request: ImageGenerationRequest,
    outputLocalPath: string
  ): Promise<ImageGenerationResponse> {
    const url = `${this.baseUrl}/services/aigc/text2image/image-synthesis`;
    let w = request.width || 1280;
    let h = request.height || 720;
    // DashScope Wanx requirement: both width and height must be between 512 and 1440, divisible by 16
    if (w < 512 || h < 512) {
      const ratio = w / h;
      if (ratio >= 1.5) {
        // ~16:9
        w = 912;
        h = 512;
      } else if (ratio <= 0.67) {
        // ~9:16
        w = 512;
        h = 912;
      } else {
        // ~1:1
        w = 512;
        h = 512;
      }
    }
    // Ensure divisible by 16
    w = Math.round(w / 16) * 16;
    h = Math.round(h / 16) * 16;

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
        'X-DashScope-Async': 'enable',
      },
      body: JSON.stringify({
        model: this.model,
        input: {
          prompt: request.prompt,
          negative_prompt: request.negativePrompt || '',
        },
        parameters: {
          size: `${w}*${h}`,
          n: 1,
        },
      }),
    });

    const data = await res.json() as any;
    if (!res.ok) {
      throw new Error(`DashScope image API error: ${JSON.stringify(data)}`);
    }

    const taskId = data.output?.task_id;
    if (!taskId) throw new Error('No task_id returned from DashScope');

    // Poll task status
    const imageUrl = await this.pollDashscopeTask(taskId);
    await this.downloadFile(imageUrl, outputLocalPath, request.targetWidth, request.targetHeight);

    return {
      url: imageUrl,
      localPath: outputLocalPath,
      provider: 'dashscope',
      prompt: request.prompt,
    };
  }

  private async pollDashscopeTask(taskId: string, timeoutSec: number = 180): Promise<string> {
    const checkUrl = `${this.baseUrl}/tasks/${taskId}`;
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutSec * 1000) {
      await new Promise((r) => setTimeout(r, 2000));
      const res = await fetch(checkUrl, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
      });
      const data = await res.json() as any;
      const status = data.output?.task_status;

      if (status === 'SUCCEEDED') {
        const results = data.output?.results;
        if (results && results.length > 0) {
          return results[0].url;
        }
        throw new Error('Task succeeded but no image url found');
      } else if (status === 'FAILED') {
        throw new Error(`DashScope image task failed: ${data.output?.message}`);
      }
    }
    throw new Error('DashScope image task timed out');
  }

  private async callArkImage(
    request: ImageGenerationRequest,
    outputLocalPath: string
  ): Promise<ImageGenerationResponse> {
    // Volcengine Ark image generation endpoint
    const url = `${this.baseUrl}/images/generations`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        prompt: request.prompt,
        size: '1280x720',
      }),
    });

    const data = await res.json() as any;
    if (!res.ok || !data.data?.[0]?.url) {
      throw new Error(`Ark image API error: ${JSON.stringify(data)}`);
    }

    const imageUrl = data.data[0].url;
    await this.downloadFile(imageUrl, outputLocalPath);

    return {
      url: imageUrl,
      localPath: outputLocalPath,
      provider: 'ark',
      prompt: request.prompt,
    };
  }

  private async callOpenAIImage(
    request: ImageGenerationRequest,
    outputLocalPath: string
  ): Promise<ImageGenerationResponse> {
    const url = 'https://api.openai.com/v1/images/generations';
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: 'dall-e-3',
        prompt: request.prompt,
        size: '1024x1024',
      }),
    });

    const data = await res.json() as any;
    if (!res.ok || !data.data?.[0]?.url) {
      throw new Error(`OpenAI image API error: ${JSON.stringify(data)}`);
    }

    const imageUrl = data.data[0].url;
    await this.downloadFile(imageUrl, outputLocalPath);

    return {
      url: imageUrl,
      localPath: outputLocalPath,
      provider: 'openai',
      prompt: request.prompt,
    };
  }

  private async downloadFile(
    url: string,
    destPath: string,
    targetWidth?: number,
    targetHeight?: number
  ): Promise<void> {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to download image from ${url}`);
    const buffer = Buffer.from(await res.arrayBuffer());

    // If output is requested as .jpg / .jpeg, convert and compress with FFmpeg to 8-bit YUV/RGB
    if (destPath.endsWith('.jpg') || destPath.endsWith('.jpeg')) {
      const tempPath = `${destPath}.tmp.png`;
      fs.writeFileSync(tempPath, buffer);
      try {
        await ffmpegService.processAndCompressImage({
          inputPath: tempPath,
          outputPath: destPath,
          targetWidth,
          targetHeight,
          quality: 5,
        });
      } finally {
        if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
      }
    } else {
      fs.writeFileSync(destPath, buffer);
    }
  }

  private generateMockImage(
    request: ImageGenerationRequest,
    outputLocalPath: string
  ): ImageGenerationResponse {
    // Generate clean SVG mock graphic
    const width = request.width || 1280;
    const height = request.height || 720;
    const shortPrompt = request.prompt.replace(/["<>]/g, '').slice(0, 80);

    const svgContent = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
      <defs>
        <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#141E30" />
          <stop offset="100%" stop-color="#243B55" />
        </linearGradient>
      </defs>
      <rect width="100%" height="100%" fill="url(#bg)" />
      <circle cx="${width / 2}" cy="${height / 2 - 40}" r="90" fill="#3B82F6" opacity="0.3" />
      <text x="${width / 2}" y="${height / 2 - 30}" font-family="sans-serif" font-size="28" fill="#FFFFFF" font-weight="bold" text-anchor="middle">
        [FMV-Agent Mock Keyframe]
      </text>
      <text x="${width / 2}" y="${height / 2 + 30}" font-family="sans-serif" font-size="16" fill="#93C5FD" text-anchor="middle">
        ${shortPrompt}...
      </text>
      <rect x="20" y="20" width="${width - 40}" height="${height - 40}" fill="none" stroke="#60A5FA" stroke-width="2" stroke-dasharray="6,6" opacity="0.5" />
    </svg>
    `.trim();

    // If destination path has .svg, write svg, else write as svg file
    const finalPath = outputLocalPath.endsWith('.png') || outputLocalPath.endsWith('.jpg')
      ? outputLocalPath.replace(/\.(png|jpg|jpeg)$/i, '.svg')
      : outputLocalPath;

    fs.writeFileSync(finalPath, svgContent, 'utf-8');

    const relUrl = finalPath.startsWith(config.paths.projects)
      ? `/data/projects/${path.relative(config.paths.projects, finalPath).replace(/\\/g, '/')}`
      : `/data/${path.relative(config.paths.data, finalPath).replace(/\\/g, '/')}`;

    return {
      url: relUrl,
      localPath: finalPath,
      provider: 'mock',
      prompt: request.prompt,
    };
  }
}

export const imageProvider = new ImageProvider();
