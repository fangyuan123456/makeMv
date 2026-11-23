import fs from 'node:fs';
import path from 'node:path';
import { ProjectStore } from '../../../project-store/ProjectStore.js';
import type { GlobalEntities, PoseConstraint } from '../../../project-store/contracts/film-production/lookdev.js';
import { atomicWriteJsonSync } from '../../../utils/atomicFile.js';
import { imageGenerateTool } from '../../media/image-generate.tool.js';
import { isAbortError } from '../../../workflow-engine/run-context.js';
import type { TaskExecutionContext } from '../../base/task-tool.js';
import { compileVisualEditPrompt, type VisualEditPrompt } from '../shared/visual-edit-prompt.js';
import type { LookdevTarget } from './steps/01-render/schema.js';
import { characterProfile } from './character/index.js';
import { locationProfile } from './location/index.js';
import { itemProfile } from './item/index.js';

export type RenderEntity = {
  name: string;
  imageUrl?: string;
  referenceImageUrl?: string;
  promptZh?: string;
  appearanceSummary?: string;
  poseConstraint?: PoseConstraint;
  versions?: Array<Record<string, unknown>>;
  selectedVersionId?: string;
};

export type RenderProfile = {
  idKey: 'characterId' | 'locationId' | 'itemId';
  subfolder: string;
  size: string;
  mode: (hasReference: boolean) => string;
  reference?: (entity: RenderEntity, isEdit: boolean) => string | undefined;
  prompt: (entity: RenderEntity, artStyle: string, hasReference: boolean, target: LookdevTarget, edit?: VisualEditPrompt) => Promise<{
    text: string;
    negative: string;
    savedPrompt?: string;
  }>;
};

const profiles = { character: characterProfile, location: locationProfile, item: itemProfile };

