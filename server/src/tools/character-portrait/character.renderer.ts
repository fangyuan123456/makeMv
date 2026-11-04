/**
 * tools/character-portrait/character.renderer.ts
 * 角色定妆照与设定卡领域专属渲染器 (Character Renderer SSOT)
 *
 * 核心机制（领域内聚）：
 * 1. 负责角色专属的 slug / hash 文件命名规则与 characters/ 物理落盘；
 * 2. 调度角色专属的 4 套 ComfyUI 模板 (文生角色、参考图生角色、换姿换装、三视图)；
 * 3. 真实模型驱动 + MediaDownloader 本地持久化 + 离线 FFmpeg 抽帧保真降级；
 * 4. 刚性断点与物理落盘检验 (fs.existsSync 与 size > 0)。
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { ProjectStore } from '../../project-store/ProjectStore.js';
import { MediaResolver } from '../../media/MediaResolver.js';
import { MediaDownloader } from '../../media/MediaDownloader.js';
import { MediaProviderFactory } from '../../media/providers/MediaProviderFactory.js';
import { FFmpegService } from '../../media/ffmpeg.js';
import { ComfyUIMediaProvider } from '../../media/providers/ComfyUIMediaProvider.js';
import { ensureApiPromptFormat } from '../../media/workflows/comfyui-converter.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface CharacterRenderResult {
  url: string;
  isDegraded: boolean;
  degradedReason?: string;
}

export interface CharacterRenderOptions {
  isMock?: boolean;
  abortSignal?: AbortSignal;
  referenceImageUrl?: string;
  outfitImageUrl?: string;
  mode?: 'character_t2i' | 'character_ref2i' | 'character_pose_outfit' | 'character_three_view';
}

export class CharacterRenderer {
  private static ffmpeg: FFmpegService = new FFmpegService();

  public static setFFmpegService(service: FFmpegService): void {
    CharacterRenderer.ffmpeg = service;
  }

  public static getFFmpegService(): FFmpegService {
    return CharacterRenderer.ffmpeg;
  }

  /**
   * 解析本工序目录下的角色工作流模板物理路径
   */
  public static getWorkflowPath(filename: string): string {
    const candidateDirs = [
      path.resolve(__dirname, 'workflows'),
      path.resolve(process.cwd(), 'src/tools/character-portrait/workflows'),
      path.resolve(process.cwd(), 'dist/tools/character-portrait/workflows'),
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
   * 渲染并写入角色定妆照图片
   */
  public static async renderCharacterPortrait(
    projectId: string,
    characterName: string,
    prompt?: string,
    options?: CharacterRenderOptions
  ): Promise<CharacterRenderResult> {
    const projectDir = ProjectStore.getInstance().getProjectDir(projectId);
    const targetDir = path.join(projectDir, 'characters');
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    // 纯安全 ASCII 文件名：杜绝中文 URL 导致物理文件名不一致 404
    const safeSlug = characterName.replace(/[^\w-]/g, '') || 'char';
    let hashVal = 0;
    for (let i = 0; i < characterName.length; i++) {
      hashVal = (hashVal * 31 + characterName.charCodeAt(i)) >>> 0;
    }
    const charHash = hashVal.toString(16).slice(0, 8);
    const baseFilename = `${safeSlug}_${charHash}_portrait`;
    const filename = `${baseFilename}.jpg`;
    const fullPath = path.join(targetDir, filename);

    let degradedReason: string | undefined = options?.isMock
      ? '工程处于 Mock 预演模式，已跳过真实计费'
      : undefined;

    if (options?.abortSignal?.aborted) {
      throw new Error('渲染定妆照已被中断取消');
    }

    // 1. 尝试调用真实文生图模型
    const imageProvider = !options?.isMock ? MediaProviderFactory.getImageProvider() : null;
    if (imageProvider) {
      try {
        const generationPrompt = prompt || `电影角色定妆剧照，${characterName}，高画质电影布光，真实人物特写`;
        const renderMode = options?.mode || (options?.referenceImageUrl ? 'character_ref2i' : 'character_t2i');

        let remoteUrl: string;

        // 如果底层是 ComfyUI 且存在本工序模板，支持直接加载工序私有工作流
        if (imageProvider instanceof ComfyUIMediaProvider) {
          remoteUrl = await this.executeComfyUICharacterWorkflow(
            imageProvider,
            renderMode,
            generationPrompt,
            options
          );
        } else {
          remoteUrl = await imageProvider.generateImage(generationPrompt, {
            size: '720*1280',
            abortSignal: options?.abortSignal,
            referenceImageUrl: options?.referenceImageUrl,
          });
        }

        if (remoteUrl) {
          const localPath = await MediaDownloader.getInstance().downloadToProject(
            projectId,
            remoteUrl,
            'characters',
            baseFilename
          );
          const resolved = MediaResolver.resolveDiskPath(localPath, projectId);
          if (resolved.isValid && fs.statSync(resolved.diskPath).size > 0) {
            return { url: localPath, isDegraded: false };
          }
        }
      } catch (err: any) {
        if (options?.abortSignal?.aborted || err?.name === 'AbortError') {
          throw err;
        }
        degradedReason = `真实文生图模型调用未收敛: ${err.message || '未知异常'}`;
        console.warn(`[CharacterRenderer] 真实模型生成定妆照失败，执行本地降级 (标记 degraded):`, err);
      }
    } else if (!degradedReason) {
      degradedReason = '未配置可用文生图模型凭据 (IMAGE_API_KEY)';
    }

    if (options?.abortSignal?.aborted) {
      throw new Error('渲染定妆照已被中断取消');
    }

    // 2. 本地 FFmpeg 离线渲染 (生成 1 秒视频并抽帧)
    try {
      const tempMp4 = fullPath.replace('.jpg', '.mp4');
      await this.ffmpeg.createTestClip({
        duration: 1,
        text: `Character: ${characterName}`,
        outputPath: tempMp4,
        width: 720,
        height: 1080,
        bgColor: '0x1C1C28',
      });
      await this.ffmpeg.extractFrame(tempMp4, 0, fullPath);
      if (fs.existsSync(tempMp4)) fs.unlinkSync(tempMp4);
    } catch {
      this.writeSolidColorImage(fullPath, 720, 1080, '#1C1C28');
    }

    // 3. 刚性门禁：确保磁盘真实写入且尺寸合规
    if (!fs.existsSync(fullPath) || fs.statSync(fullPath).size === 0) {
      this.writeSolidColorImage(fullPath, 720, 1080, '#1C1C28');
    }

    return {
      url: MediaResolver.toMediaUrl(projectId, 'characters', filename),
      isDegraded: true,
      degradedReason,
    };
  }

  /**
   * 渲染角色换姿态换装
   */
  public static async renderCharacterPoseOutfit(
    projectId: string,
    characterName: string,
    prompt: string,
    characterImageUrl: string,
    outfitImageUrl?: string,
    options?: Omit<CharacterRenderOptions, 'referenceImageUrl' | 'outfitImageUrl' | 'mode'>
  ): Promise<CharacterRenderResult> {
    return this.renderCharacterPortrait(projectId, characterName, prompt, {
      ...options,
      mode: 'character_pose_outfit',
      referenceImageUrl: characterImageUrl,
      outfitImageUrl,
    });
  }

  /**
   * 渲染角色单图三视图设定卡
   */
  public static async renderCharacterThreeView(
    projectId: string,
    characterName: string,
    prompt: string,
    characterImageUrl: string,
    options?: Omit<CharacterRenderOptions, 'referenceImageUrl' | 'mode'>
  ): Promise<CharacterRenderResult> {
    return this.renderCharacterPortrait(projectId, characterName, prompt, {
      ...options,
      mode: 'character_three_view',
      referenceImageUrl: characterImageUrl,
    });
  }

  /**
   * 调用 ComfyUI 执行角色专属工作流
   */
  private static async executeComfyUICharacterWorkflow(
    provider: ComfyUIMediaProvider,
    mode: string,
    prompt: string,
    options?: CharacterRenderOptions
  ): Promise<string> {
    let templateFile = 'comfyui_character_t2i.json';
    if (mode === 'character_ref2i') templateFile = 'comfyui_character_ref2i.json';
    else if (mode === 'character_pose_outfit') templateFile = 'comfyui_character_pose_outfit.json';
    else if (mode === 'character_three_view') templateFile = 'comfyui_character_three_view.json';

    const templatePath = this.getWorkflowPath(templateFile);
    if (!fs.existsSync(templatePath)) {
      return provider.generateImage(prompt, {
        size: '720*1280',
        abortSignal: options?.abortSignal,
      });
    }

    const templateRaw = fs.readFileSync(templatePath, 'utf-8');
    const apiPrompt = ensureApiPromptFormat(JSON.parse(templateRaw));

    return provider.executeWorkflow(apiPrompt, 'image', {
      prompt,
      abortSignal: options?.abortSignal,
      referenceImages: [
        options?.referenceImageUrl,
        options?.outfitImageUrl,
      ].filter(Boolean) as string[],
    });
  }

  /**
   * 写入合法有效的单帧像素标准图片 (极速离线与高容错兜底)
   */
  private static writeSolidColorImage(
    outputPath: string,
    width: number,
    height: number,
    bgColorHex: string
  ): void {
    const minimalJpeg = Buffer.from([
      0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
      0x01, 0x01, 0x00, 0x48, 0x00, 0x48, 0x00, 0x00, 0xff, 0xdb, 0x00, 0x43,
      0x00, 0x08, 0x06, 0x06, 0x07, 0x06, 0x05, 0x08, 0x07, 0x07, 0x07, 0x09,
      0x09, 0x08, 0x0a, 0x0c, 0x14, 0x0d, 0x0c, 0x0b, 0x0b, 0x0c, 0x19, 0x12,
      0x13, 0x0f, 0x14, 0x1d, 0x1a, 0x1f, 0x1e, 0x1d, 0x1a, 0x1c, 0x1c, 0x20,
      0x24, 0x2e, 0x27, 0x20, 0x22, 0x2c, 0x23, 0x1c, 0x1c, 0x28, 0x37, 0x29,
      0x2c, 0x30, 0x31, 0x34, 0x34, 0x34, 0x1f, 0x27, 0x39, 0x3d, 0x38, 0x32,
      0x3c, 0x2e, 0x33, 0x34, 0x32, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01,
      0x00, 0x01, 0x01, 0x01, 0x11, 0x00, 0xff, 0xc4, 0x00, 0x1f, 0x00, 0x00,
      0x01, 0x05, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01, 0x00, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08,
      0x09, 0x0a, 0x0b, 0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f,
      0x00, 0xbf, 0x80, 0xff, 0xd9,
    ]);
    fs.writeFileSync(outputPath, minimalJpeg);
  }
}
