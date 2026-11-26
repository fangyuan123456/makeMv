/**
 * media/providers/ComfyUIMediaProvider.ts
 * ComfyUI 纯通用云机/本地渲染执行端基础设施 (ComfyUI Provider SSOT)
 *
 * 核心机制（领域解耦与微内核化）：
 * 1. 彻底剥离上层业务逻辑，专注于工作流 DAG 拓扑参数注入与调度；
 * 2. 提供角色文生图 (character_t2i)、角色参考生图 (character_ref2i)、通用文生图 (t2i)、多图参考直出视频 (ref2v)；
 * 3. 统一使用 MediaResolver 解析本地媒体文件，防路径穿越；
 * 4. 拓扑自适应注入辅助工具类 (ComfyUITopologyInjector) 保持纯正交可用。
 */

import fs from 'fs';
import path from 'path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'url';
import type { IImageProvider, ImageGenerationOptions, ImageUpscaleOptions } from './ImageProvider.js';
import type { IVideoProvider, VideoGenerationOptions } from './VideoProvider.js';
import { config } from '../../utils/config.js';
import { ensureApiPromptFormat } from '../comfyui/comfyui-converter.js';
import { MediaResolver } from '../MediaResolver.js';
import { ConcurrencyPool } from '../../workflow-engine/concurrency.js';
import { combineAbortSignals, getRunContext } from '../../workflow-engine/run-context.js';
import { atomicWriteJsonSync, safeReadJsonSync } from '../../utils/atomicFile.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const MEDIA_REQUEST_LEDGER = path.join(config.paths.data, 'media-requests.json');

interface MediaRequestRecord {
  promptId: string;
  mediaType: 'image' | 'video';
  mediaUrl?: string;
  updatedAt: string;
}

function readMediaRequestLedger(): Record<string, MediaRequestRecord> {
  return safeReadJsonSync<Record<string, MediaRequestRecord>>(MEDIA_REQUEST_LEDGER) || {};
}

function writeMediaRequestRecord(requestId: string, record: MediaRequestRecord): void {
  const ledger = readMediaRequestLedger();
  ledger[requestId] = record;
  atomicWriteJsonSync(MEDIA_REQUEST_LEDGER, ledger);
}

