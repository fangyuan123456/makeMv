/**
 * media/providers/ComfyUIMediaProvider.ts
 * ComfyUI 云机/本地渲染执行端提供商 (ComfyUI Provider SSOT)
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { IImageProvider, ImageGenerationOptions } from './ImageProvider.js';
import type { IVideoProvider, VideoGenerationOptions } from './VideoProvider.js';
import { config } from '../../utils/config.js';
import { ensureApiPromptFormat } from '../workflows/comfyui-converter.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * 拓扑自适应注入辅助工具类 (ComfyUI Workflow Topology Injector)
 * 彻底消除静态魔法数字节点 ID，自动按 DAG 拓扑链路与 class_type 反查注入
 */
export class ComfyUITopologyInjector {
  /**
   * 拓扑注入正向与负向提示词
   */
  public static injectPrompts(workflow: Record<string, any>, prompt: string, negativePrompt?: string): boolean {
    let positiveInjected = false;

    // 1. 优先通过采样器 (KSampler / KSamplerAdvanced) 的连线反查正负向文本编码节点
    for (const node of Object.values(workflow)) {
      if (!node?.inputs) continue;
      const inputs = node.inputs;

      // 检查 positive 连线
      if (Array.isArray(inputs.positive) && inputs.positive.length >= 1) {
        const targetId = String(inputs.positive[0]);
        const targetNode = workflow[targetId];
        if (targetNode?.inputs) {
          if ('text' in targetNode.inputs) {
            targetNode.inputs.text = prompt;
            positiveInjected = true;
          } else if ('prompt' in targetNode.inputs) {
            targetNode.inputs.prompt = prompt;
            positiveInjected = true;
          }
        }
      }

      // 检查 negative 连线
      if (negativePrompt && Array.isArray(inputs.negative) && inputs.negative.length >= 1) {
        const targetId = String(inputs.negative[0]);
        const targetNode = workflow[targetId];
        if (targetNode?.inputs) {
          if ('text' in targetNode.inputs) {
            targetNode.inputs.text = negativePrompt;
          } else if ('prompt_negative' in targetNode.inputs) {
            targetNode.inputs.prompt_negative = negativePrompt;
          } else if ('prompt' in targetNode.inputs && targetId !== String(inputs.positive?.[0])) {
            targetNode.inputs.prompt = negativePrompt;
          }
        }
      }
    }

    if (positiveInjected) return true;

    // 2. 针对单体文本编码节点 (如 TextEncodeQwenImage21)
    for (const node of Object.values(workflow)) {
      if (node?.class_type === 'TextEncodeQwenImage21' && node.inputs) {
        node.inputs.prompt = prompt;
        if (negativePrompt) {
          node.inputs.prompt_negative = negativePrompt;
        }
        return true;
      }
    }

    // 3. 通用 CLIPTextEncode 遍历降级匹配
    const textNodes = Object.values(workflow).filter((n) => n?.class_type === 'CLIPTextEncode' && n.inputs);
    if (textNodes.length > 0) {
      textNodes[0].inputs.text = prompt;
      if (negativePrompt && textNodes.length > 1) {
        textNodes[1].inputs.text = negativePrompt;
      }
      return true;
    }

    // 4. 视频生成等包含单体 prompt 属性的节点
    for (const node of Object.values(workflow)) {
      if (node?.inputs && 'prompt' in node.inputs && typeof node.inputs.prompt === 'string') {
        node.inputs.prompt = prompt;
        return true;
      }
    }

    return false;
  }

  /**
   * 拓扑注入随机种子 (Seed)
   */
  public static injectSeed(workflow: Record<string, any>, seed: number): void {
    for (const node of Object.values(workflow)) {
      if (node?.inputs && typeof node.inputs === 'object') {
        if ('seed' in node.inputs) {
          node.inputs.seed = seed;
        } else if ('noise_seed' in node.inputs) {
          node.inputs.noise_seed = seed;
        }
      }
    }
  }

