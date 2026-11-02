/**
 * media/providers/ComfyUIMediaProvider.ts
 * ComfyUI 云机/本地渲染执行端提供商 (ComfyUI Provider SSOT)
 *
 * 核心机制：
 * 1. 契约驱动：同时实现 IImageProvider 与 IVideoProvider 强类型契约；
 * 2. 纯自产机床：生图 (T2I) 与 首帧生视频 (I2V) 统一对接到本地/AutoDL RTX 5090 机床；
 * 3. 动态多模态插槽：自动注入 Prompt、Seed、Size，自动上传参考帧至云机 input 目录；
 * 4. 真实视听闭环：返回物理 view URL，由 MediaDownloader 负责持久化落盘至项目本地目录。
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { IImageProvider, ImageGenerationOptions } from './ImageProvider.js';
import type { IVideoProvider, VideoGenerationOptions } from './VideoProvider.js';
import { config } from '../../utils/config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class ComfyUIMediaProvider implements IImageProvider, IVideoProvider {
  public readonly name = 'comfyui';
  private baseUrl: string;
  private t2iTemplatePath: string;
  private i2vTemplatePath: string;

  constructor(customBaseUrl?: string) {
    this.baseUrl = (customBaseUrl || config.comfyui.baseUrl).replace(/\/+$/, '');

    this.t2iTemplatePath = this.resolveTemplatePath('comfyui_t2i.json');
    this.i2vTemplatePath = this.resolveTemplatePath('comfyui_i2v.json');

    // 针对 AutoDL 等云服务器自签名 HTTPS 证书做安全放行
    if (this.baseUrl.startsWith('https://')) {
      process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
    }
  }

  private resolveTemplatePath(...filenames: string[]): string {
    const candidateDirs = [
      path.resolve(__dirname, '../workflows'),
      path.resolve(config.paths.root, 'src/media/workflows'),
      path.resolve(config.paths.root, 'dist/media/workflows'),
      path.resolve(config.paths.root, 'workflows'),
    ];

    for (const dir of candidateDirs) {
      for (const name of filenames) {
        const fullPath = path.join(dir, name);
        if (fs.existsSync(fullPath)) {
          return fullPath;
        }
      }
    }
    return path.join(candidateDirs[0], filenames[0]);
  }

  /**
   * 🌟 1. 文生图 (T2I)：根据提示词调用 5090 生成高清剧照
   */
  public async generateImage(prompt: string, options?: ImageGenerationOptions): Promise<string> {
    if (!fs.existsSync(this.t2iTemplatePath)) {
      throw new Error(`[ComfyUIMediaProvider] 未找到生图工作流模板: ${this.t2iTemplatePath}`);
    }

    const templateRaw = fs.readFileSync(this.t2iTemplatePath, 'utf-8');
    const workflow = JSON.parse(templateRaw);

    // 注入正向提示词
    if (workflow['67']?.inputs) {
      workflow['67'].inputs.text = prompt;
    }

    // 注入负向提示词
    if (options?.negativePrompt && workflow['71']?.inputs) {
      workflow['71'].inputs.text = options.negativePrompt;
    }

    // 注入随机种子
    if (workflow['70']?.inputs) {
      workflow['70'].inputs.seed = options?.seed ?? Math.floor(Math.random() * 1000000000);
    }

    // 注入尺寸
    if (options?.size && workflow['68']?.inputs) {
      const parts = options.size.split('*');
      if (parts.length === 2) {
        const w = parseInt(parts[0], 10);
        const h = parseInt(parts[1], 10);
        if (!isNaN(w) && !isNaN(h)) {
          workflow['68'].inputs.width = Math.floor(w / 16) * 16;
          workflow['68'].inputs.height = Math.floor(h / 16) * 16;
        }
      }
    }

    console.log(`[ComfyUIMediaProvider] 正在向 5090 提交生图任务 (${this.baseUrl})...`);
    return this.executeAndPoll(workflow, 'image');
  }

  /**
   * 🌟 2. 首帧生视频 (I2V)：根据首帧图与运镜提示词生成动态切片
   */
  public async generateVideo(prompt: string, options?: VideoGenerationOptions): Promise<string> {
    if (!fs.existsSync(this.i2vTemplatePath)) {
      throw new Error(`[ComfyUIMediaProvider] 未找到生视频工作流模板: ${this.i2vTemplatePath}`);
    }

    const templateRaw = fs.readFileSync(this.i2vTemplatePath, 'utf-8');
    const workflow = JSON.parse(templateRaw);

    // 必须有首帧参考图 (若未提供，则自动调用当前 5090 生图机床极速生成一张首帧基准图)
    let refImageUrl = options?.referenceImageUrl;
    if (!refImageUrl) {
      console.log(`[ComfyUIMediaProvider] 未传入首帧图，正在自动生成首帧基准画面...`);
      refImageUrl = await this.generateImage(`电影分镜基准帧，${prompt}，高保真电影特写，16:9`, {
        size: '1280*720',
      });
    }

    const uploadedImageName = await this.uploadReferenceImage(refImageUrl);
    console.log(`[ComfyUIMediaProvider] 首帧参考图已上传至云机: ${uploadedImageName}`);

    // 注入参考图像节点 (Node 6, 23, 24)
    if (workflow['6']?.inputs) workflow['6'].inputs.image = uploadedImageName;
    if (workflow['23']?.inputs) workflow['23'].inputs.image = uploadedImageName;
    if (workflow['24']?.inputs) workflow['24'].inputs.image = uploadedImageName;

    // 注入动态运镜提示词 (Node 25)
    if (workflow['25']?.inputs) {
      workflow['25'].inputs.prompt = prompt || '电影镜头缓慢推进，人物微表情生动，高质量运镜';
    }

    // 注入采样随机种子 (Node 9)
    if (workflow['9']?.inputs) {
      workflow['9'].inputs.seed = Math.floor(Math.random() * 1000000000000);
    }

    console.log(`[ComfyUIMediaProvider] 正在向 5090 提交视频切片生成任务 (${this.baseUrl})...`);
    return this.executeAndPoll(workflow, 'video');
  }

  /**
   * 将本地或远程参考图上传到 ComfyUI 的 input 目录
   */
  private async uploadReferenceImage(imageUrlOrPath: string): Promise<string> {
    let fileBuffer: Buffer;
    let fileName = `ref_${Date.now()}.png`;

    let realPath = imageUrlOrPath.replace('file://', '');
    if (imageUrlOrPath.startsWith('/media/')) {
      const rel = imageUrlOrPath.replace('/media/', '');
      realPath = path.join(config.paths.projects, rel);
    }

    if (fs.existsSync(realPath)) {
      fileBuffer = fs.readFileSync(realPath);
      fileName = path.basename(realPath);
    } else {
      const res = await fetch(imageUrlOrPath);
      if (!res.ok) throw new Error(`获取参考图失败: HTTP ${res.status}`);
      fileBuffer = Buffer.from(await res.arrayBuffer());
    }

    // 构造 multipart/form-data 上传到 ComfyUI
    const formData = new FormData();
    const blob = new Blob([fileBuffer], { type: 'image/png' });
    formData.append('image', blob, fileName);
    formData.append('overwrite', 'true');

    const uploadRes = await fetch(`${this.baseUrl}/upload/image`, {
      method: 'POST',
      body: formData,
    });

    if (!uploadRes.ok) {
      throw new Error(`上传图片至 ComfyUI 失败: HTTP ${uploadRes.status}`);
    }

    const json = (await uploadRes.json()) as { name: string };
    return json.name || fileName;
  }

  /**
   * 提交任务并轮询历史结果
   */
  private async executeAndPoll(workflow: any, mediaType: 'image' | 'video'): Promise<string> {
    const promptResponse = await fetch(`${this.baseUrl}/prompt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: workflow }),
    });

    if (!promptResponse.ok) {
      const errorText = await promptResponse.text();
      throw new Error(`[ComfyUIMediaProvider] 提交任务失败 (HTTP ${promptResponse.status}): ${errorText}`);
    }

    const promptResult = (await promptResponse.json()) as { prompt_id: string };
    const promptId = promptResult.prompt_id;
    if (!promptId) {
      throw new Error('[ComfyUIMediaProvider] ComfyUI 未返回合法的 prompt_id');
    }

    console.log(`[ComfyUIMediaProvider] ${mediaType === 'video' ? '视频' : '图像'}任务提交成功, prompt_id: ${promptId}, 正在轮询等待渲染...`);

    const startTime = Date.now();
    const timeoutMs = mediaType === 'video' ? (config.comfyui.timeoutMs || 180000) * 2 : (config.comfyui.timeoutMs || 180000);

    while (Date.now() - startTime < timeoutMs) {
      await new Promise((resolve) => setTimeout(resolve, 2000));

      const historyResponse = await fetch(`${this.baseUrl}/history/${promptId}`);
      if (!historyResponse.ok) continue;

      const historyData = (await historyResponse.json()) as Record<string, any>;
      const taskRecord = historyData[promptId];

      if (taskRecord) {
        if (taskRecord.status && taskRecord.status.status_str === 'error') {
          const messages = JSON.stringify(taskRecord.status.messages || {});
          throw new Error(`[ComfyUIMediaProvider] ComfyUI 渲染报错: ${messages}`);
        }

        const outputs = taskRecord.outputs;
        if (outputs) {
          for (const nodeId of Object.keys(outputs)) {
            const nodeOutput = outputs[nodeId];
            const items = nodeOutput.videos || nodeOutput.gifs || nodeOutput.images;
            if (Array.isArray(items) && items.length > 0) {
              const file = items[0];
              const filename = file.filename;
              const subfolder = file.subfolder || (mediaType === 'video' ? 'video' : '');
              const type = file.type || 'output';

              const mediaUrl = `${this.baseUrl}/view?filename=${encodeURIComponent(filename)}&subfolder=${encodeURIComponent(subfolder)}&type=${encodeURIComponent(type)}`;
              console.log(`[ComfyUIMediaProvider] ${mediaType === 'video' ? '视频' : '图像'}生成完成! 产物 URL: ${mediaUrl}`);
              return mediaUrl;
            }
          }
        }
      }
    }

    throw new Error(`[ComfyUIMediaProvider] 等待 ComfyUI 渲染超时 (${timeoutMs / 1000}s)`);
  }
}