/** 生图模式 → 工作流模板唯一映射（显式 mode 优先于参考图回落） */
const MODE_TEMPLATES: Record<NonNullable<ImageGenerationOptions['mode']>, string> = {
  character_t2i: 'comfyui_character_t2i.json',
  character_ref2i: 'comfyui_character_ref2i.json',
  character_pose_outfit: 'comfyui_character_pose_outfit.json',
  character_three_view: 'comfyui_character_three_view.json',
  scene_ref2i: 'comfyui_character_ref2i.json',
  general_t2i: 'comfyui_t2i.json',
};

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
          } else if ('negative_prompt' in targetNode.inputs) {
            targetNode.inputs.negative_prompt = negativePrompt;
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
          node.inputs.negative_prompt = negativePrompt;
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

    // 4. 包含单体 prompt 属性的节点
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
  public static injectSeed(workflow: Record<string, any>, seed: number): boolean {
    let injected = false;
    for (const node of Object.values(workflow)) {
      if (node?.inputs && ('seed' in node.inputs || 'noise_seed' in node.inputs)) {
        if ('seed' in node.inputs) node.inputs.seed = seed;
        if ('noise_seed' in node.inputs) node.inputs.noise_seed = seed;
        injected = true;
      }
    }
    return injected;
  }

  /**
   * 拓扑注入采样器去噪强度 (Denoise)
   */
  public static injectSamplerDenoise(workflow: Record<string, any>, denoise?: number): boolean {
    if (typeof denoise !== 'number' || isNaN(denoise) || denoise <= 0 || denoise > 1.0) {
      return false;
    }
    let injected = false;
    for (const node of Object.values(workflow)) {
      if (
        (node?.class_type === 'KSampler' || node?.class_type === 'KSamplerAdvanced') &&
        node.inputs &&
        'denoise' in node.inputs
      ) {
        node.inputs.denoise = Number(denoise.toFixed(2));
        injected = true;
      }
    }
    return injected;
  }

  /**
   * 拓扑注入画面尺寸 (Width / Height)
   */
  public static injectImageSize(workflow: Record<string, any>, sizeStr?: string): boolean {
    if (!sizeStr) return false;
    const parts = sizeStr.split(/[x*]/).map((s) => parseInt(s.trim(), 10));
    if (parts.length !== 2 || isNaN(parts[0]) || isNaN(parts[1])) return false;

    const [width, height] = parts;
    let injected = false;

    for (const node of Object.values(workflow)) {
      if (node?.inputs && ('width' in node.inputs || 'height' in node.inputs)) {
        if ('width' in node.inputs) node.inputs.width = width;
        if ('height' in node.inputs) node.inputs.height = height;
        injected = true;
      }
    }
    return injected;
  }

  /**
   * 当工作流没有 EmptyLatentImage（如 ref2i 默认连向 TextEncodeQwenImage21.latent 原图潜空间）或需要锁定指定画幅时，
   * 确保 KSampler.latent_image 可靠接入干净的 EmptyLatentImage，彻底打碎原图几何骨骼的像素级潜空间死锁。
   */
  public static ensureEmptyLatent(workflow: Record<string, any>, sizeStr?: string): boolean {
    if (!sizeStr) return false;
    const parts = sizeStr.split(/[x*]/).map((s) => parseInt(s.trim(), 10));
    if (parts.length !== 2 || isNaN(parts[0]) || isNaN(parts[1])) return false;
    const [width, height] = parts;

    // 1. 检查采样器 (KSampler / KSamplerAdvanced) 的 latent_image 是否已经接入 EmptyLatentImage
    let needsNewEmptyLatent = true;
    for (const node of Object.values(workflow)) {
      if (
        (node?.class_type === 'KSampler' || node?.class_type === 'KSamplerAdvanced') &&
        node.inputs &&
        'latent_image' in node.inputs
      ) {
        const currentLatentInput = node.inputs.latent_image;
        if (Array.isArray(currentLatentInput) && currentLatentInput.length >= 1) {
          const targetNodeId = String(currentLatentInput[0]);
          const targetNode = workflow[targetNodeId];
          if (targetNode?.class_type === 'EmptyLatentImage') {
            // 已接入纯净 EmptyLatentImage，直接注入尺寸即可
            targetNode.inputs.width = width;
            targetNode.inputs.height = height;
            needsNewEmptyLatent = false;
          }
        }
      }
    }

    if (!needsNewEmptyLatent) {
      this.injectImageSize(workflow, sizeStr);
      return true;
    }

    // 2. 若原本没有接入 EmptyLatentImage（例如接入了 TextEncodeQwenImage21.latent 残差潜空间），
    // 强制在拓扑中动态挂载纯净 EmptyLatentImage 并重新连线，彻底打破骨骼姿态死锁
    const maxNumericId = Object.keys(workflow).reduce((max, k) => {
      const n = /^\d+$/.test(k) ? parseInt(k, 10) : 0;
      return Math.max(max, n);
    }, 0);
    const latentNodeId = String(maxNumericId + 1);

    workflow[latentNodeId] = {
      class_type: 'EmptyLatentImage',
      inputs: {
        width,
        height,
        batch_size: 1,
      },
    };

    let wired = false;
    for (const node of Object.values(workflow)) {
      if (
        (node?.class_type === 'KSampler' || node?.class_type === 'KSamplerAdvanced') &&
        node.inputs &&
        'latent_image' in node.inputs
      ) {
        node.inputs.latent_image = [latentNodeId, 0];
        wired = true;
      }
    }

    return wired;
  }

  /**
   * 拓扑注入参考图文件名 (至 LoadImage 节点列表；超出已有 LoadImage 数时为 TextEncodeQwenImage21 动态增补 COMFY_AUTOGROW_V3 槽位)
   */
  public static injectReferenceImages(
    workflow: Record<string, any>,
    imageFilenames: string | string[]
  ): void {
    const list = Array.isArray(imageFilenames) ? imageFilenames : [imageFilenames];
    if (list.length === 0) return;

    const loadEntries = Object.entries(workflow)
      .filter(([, n]) => n?.class_type === 'LoadImage' && n.inputs)
      .sort(([a], [b]) => Number(a) - Number(b));
    if (loadEntries.length === 0) return;

    const qwenEntry = Object.entries(workflow).find(
      ([, n]) => n?.class_type === 'TextEncodeQwenImage21' && n.inputs
    );
    const h3RefEntry = Object.entries(workflow).find(
      ([, n]) => n?.class_type === 'MiniMaxH3ReferenceToVideo' && n.inputs
    );

    if (h3RefEntry) {
      const capped = list.slice(0, 9);
      let maxNumericId = Object.keys(workflow).reduce((max, k) => {
        const n = /^\d+$/.test(k) ? parseInt(k, 10) : 0;
        return Math.max(max, n);
      }, 0);

      // 清理原有 ref_images.ref_image_* 槽位，按实际传入图片数精确重绑
      for (const key of Object.keys(h3RefEntry[1].inputs)) {
        if (key.startsWith('ref_images.ref_image_')) {
          delete h3RefEntry[1].inputs[key];
        }
      }

      const usedLoadIds = new Set<string>();
      for (let i = 0; i < capped.length; i++) {
        let loadNodeId: string;
        if (i < loadEntries.length) {
          loadNodeId = loadEntries[i][0];
          loadEntries[i][1].inputs.image = capped[i];
        } else {
          maxNumericId += 1;
          loadNodeId = String(maxNumericId);
          workflow[loadNodeId] = {
            class_type: 'LoadImage',
            inputs: {
              image: capped[i],
            },
          };
        }
        usedLoadIds.add(loadNodeId);
        h3RefEntry[1].inputs[`ref_images.ref_image_${i}`] = [loadNodeId, 0];
      }

      // 移除多余未使用的 LoadImage 节点，避免模板默认占位文件名触发 ComfyUI 校验报错
      for (const [nodeId] of loadEntries) {
        if (!usedLoadIds.has(nodeId)) {
          delete workflow[nodeId];
        }
      }
      return;
    }

    if (list.length === 1) {
      for (const [, node] of loadEntries) {
        node.inputs.image = list[0];
      }
      return;
    }

    const capped = qwenEntry ? list.slice(0, 16) : list;
    let maxNumericId = Object.keys(workflow).reduce((max, k) => {
      const n = /^\d+$/.test(k) ? parseInt(k, 10) : 0;
      return Math.max(max, n);
    }, 0);

    for (let i = 0; i < capped.length; i++) {
      let loadNodeId: string;
      if (i < loadEntries.length) {
        loadNodeId = loadEntries[i][0];
        loadEntries[i][1].inputs.image = capped[i];
      } else if (qwenEntry) {
        maxNumericId += 1;
        loadNodeId = String(maxNumericId);
        workflow[loadNodeId] = {
          class_type: 'LoadImage',
          inputs: {
            image: capped[i],
            upload: 'image',
          },
        };
      } else {
        break;
      }

      if (qwenEntry) {
        qwenEntry[1].inputs[`images.image_${i + 1}`] = [loadNodeId, 0];
      }
    }
  }
}