  /**
   * 拓扑注入生成画幅尺寸 (Width / Height)
   */
  public static injectImageSize(workflow: Record<string, any>, sizeStr?: string): void {
    if (!sizeStr) return;
    const parts = sizeStr.split('*');
    if (parts.length !== 2) return;
    const w = parseInt(parts[0], 10);
    const h = parseInt(parts[1], 10);
    if (isNaN(w) || isNaN(h)) return;

    const alignedW = Math.floor(w / 16) * 16;
    const alignedH = Math.floor(h / 16) * 16;

    for (const node of Object.values(workflow)) {
      if (!node?.inputs) continue;
      const isLatent =
        node.class_type === 'EmptyLatentImage' ||
        node.class_type === 'EmptySD3LatentImage' ||
        ('width' in node.inputs && 'height' in node.inputs);

      if (isLatent) {
        node.inputs.width = alignedW;
        node.inputs.height = alignedH;
      }
    }
  }

  /**
   * 拓扑注入参考图 (LoadImage)
   * 支持单图注入（全部 LoadImage 更新）或多图按槽位列表注入
   */
  public static injectReferenceImages(workflow: Record<string, any>, imageNames: string | string[]): void {
    const list = Array.isArray(imageNames) ? imageNames : [imageNames];
    if (list.length === 0) return;

    const loadNodes = Object.values(workflow).filter((n) => n?.class_type === 'LoadImage' && n.inputs);
    if (list.length === 1) {
      // 单图时更新所有 LoadImage，确保首帧/参考图完全同步
      for (const node of loadNodes) {
        node.inputs.image = list[0];
      }
    } else {
      // 多图时按顺序分别注入
      for (let i = 0; i < loadNodes.length && i < list.length; i++) {
        loadNodes[i].inputs.image = list[i];
      }
    }
  }
}

export class ComfyUIMediaProvider implements IImageProvider, IVideoProvider {
  public readonly name = 'comfyui';
  private baseUrl: string;
  private t2iTemplatePath: string;
  private i2vTemplatePath: string;
  private charT2iTemplatePath: string;
  private charRef2iTemplatePath: string;
  private charPoseOutfitTemplatePath: string;
  private charThreeViewTemplatePath: string;

