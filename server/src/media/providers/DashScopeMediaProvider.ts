/**
 * media/providers/DashScopeMediaProvider.ts
 * 阿里百炼 DashScope 通义万相 (Wanx) 真实文生图与图生视频适配器
 */

import fs from 'fs';
import path from 'path';
import { config } from '../../utils/config.js';
import type { IImageProvider, ImageGenerationOptions } from './ImageProvider.js';
import type { IVideoProvider, VideoGenerationOptions } from './VideoProvider.js';

export class DashScopeMediaProvider implements IImageProvider, IVideoProvider {
  public readonly name = 'dashscope-wanx';

  private apiKey: string;
  private baseUrl: string;
  private imageModel: string;
  private videoModel: string;

  constructor(options: {
    apiKey: string;
    baseUrl?: string;
    imageModel?: string;
    videoModel?: string;
  }) {
    this.apiKey = options.apiKey;
    this.baseUrl = (options.baseUrl || 'https://dashscope.aliyuncs.com/api/v1').replace(/\/+$/, '');
    this.imageModel = options.imageModel || 'wanx2.1-t2i-turbo';
    this.videoModel = options.videoModel || 'wanx2.1-i2v-turbo';
  }

  /**
   * 文生图：提交异步任务并轮询获取结果
   */
  public async generateImage(prompt: string, options?: ImageGenerationOptions): Promise<string> {
    if (!this.apiKey) {
      throw new Error('[DashScopeMediaProvider] 未配置 DashScope API Key');
    }

    const size = options?.size || '1280*720';
    const submitUrl = `${this.baseUrl}/services/aigc/text2image/image-synthesis`;

    const res = await fetch(submitUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        'X-DashScope-Async': 'enable',
      },
      body: JSON.stringify({
        model: this.imageModel,
        input: {
          prompt,
        },
        parameters: {
          size,
          n: options?.n || 1,
        },
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`[DashScope] 提交生图任务失败: HTTP ${res.status} - ${errText}`);
    }

    const data = await res.json() as any;
    const taskId = data.output?.task_id;
    if (!taskId) {
      throw new Error(`[DashScope] 未获取到生图 task_id: ${JSON.stringify(data)}`);
    }

    // 轮询任务状态 (最长等待 90 秒)
    return await this.pollTaskResult(taskId, 90, (taskData) => {
      const results = taskData.output?.results;
      if (results && results.length > 0 && results[0].url) {
        return results[0].url;
      }
      return null;
    });
  }

  /**
   * 视频生成：提交异步任务并轮询获取视频切片 URL
   */
  public async generateVideo(prompt: string, options?: VideoGenerationOptions): Promise<string> {
    if (!this.apiKey) {
      throw new Error('[DashScopeMediaProvider] 未配置 DashScope API Key');
    }

    const submitUrl = `${this.baseUrl}/services/aigc/video-generation/video-synthesis`;
    const inputPayload: Record<string, any> = { prompt };
    if (options?.referenceImageUrl) {
      const refUrl = options.referenceImageUrl.trim();
      if (refUrl.startsWith('http://') || refUrl.startsWith('https://') || refUrl.startsWith('data:image/')) {
        inputPayload.img_url = refUrl;
      } else if (refUrl.startsWith('/media/')) {
        // 🌟 解决公网模型无法访问本地相对路径：自动定位本地物理文件并编码为合规 Base64 Data URI
        try {
          const parts = refUrl.replace(/^\/media\//, '').split('/');
          const localDiskPath = path.join(config.paths.projects, ...parts);
          if (fs.existsSync(localDiskPath) && fs.statSync(localDiskPath).size > 0) {
            const ext = path.extname(localDiskPath).toLowerCase();
            const mime = ext === '.png' ? 'image/png' : 'image/jpeg';
            const base64Str = fs.readFileSync(localDiskPath).toString('base64');
            inputPayload.img_url = `data:${mime};base64,${base64Str}`;
          } else {
            inputPayload.img_url = refUrl;
          }
        } catch {
          inputPayload.img_url = refUrl;
        }
      } else {
        inputPayload.img_url = refUrl;
      }
    }

    const res = await fetch(submitUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        'X-DashScope-Async': 'enable',
      },
      body: JSON.stringify({
        model: this.videoModel,
        input: inputPayload,
        parameters: {
          duration: options?.durationSec || 5,
        },
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`[DashScope] 提交生视频任务失败: HTTP ${res.status} - ${errText}`);
    }

    const data = await res.json() as any;
    const taskId = data.output?.task_id;
    if (!taskId) {
      throw new Error(`[DashScope] 未获取到视频 task_id: ${JSON.stringify(data)}`);
    }

    // 轮询任务状态 (最长等待 180 秒)
    return await this.pollTaskResult(taskId, 180, (taskData) => {
      if (taskData.output?.video_url) {
        return taskData.output.video_url;
      }
      return null;
    });
  }

  /**
   * 轮询任务直到完成或超时
   */
  private async pollTaskResult(
    taskId: string,
    maxWaitSec: number,
    extractor: (data: any) => string | null
  ): Promise<string> {
    const taskUrl = `${this.baseUrl}/tasks/${taskId}`;
    const startTime = Date.now();

    while ((Date.now() - startTime) / 1000 < maxWaitSec) {
      await new Promise((resolve) => setTimeout(resolve, 2500));

      const res = await fetch(taskUrl, {
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
        },
      });

      if (!res.ok) {
        continue;
      }

      const taskData = await res.json() as any;
      const status = taskData.output?.task_status;

      if (status === 'SUCCEEDED') {
        const url = extractor(taskData);
        if (url) return url;
        throw new Error(`[DashScope] 任务成功但未提取到媒体 URL: ${JSON.stringify(taskData)}`);
      }

      if (status === 'FAILED' || status === 'CANCELED') {
        throw new Error(
          `[DashScope] 媒体生成任务失败: ${taskData.output?.message || taskData.output?.code || status}`
        );
      }
    }

    throw new Error(`[DashScope] 任务超时 (${maxWaitSec}s 未完成): task_id=${taskId}`);
  }
}