export interface ComfyUIExecuteOptions {
  requestId?: string;
  prompt?: string;
  negativePrompt?: string;
  seed?: number;
  size?: string;
  denoise?: number;
  referenceImages?: string[];
  abortSignal?: AbortSignal;
}

const comfyGpuPools = new Map<string, ConcurrencyPool>();

function getComfyGpuPool(baseUrl: string): ConcurrencyPool {
  const key = baseUrl.replace(/\/+$/, '');
  let pool = comfyGpuPools.get(key);
  if (!pool) {
    pool = new ConcurrencyPool(config.comfyui.maxConcurrency);
    comfyGpuPools.set(key, pool);
  }
  return pool;
}

export class ComfyUIMediaProvider implements IImageProvider, IVideoProvider {
  public readonly name = 'comfyui';
  private baseUrl: string;
  private inFlightRequests = new Map<string, Promise<string>>();

  constructor(customBaseUrl?: string) {
    this.baseUrl = (customBaseUrl || config.comfyui.baseUrl).replace(/\/+$/, '');
  }

  public static getGpuPool(baseUrl: string = config.comfyui.baseUrl): ConcurrencyPool {
    return getComfyGpuPool(baseUrl);
  }

  /**
   * 按 ComfyUI 地址共享全局 GPU 槽位池（图像与视频共池限流，支持排队期间被 AbortSignal 取消）
   */
  private runExclusive<T>(fn: () => Promise<T>, abortSignal?: AbortSignal): Promise<T> {
    return getComfyGpuPool(this.baseUrl).run(fn, abortSignal);
  }

