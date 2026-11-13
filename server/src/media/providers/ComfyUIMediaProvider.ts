/**
 * media/providers/ComfyUIMediaProvider.ts
 * ComfyUI 纯通用云机/本地渲染执行端基础设施 (ComfyUI Provider SSOT)
 *
 * 核心机制（领域解耦与微内核化）：
 * 1. 彻底剥离上层业务逻辑，专注于工作流 DAG 拓扑参数注入与调度；
 * 2. 提供角色文生图 (character_t2i)、角色参考生图 (character_ref2i)、通用文生图 (t2i)、图生视频 (i2v)；
 * 3. 统一使用 MediaResolver 解析本地媒体文件，防路径穿越；
 * 4. 拓扑自适应注入辅助工具类 (ComfyUITopologyInjector) 保持纯正交可用。
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { IImageProvider, ImageGenerationOptions } from './ImageProvider.js';
import type { IVideoProvider, VideoGenerationOptions } from './VideoProvider.js';
import { config } from '../../utils/config.js';
import { ensureApiPromptFormat } from '../comfyui/comfyui-converter.js';
import { MediaResolver } from '../MediaResolver.js';
import { ConcurrencyPool } from '../../workflow-engine/concurrency.js';
import { combineAbortSignals, getRunContext } from '../../workflow-engine/run-context.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
   * 当工作流没有 EmptyLatentImage（如 ref2i 继承参考图比例）但需要锁定指定画幅时，
   * 在内存中挂载 EmptyLatentImage 并接入 KSampler.latent_image。
   */
  public static ensureEmptyLatent(workflow: Record<string, any>, sizeStr?: string): boolean {
    if (!sizeStr) return false;
    if (this.injectImageSize(workflow, sizeStr)) return true;

    const parts = sizeStr.split(/[x*]/).map((s) => parseInt(s.trim(), 10));
    if (parts.length !== 2 || isNaN(parts[0]) || isNaN(parts[1])) return false;

    const [width, height] = parts;
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
  prompt?: string;
  negativePrompt?: string;
  seed?: number;
  size?: string;
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

    if (options?.mode === 'scene_ref2i' && options?.size) {
      ComfyUITopologyInjector.ensureEmptyLatent(workflow, options.size);
    }

    return this.executeWorkflow(workflow, 'image', {
      prompt,
      negativePrompt: options?.negativePrompt,
      seed: options?.seed,
      size: options?.size,
      referenceImages: refs.length > 0 ? refs : undefined,
      abortSignal: options?.abortSignal,
    });
  }

  /**
   * 通用图生视频
   */
  public async generateVideo(prompt: string, options?: VideoGenerationOptions): Promise<string> {
    const templatePath = this.resolveTemplatePath('comfyui_i2v.json');
    if (!fs.existsSync(templatePath)) {
      throw new Error(`[ComfyUIMediaProvider] 未找到通用生视频工作流模板: ${templatePath}`);
    }

    const templateRaw = fs.readFileSync(templatePath, 'utf-8');
    const workflow = ensureApiPromptFormat(JSON.parse(templateRaw));

    let refImageUrl = options?.referenceImageUrl;
    if (!refImageUrl) {
      console.log(`[ComfyUIMediaProvider] 未传入首帧图，正在自动生成首帧基准画面...`);
      refImageUrl = await this.generateImage(`互动影游电影分镜基准帧，${prompt}，高保真特写，${config.frame.aspect}`, {
        size: config.frame.imageSize,
        abortSignal: options?.abortSignal,
      });
    }

    return this.executeWorkflow(workflow, 'video', {
      prompt: prompt || '电影镜头缓慢推进，人物微表情生动，高质量运镜',
      referenceImages: [refImageUrl],
      abortSignal: options?.abortSignal,
    });
  }

  /**
   * 执行任意通用或技能私有的 ComfyUI 工作流（经串行 GPU 队列防并发超时）
   */
  public async executeWorkflow(
    workflow: any,
    mediaType: 'image' | 'video',
    options?: ComfyUIExecuteOptions
  ): Promise<string> {
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

      return this.executeAndPoll(apiPrompt, mediaType, effectiveSignal);
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

              const mediaUrl = `${this.baseUrl}/view?filename=${encodeURIComponent(
                filename
              )}&subfolder=${encodeURIComponent(subfolder)}&type=${encodeURIComponent(type)}`;
              console.log(
                `[ComfyUIMediaProvider] ${mediaType === 'video' ? '视频' : '图像'}生成完成! 产物 URL: ${mediaUrl}`
              );
              return mediaUrl;
            }
          }
        }
      }
    }

    throw new Error(`[ComfyUIMediaProvider] 等待 ComfyUI 渲染超时 (${timeoutMs / 1000}s)`);
  }
}