export async function renderLookdevTarget(
  target: LookdevTarget,
  projectId: string,
  execution: TaskExecutionContext,
): Promise<{ mediaUrl?: string; versionId?: string; renderedCount: number; reviewStatus?: 'pending' | 'accepted' }> {
  const store = ProjectStore.getInstance();
  const entities = store.getArtifact<GlobalEntities>(projectId, 'lookdev_entities');
  if (!entities) throw new Error('项目尚未提取视觉资产');

  const profile: RenderProfile = profiles[target.targetKind];
  const collection = target.targetKind === 'character' ? entities.characters
    : target.targetKind === 'location' ? entities.locations : entities.items;
  const isEdit = Boolean(target.instruction?.trim() || target.customPrompt?.trim() || target.referenceImageUrls?.length || target.poseConstraint);
  const id = target.targetId;

  if (execution.abortSignal?.aborted) throw new Error('定妆任务已取消');
  const entity = collection.find((item) => (item as any)[profile.idKey] === id) as RenderEntity | undefined;
  if (!entity) throw new Error(`定妆清单中不存在 ${target.targetKind} ID: ${id}`);
  if (!Array.isArray(entity.versions)) throw new Error(`${target.targetKind} [${id}] 缺少版本清单`);
  if (entity.imageUrl) {
    const selected = entity.versions.find((version) => version.versionId === entity.selectedVersionId);
    if (!selected || selected.imageUrl !== entity.imageUrl) {
      throw new Error(`${target.targetKind} [${id}] 当前图片与选用版本不一致`);
    }
  } else if (entity.selectedVersionId) {
    throw new Error(`${target.targetKind} [${id}] 没有当前图片却绑定了选用版本`);
  }
  fs.mkdirSync(path.resolve(store.getProjectDir(projectId), profile.subfolder), { recursive: true });

  if (entity.imageUrl && !target.force && !isEdit) {
    return { mediaUrl: entity.imageUrl, versionId: entity.selectedVersionId, renderedCount: 0 };
  }

  const defaultReference = profile.reference?.(entity, isEdit);
  const referenceUrls = target.referenceImageUrls?.length ? target.referenceImageUrls
    : defaultReference ? [defaultReference] : undefined;
  const edit = target.instruction?.trim() && !target.customPrompt?.trim() && referenceUrls?.length
    ? await compileVisualEditPrompt({ entityType: target.targetKind, name: entity.name,
        originalDescription: entity.promptZh || entity.appearanceSummary || '', instruction: target.instruction })
    : undefined;
  const prompt = await profile.prompt(entity, entities.artStyle || '电影级写实光影质感，细节丰富，自然色彩影调', Boolean(referenceUrls?.length), target, edit);
  const versionId = `v_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  // 注意：当前工作流（如 Qwen 文生图与参考图）使用 Empty Latent 作为 KSampler 输入；
  // 必须保持 denoise: 1.0 走完完整采样步数，严禁在采样中途 50% 截断导致 VAE 解码出纯灰褐色高频噪点
  const effectiveDenoise = 1.0;
  try {
    const result = await (imageGenerateTool.execute as any)({ context: {
      projectId, prompt: prompt.text, negativePrompt: prompt.negative,
      referenceImageUrls: referenceUrls,
      denoise: effectiveDenoise,
      mode: profile.mode(Boolean(referenceUrls?.length)), size: profile.size,
      subfolder: profile.subfolder, customFilename: `${id}_${versionId}`,
    } });
    const mediaUrl = result?.mediaUrl || result?.imageUrl;
    if (!result?.success || !mediaUrl) throw new Error(result?.error || '未返回有效媒体链接');

    const poseConstraint = target.poseConstraint || edit?.poseConstraint || entity.poseConstraint;
    // 只要是基于已有图片的定向微调/重新生成候选版本 (isEdit)，均作为 pending 待验收候选版本；
    // 只有初次全量生成或非微调时，才直接作为 accepted 默认生效
    const candidate = Boolean(entity.imageUrl && isEdit);

    // 采用原子变更事务 (mutateArtifact)，基于黑板最新数据增量追加版本并跃迁状态，彻底消灭并发子任务覆盖踩踏
    store.mutateArtifact<GlobalEntities>(projectId, 'lookdev_entities', (latestEntities) => {
      const latestCollection = target.targetKind === 'character' ? latestEntities.characters
        : target.targetKind === 'location' ? latestEntities.locations : latestEntities.items;
      const targetEntity = latestCollection.find((item) => (item as any)[profile.idKey] === id) as RenderEntity | undefined;
      if (!targetEntity) throw new Error(`落盘阶段找不到资产 ${target.targetKind} ID: ${id}`);

      targetEntity.versions = targetEntity.versions || [];
      const newVersionEntry = {
        versionId,
        imageUrl: mediaUrl,
        promptZh: prompt.savedPrompt || targetEntity.promptZh || prompt.text,
        negativePrompt: target.customNegativePrompt || undefined,
        instruction: target.instruction || undefined,
        derivedFromUrl: isEdit ? referenceUrls?.[0] : undefined,
        referenceImageUrl: targetEntity.referenceImageUrl,
        reviewStatus: candidate ? 'pending' : 'accepted',
        poseConstraint,
        createdAt: new Date().toISOString(),
      };

      const existingVerIndex = targetEntity.versions.findIndex(
        (v: any) => v.versionId === versionId || (mediaUrl && v.imageUrl === mediaUrl)
      );
      if (existingVerIndex >= 0) {
        targetEntity.versions[existingVerIndex] = {
          ...targetEntity.versions[existingVerIndex],
          ...newVersionEntry,
        };
      } else {
        targetEntity.versions.push(newVersionEntry);
      }

      if (!candidate) {
        if (prompt.savedPrompt) targetEntity.promptZh = prompt.savedPrompt;
        if (poseConstraint) targetEntity.poseConstraint = poseConstraint;
        targetEntity.selectedVersionId = versionId;
        targetEntity.imageUrl = mediaUrl;
      }
    });

    return { mediaUrl, versionId, renderedCount: 1, reviewStatus: candidate ? 'pending' : 'accepted' };
  } catch (error: any) {
    if (isAbortError(error)) throw error;
    throw new Error(`${target.targetKind} [${id}] 定妆失败: ${error?.message || error}`);
  }
}