  public resolveTemplatePath(filename: string): string {
    const candidateDirs = [
      path.resolve(__dirname, '../comfyui/workflows'),
      path.resolve(config.paths.root, 'src/media/comfyui/workflows'),
      path.resolve(config.paths.root, 'dist/media/comfyui/workflows'),
      path.resolve(config.paths.root, 'workflows'),
    ];

    for (const dir of candidateDirs) {
      const fullPath = path.join(dir, filename);
      if (fs.existsSync(fullPath)) {
        return fullPath;
      }
    }
    return path.join(candidateDirs[0], filename);
  }

  /**
   * 通用与角色/场景文生图（支持单图及多定妆参考图动态连线）
   */
  public async generateImage(prompt: string, options?: ImageGenerationOptions): Promise<string> {
    const refs = (options?.referenceImageUrls || []).filter(
      (u) => typeof u === 'string' && u.trim().length > 0
    );

    // 显式 mode 优先；只有未指定 mode 且带参考图时，才按参考图语义回落到 ref2i
    const templateFile = options?.mode
      ? (MODE_TEMPLATES[options.mode] ?? 'comfyui_t2i.json')
      : refs.length > 0
        ? 'comfyui_character_ref2i.json'
        : 'comfyui_t2i.json';

    const templatePath = this.resolveTemplatePath(templateFile);
    if (!fs.existsSync(templatePath)) {
      throw new Error(`[ComfyUIMediaProvider] 未找到生图工作流模板: ${templatePath}`);
    }

    const templateRaw = fs.readFileSync(templatePath, 'utf-8');
    const workflow = ensureApiPromptFormat(JSON.parse(templateRaw));

    const isEditMode = typeof options?.denoise === 'number' && options.denoise < 1.0;
    // 仅在全新采样模式 (denoise >= 1.0) 且有参考图和尺寸时，才挂载 EmptyLatentImage 打碎骨骼姿态；
    // 在自适应微调修改模式 (denoise < 1.0) 下，严格保留原图潜空间几何骨骼，仅注入 denoise 降噪强度！
    if (refs.length > 0 && options?.size && !isEditMode) {
      ComfyUITopologyInjector.ensureEmptyLatent(workflow, options.size);
    }

    return this.executeWorkflow(workflow, 'image', {
      prompt,
      negativePrompt: options?.negativePrompt,
      seed: options?.seed,
      size: options?.size,
      denoise: options?.denoise,
      referenceImages: refs.length > 0 ? refs : undefined,
      abortSignal: options?.abortSignal,
      requestId: options?.requestId || this.buildRequestId('image', prompt, options),
    });
  }

