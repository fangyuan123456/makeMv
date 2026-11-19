import fs from 'node:fs';
import path from 'node:path';
import { ProjectStore } from '../../../project-store/ProjectStore.js';
import type { GlobalEntities, PoseConstraint } from '../../../project-store/contracts/film-production/lookdev.js';
import { atomicWriteJsonSync } from '../../../utils/atomicFile.js';
import { imageGenerateTool } from '../../image-generate/image-generate.tool.js';
import { isAbortError } from '../../../workflow-engine/run-context.js';
import type { TaskExecutionContext } from '../../base/task-tool.js';
import { compileVisualEditPrompt, type VisualEditPrompt } from '../visual-edit-prompt.js';
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

function persistEntities(store: ProjectStore, projectId: string, entities: GlobalEntities) {
  store.setArtifact(projectId, 'lookdev_entities', entities);
  const scenesDir = path.join(store.getProjectDir(projectId), 'scenes');
  fs.mkdirSync(scenesDir, { recursive: true });
  atomicWriteJsonSync(path.join(scenesDir, 'entities.json'), entities);
}

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
  try {
    const result = await (imageGenerateTool.execute as any)({ context: {
      projectId, prompt: prompt.text, negativePrompt: prompt.negative,
      referenceImageUrls: referenceUrls,
      mode: profile.mode(Boolean(referenceUrls?.length)), size: profile.size,
      subfolder: profile.subfolder, customFilename: `${id}_${versionId}`,
    } });
    const mediaUrl = result?.mediaUrl || result?.imageUrl;
    if (!result?.success || !mediaUrl) throw new Error(result?.error || '未返回有效媒体链接');

    const poseConstraint = target.poseConstraint || edit?.poseConstraint || entity.poseConstraint;
    const candidate = Boolean(entity.imageUrl && (isEdit || target.force));
    entity.versions.push({ versionId, imageUrl: mediaUrl, promptZh: prompt.savedPrompt || entity.promptZh || prompt.text,
      negativePrompt: target.customNegativePrompt || undefined,
      instruction: target.instruction || undefined,
      derivedFromUrl: isEdit ? referenceUrls?.[0] : undefined,
      referenceImageUrl: entity.referenceImageUrl,
      reviewStatus: candidate ? 'pending' : 'accepted',
      poseConstraint,
      createdAt: new Date().toISOString() });
    if (!candidate) {
      if (prompt.savedPrompt) entity.promptZh = prompt.savedPrompt;
      if (poseConstraint) entity.poseConstraint = poseConstraint;
      entity.selectedVersionId = versionId;
      entity.imageUrl = mediaUrl;
    }
    persistEntities(store, projectId, entities);
    return { mediaUrl, versionId, renderedCount: 1, reviewStatus: candidate ? 'pending' : 'accepted' };
  } catch (error: any) {
    if (isAbortError(error)) throw error;
    throw new Error(`${target.targetKind} [${id}] 定妆失败: ${error?.message || error}`);
  }
}