  constructor(customBaseUrl?: string) {
    this.baseUrl = (customBaseUrl || config.comfyui.baseUrl).replace(/\/+$/, '');

    this.t2iTemplatePath = this.resolveTemplatePath('comfyui_t2i.json');
    this.i2vTemplatePath = this.resolveTemplatePath('comfyui_i2v.json');
    this.charT2iTemplatePath = this.resolveTemplatePath('comfyui_character_t2i.json');
    this.charRef2iTemplatePath = this.resolveTemplatePath('comfyui_character_ref2i.json');
    this.charPoseOutfitTemplatePath = this.resolveTemplatePath('comfyui_character_pose_outfit.json');
    this.charThreeViewTemplatePath = this.resolveTemplatePath('comfyui_character_three_view.json');
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
   * 角色定妆图生成 (支持纯文生角色、参考图生角色)
   */
  public async generateCharacterPortrait(prompt: string, options?: ImageGenerationOptions): Promise<string> {
    if (options?.referenceImageUrl) {
      return this.generateCharacterFromRef(prompt, options.referenceImageUrl, options);
    }

    if (!fs.existsSync(this.charT2iTemplatePath)) {
      return this.generateImage(prompt, options);
    }

    const templateRaw = fs.readFileSync(this.charT2iTemplatePath, 'utf-8');
    const apiPrompt = ensureApiPromptFormat(JSON.parse(templateRaw));

    ComfyUITopologyInjector.injectPrompts(apiPrompt, prompt, options?.negativePrompt);
    ComfyUITopologyInjector.injectSeed(apiPrompt, options?.seed ?? Math.floor(Math.random() * 1000000000));
    ComfyUITopologyInjector.injectImageSize(apiPrompt, options?.size);

    console.log(`[ComfyUIMediaProvider] 正在向 ComfyUI 提交角色文生图任务 (${this.baseUrl})...`);
    return this.executeAndPoll(apiPrompt, 'image', options?.abortSignal);
  }

  /**
   * 基于参考图生成角色 (维持容貌五官一致性)
   */
  public async generateCharacterFromRef(
    prompt: string,
    refImageUrl: string,
    options?: ImageGenerationOptions
  ): Promise<string> {
    if (!fs.existsSync(this.charRef2iTemplatePath)) {
      return this.generateImage(prompt, options);
    }

    const uploadedImageName = await this.uploadReferenceImage(refImageUrl);
    const templateRaw = fs.readFileSync(this.charRef2iTemplatePath, 'utf-8');
    const apiPrompt = ensureApiPromptFormat(JSON.parse(templateRaw));

    ComfyUITopologyInjector.injectReferenceImages(apiPrompt, uploadedImageName);
    ComfyUITopologyInjector.injectPrompts(apiPrompt, prompt, options?.negativePrompt);
    ComfyUITopologyInjector.injectSeed(apiPrompt, options?.seed ?? Math.floor(Math.random() * 1000000000));
    ComfyUITopologyInjector.injectImageSize(apiPrompt, options?.size);

    console.log(`[ComfyUIMediaProvider] 正在向 ComfyUI 提交参考图生角色任务 (${this.baseUrl})...`);
    return this.executeAndPoll(apiPrompt, 'image', options?.abortSignal);
  }

  /**
   * 角色换姿态换装 (锁脸 + 可选换装参考图)
   */
  public async generateCharacterPoseOutfit(
    characterImageUrl: string,
    prompt: string,
    outfitImageUrl?: string,
    options?: ImageGenerationOptions
  ): Promise<string> {
    if (!fs.existsSync(this.charPoseOutfitTemplatePath)) {
      return this.generateImage(prompt, options);
    }

    const uploadedCharImage = await this.uploadReferenceImage(characterImageUrl);
    const templateRaw = fs.readFileSync(this.charPoseOutfitTemplatePath, 'utf-8');
    const apiPrompt = ensureApiPromptFormat(JSON.parse(templateRaw));

    const imagesToInject = [uploadedCharImage];
    if (outfitImageUrl) {
      const uploadedOutfitImage = await this.uploadReferenceImage(outfitImageUrl);
      imagesToInject.push(uploadedOutfitImage);
    }
    ComfyUITopologyInjector.injectReferenceImages(apiPrompt, imagesToInject);
    ComfyUITopologyInjector.injectPrompts(apiPrompt, prompt, options?.negativePrompt);
    ComfyUITopologyInjector.injectSeed(apiPrompt, options?.seed ?? Math.floor(Math.random() * 1000000000));
    ComfyUITopologyInjector.injectImageSize(apiPrompt, options?.size);

    console.log(`[ComfyUIMediaProvider] 正在向 ComfyUI 提交换姿换装任务 (${this.baseUrl})...`);
    return this.executeAndPoll(apiPrompt, 'image', options?.abortSignal);
  }

  /**
   * 单图生成角色三视图设定卡 (正/侧/背三等分)
   */
  public async generateCharacterThreeView(
    characterImageUrl: string,
    prompt?: string,
    options?: ImageGenerationOptions
  ): Promise<string> {
    if (!fs.existsSync(this.charThreeViewTemplatePath)) {
      return this.generateImage(prompt || '角色三视图', options);
    }

    const uploadedCharImage = await this.uploadReferenceImage(characterImageUrl);
    const templateRaw = fs.readFileSync(this.charThreeViewTemplatePath, 'utf-8');
    const apiPrompt = ensureApiPromptFormat(JSON.parse(templateRaw));

    ComfyUITopologyInjector.injectReferenceImages(apiPrompt, uploadedCharImage);
    if (prompt) {
      ComfyUITopologyInjector.injectPrompts(apiPrompt, prompt, options?.negativePrompt);
    }
    ComfyUITopologyInjector.injectSeed(apiPrompt, options?.seed ?? Math.floor(Math.random() * 1000000000));
    ComfyUITopologyInjector.injectImageSize(apiPrompt, options?.size);

    console.log(`[ComfyUIMediaProvider] 正在向 ComfyUI 提交单图三视图任务 (${this.baseUrl})...`);
    return this.executeAndPoll(apiPrompt, 'image', options?.abortSignal);
  }

  public async generateImage(prompt: string, options?: ImageGenerationOptions): Promise<string> {
    // 智能调度对应工作流
    if (options?.mode === 'character_three_view' && options?.referenceImageUrl) {
      return this.generateCharacterThreeView(options.referenceImageUrl, prompt, options);
    }
    if (options?.mode === 'character_pose_outfit' && options?.referenceImageUrl) {
      return this.generateCharacterPoseOutfit(options.referenceImageUrl, prompt, options?.outfitImageUrl, options);
    }
    if (options?.mode === 'character_ref2i' && options?.referenceImageUrl) {
      return this.generateCharacterFromRef(prompt, options.referenceImageUrl, options);
    }
    if (options?.mode === 'character_t2i') {
      return this.generateCharacterPortrait(prompt, options);
    }

    if (!fs.existsSync(this.t2iTemplatePath)) {
      throw new Error(`[ComfyUIMediaProvider] 未找到生图工作流模板: ${this.t2iTemplatePath}`);
    }

    const templateRaw = fs.readFileSync(this.t2iTemplatePath, 'utf-8');
    const workflow = ensureApiPromptFormat(JSON.parse(templateRaw));

    ComfyUITopologyInjector.injectPrompts(workflow, prompt, options?.negativePrompt);
    ComfyUITopologyInjector.injectSeed(workflow, options?.seed ?? Math.floor(Math.random() * 1000000000));
    ComfyUITopologyInjector.injectImageSize(workflow, options?.size);

    console.log(`[ComfyUIMediaProvider] 正在向 ComfyUI 提交生图任务 (${this.baseUrl})...`);
    return this.executeAndPoll(workflow, 'image', options?.abortSignal);
  }

  public async generateVideo(prompt: string, options?: VideoGenerationOptions): Promise<string> {
    if (!fs.existsSync(this.i2vTemplatePath)) {
      throw new Error(`[ComfyUIMediaProvider] 未找到生视频工作流模板: ${this.i2vTemplatePath}`);
    }

    const templateRaw = fs.readFileSync(this.i2vTemplatePath, 'utf-8');
    const workflow = ensureApiPromptFormat(JSON.parse(templateRaw));

    let refImageUrl = options?.referenceImageUrl;
    if (!refImageUrl) {
      console.log(`[ComfyUIMediaProvider] 未传入首帧图，正在自动生成首帧基准画面...`);
      refImageUrl = await this.generateImage(`电影分镜基准帧，${prompt}，高保真电影特写，16:9`, {
        size: '1280*720',
        abortSignal: options?.abortSignal,
      });
    }

    const uploadedImageName = await this.uploadReferenceImage(refImageUrl);
    console.log(`[ComfyUIMediaProvider] 首帧参考图已上传至云机: ${uploadedImageName}`);

    ComfyUITopologyInjector.injectReferenceImages(workflow, uploadedImageName);
    ComfyUITopologyInjector.injectPrompts(workflow, prompt || '电影镜头缓慢推进，人物微表情生动，高质量运镜');
    ComfyUITopologyInjector.injectSeed(workflow, Math.floor(Math.random() * 1000000000000));

    console.log(`[ComfyUIMediaProvider] 正在向 ComfyUI 提交视频切片生成任务 (${this.baseUrl})...`);
    return this.executeAndPoll(workflow, 'video', options?.abortSignal);
  }

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

  private async executeAndPoll(
    workflow: any,
    mediaType: 'image' | 'video',
    abortSignal?: AbortSignal
  ): Promise<string> {
    if (abortSignal?.aborted) {
      throw new Error('[ComfyUIMediaProvider] 任务在提交前已被创作者主动取消');
    }

    const apiPrompt = ensureApiPromptFormat(workflow);
    const promptResponse = await fetch(`${this.baseUrl}/prompt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: apiPrompt }),
      signal: abortSignal,
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
      if (abortSignal?.aborted) {
        throw new Error('[ComfyUIMediaProvider] 任务已被创作者主动取消');
      }

      await new Promise((resolve) => setTimeout(resolve, 2000));

      if (abortSignal?.aborted) {
        throw new Error('[ComfyUIMediaProvider] 任务已被创作者主动取消');
      }

      const historyResponse = await fetch(`${this.baseUrl}/history/${promptId}`, {
        signal: abortSignal,
      });
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