  /**
   * 图片高清超分（基于官方 SeedVR2 3B INT8 工作流）
   */
  public async upscaleImage(imageUrl: string, options?: ImageUpscaleOptions): Promise<string> {
    if (!imageUrl || !imageUrl.trim()) {
      throw new Error('[ComfyUIMediaProvider] 超分缺少有效的源图片地址');
    }

    const templatePath = this.resolveTemplatePath('comfyui_seedvr2_upscale.json');
    if (!fs.existsSync(templatePath)) {
      throw new Error(`[ComfyUIMediaProvider] 未找到超分工作流模板: ${templatePath}`);
    }

    const templateRaw = fs.readFileSync(templatePath, 'utf-8');
    const workflow = ensureApiPromptFormat(JSON.parse(templateRaw));

    const multiplier = Math.min(4, Math.max(1, Number(options?.multiplier) || 2));
    const colorCorrection = options?.colorCorrection || 'none';

    for (const node of Object.values(workflow)) {
      if (node?.class_type === 'ResizeImageMaskNode' && node.inputs) {
        node.inputs['resize_type'] = 'scale by multiplier';
        node.inputs['resize_type.multiplier'] = multiplier;
      } else if (node?.class_type === 'SeedVR2PostProcessing' && node.inputs) {
        node.inputs.color_correction_method = colorCorrection;
      }
    }

    return this.executeWorkflow(workflow, 'image', {
      seed: options?.seed,
      referenceImages: [imageUrl.trim()],
      abortSignal: options?.abortSignal,
      requestId: options?.requestId || this.buildRequestId('upscale', imageUrl, { multiplier, colorCorrection }),
    });
  }

  /**
   * 通用生视频 (MiniMax H3 多图全能参考直出 Ref2V，时长支持 5~15s)
   */
  public async generateVideo(prompt: string, options?: VideoGenerationOptions): Promise<string> {
    const templateName = 'comfyui_h3_ref2v_6step.json';
    const templatePath = this.resolveTemplatePath(templateName);
    if (!fs.existsSync(templatePath)) {
      throw new Error(`[ComfyUIMediaProvider] 未找到生视频工作流模板: ${templatePath}`);
    }

    const templateRaw = fs.readFileSync(templatePath, 'utf-8');
    const workflow = ensureApiPromptFormat(JSON.parse(templateRaw));

    let referenceImages = (options?.referenceImageUrls || []).filter((u) => typeof u === 'string' && u.trim().length > 0);
    if (referenceImages.length === 0 && options?.referenceImageUrl) {
      referenceImages = [options.referenceImageUrl];
    }
    if (referenceImages.length === 0) {
      throw new Error('[ComfyUIMediaProvider] 多图参考直出视频缺少参考图 (referenceImageUrls)');
    }

    // 1. 全剧画幅 SSOT 动态注入（DiT 空间下采样与 BlockSparseAttention 算子硬性要求画幅为 32 整数倍，如 1280x704）
    const baseWidth = config.frame.width || 1280;
    const baseHeight = config.frame.height || 720;
    const targetWidth = Math.max(32, Math.floor(baseWidth / 32) * 32);
    const targetHeight = Math.max(32, Math.floor(baseHeight / 32) * 32);

    // 2. 镜头目标时长与帧数动态对齐 (MiniMax H3 Ref2V 步长 step=17: 124~362 帧 @24fps，约 5s~15s)
    const durationSec = typeof options?.duration === 'number' && options.duration > 0
      ? Math.min(15, Math.max(2, options.duration))
      : 5;
    const fps = 24;
    const rawFrames = Math.round(durationSec * fps);
    const ref2vLength = Math.min(362, Math.max(124, 124 + Math.round((rawFrames - 124) / 17) * 17));

    // 3. 动态配置工作流节点
    for (const node of Object.values(workflow)) {
      if (node?.class_type === 'MiniMaxH3ReferenceToVideo' && node?.inputs) {
        node.inputs.width = targetWidth;
        node.inputs.height = targetHeight;
        node.inputs.length = ref2vLength;
      }
      if (node?.class_type === 'CreateVideo' && node?.inputs) {
        node.inputs.fps = fps;
      }
    }

    console.log(`[ComfyUIMediaProvider] 视频拓扑注入完成 (H3-Ref2V直出): 画幅=${targetWidth}x${targetHeight}, 时长=${durationSec}s, 帧数=${ref2vLength}@${fps}fps, 参考图数=${referenceImages.length}`);

    return this.executeWorkflow(workflow, 'video', {
      prompt: prompt || '电影镜头自然推进，人物动作连贯，写实物理速率，高质量运镜',
      referenceImages,
      abortSignal: options?.abortSignal,
      requestId: options?.requestId || this.buildRequestId('video', prompt, options),
    });
  }

  private buildRequestId(kind: string, prompt: string, options: unknown): string {
    const runContext = getRunContext();
    const runId = runContext?.idempotencyKey || runContext?.runId || 'standalone';
    const fingerprint = crypto
      .createHash('sha256')
      .update(JSON.stringify({ kind, prompt, options }))
      .digest('hex')
      .slice(0, 20);
    return `${runId}:${fingerprint}`;
  }

  /**
   * 执行任意通用或技能私有的 ComfyUI 工作流（经串行 GPU 队列防并发超时）
   */
  public async executeWorkflow(
    workflow: any,
    mediaType: 'image' | 'video',
    options?: ComfyUIExecuteOptions
  ): Promise<string> {
    const requestId = options?.requestId;
    if (requestId) {
      const existing = this.inFlightRequests.get(requestId);
      if (existing) return existing;
      const promise = this.executeWorkflowInternal(workflow, mediaType, options);
      this.inFlightRequests.set(requestId, promise);
      const clearRequest = () => {
        if (this.inFlightRequests.get(requestId) === promise) {
          this.inFlightRequests.delete(requestId);
        }
      };
      void promise.then(clearRequest, clearRequest);
      return promise;
    }
    return this.executeWorkflowInternal(workflow, mediaType, options);
  }

  private async executeWorkflowInternal(
    workflow: any,
    mediaType: 'image' | 'video',
    options?: ComfyUIExecuteOptions
  ): Promise<string> {
    const requestId = options?.requestId;
    const effectiveSignal = combineAbortSignals(options?.abortSignal, getRunContext()?.abortSignal);
    return this.runExclusive(async () => {
      const apiPrompt = ensureApiPromptFormat(workflow);

      // 1. 若提供了参考图，依次上传至 ComfyUI 并拓扑注入 LoadImage
      if (options?.referenceImages && options.referenceImages.length > 0) {
        const uploadedNames: string[] = [];
        for (const imgUrl of options.referenceImages) {
          const uploadedName = await this.uploadImage(imgUrl);
          uploadedNames.push(uploadedName);
        }
        ComfyUITopologyInjector.injectReferenceImages(apiPrompt, uploadedNames);
      }

      // 2. 注入提示词
      if (options?.prompt) {
        ComfyUITopologyInjector.injectPrompts(apiPrompt, options.prompt, options?.negativePrompt);
        console.log(`[ComfyUIMediaProvider] 注入正向提示词: ${options.prompt.slice(0, 100)}...`);
      }
      if (options?.negativePrompt) {
        console.log(`[ComfyUIMediaProvider] 注入负向提示词: ${options.negativePrompt}`);
      }

      // 3. 注入随机种子
      const seed = options?.seed ?? Math.floor(Math.random() * 1000000000);
      ComfyUITopologyInjector.injectSeed(apiPrompt, seed);

      // 4. 注入画幅尺寸（无宽高节点的工作流必须显式告警，禁止静默吞掉参数）
      if (options?.size) {
        const sizeInjected = ComfyUITopologyInjector.injectImageSize(apiPrompt, options.size);
        if (!sizeInjected) {
          console.warn(
            `[ComfyUIMediaProvider] 当前工作流不含 width/height 节点，size=${options.size} 未生效（该参数已被忽略）`
          );
        }
      }

      // 5. 注入采样器去噪强度 (自适应 Denoise，用于稳定微调修改)
      if (options?.denoise !== undefined) {
        ComfyUITopologyInjector.injectSamplerDenoise(apiPrompt, options.denoise);
      }

      return this.executeAndPoll(apiPrompt, mediaType, effectiveSignal, requestId);
    }, effectiveSignal);
  }

  /**
   * 上传本地/远程媒体文件至 ComfyUI 服务
   */
  public async uploadImage(imageUrlOrPath: string): Promise<string> {
    let fileBuffer: Buffer;
    let fileName = `ref_${Date.now()}.png`;

    const resolved = MediaResolver.resolveDiskPath(imageUrlOrPath);
    if (resolved.isValid && resolved.diskPath) {
      fileBuffer = fs.readFileSync(resolved.diskPath);
      fileName = path.basename(resolved.diskPath);
    } else if (imageUrlOrPath.startsWith('http://') || imageUrlOrPath.startsWith('https://')) {
      const res = await fetch(imageUrlOrPath);
      if (!res.ok) throw new Error(`获取参考图失败: HTTP ${res.status}`);
      fileBuffer = Buffer.from(await res.arrayBuffer());
    } else {
      throw new Error(`[ComfyUIMediaProvider] 无法定位或读取参考图片: ${imageUrlOrPath}`);
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
    abortSignal?: AbortSignal,
    requestId?: string
  ): Promise<string> {
    if (abortSignal?.aborted) {
      throw new Error('[ComfyUIMediaProvider] 任务在提交前已被创作者主动取消');
    }

    const apiPrompt = ensureApiPromptFormat(workflow);
    const existing = requestId ? readMediaRequestLedger()[requestId] : undefined;
    if (existing?.mediaUrl) return existing.mediaUrl;

    let promptId = existing?.promptId;
    if (!promptId) {
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
      promptId = promptResult.prompt_id;
      if (!promptId) {
        throw new Error('[ComfyUIMediaProvider] ComfyUI 未返回合法的 prompt_id');
      }
      if (requestId) {
        writeMediaRequestRecord(requestId, {
          promptId,
          mediaType,
          updatedAt: new Date().toISOString(),
        });
      }
    }

    console.log(
      `[ComfyUIMediaProvider] ${mediaType === 'video' ? '视频' : '图像'}任务提交成功, prompt_id: ${promptId}, 正在轮询等待渲染...`
    );

    const startTime = Date.now();
    const timeoutMs =
      mediaType === 'video'
        ? (config.comfyui.timeoutMs || 180000) * 2
        : config.comfyui.timeoutMs || 180000;

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
          const mediaErr = new Error(`[ComfyUIMediaProvider] ComfyUI 渲染报错: ${messages}`);
          (mediaErr as any).failureType = 'media_service_error';
          throw mediaErr;
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

              const mediaUrl = `${this.baseUrl}/view?filename=${encodeURIComponent(
                filename
              )}&subfolder=${encodeURIComponent(subfolder)}&type=${encodeURIComponent(type)}`;
              console.log(
                `[ComfyUIMediaProvider] ${mediaType === 'video' ? '视频' : '图像'}生成完成! 产物 URL: ${mediaUrl}`
              );
              if (requestId) {
                writeMediaRequestRecord(requestId, {
                  promptId,
                  mediaType,
                  mediaUrl,
                  updatedAt: new Date().toISOString(),
                });
              }
              return mediaUrl;
            }
          }
        }
      }
    }

    const timeoutErr = new Error(`[ComfyUIMediaProvider] 等待 ComfyUI 渲染超时 (${timeoutMs / 1000}s)`);
    (timeoutErr as any).failureType = 'media_service_error';
    throw timeoutErr;
  }
}
