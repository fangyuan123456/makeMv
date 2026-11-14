/**
 * agents/film-production/03-video-studio/lookdev/lookdev.workflow.ts
 * 影视定妆子工作流 (Lookdev Workflow SSOT)
 */

import { Workflow } from '@mastra/core/workflows';
import { z } from 'zod';
import { ProjectStore } from '../../../../project-store/ProjectStore.js';
import type { GlobalEntities } from '../../../../project-store/contracts/film-production/lookdev.js';
import {
  renderCharacterPortrait,
  characterPortraitStep,
} from './steps/character-portrait/index.js';
import {
  renderPropLookdev,
  propLookdevStep,
} from './steps/prop-lookdev/index.js';
import {
  renderSceneAtmosphere,
  sceneAtmosphereStep,
} from './steps/scene-atmosphere/index.js';

export interface LookdevWorkflowResult {
  success: boolean;
  entities: GlobalEntities;
  renderedCount: number;
  totalCount: number;
}

/**
 * 动态组装定妆子工作流实例 (Mastra 原生 Workflow)
 */
export function createLookdevWorkflow(projectId: string, entities: GlobalEntities): Workflow {
  const triggerSchema = z.object({
    projectId: z.string(),
    force: z.boolean().default(false),
  });

  const wf = new Workflow({
    name: `lookdev_workflow_${projectId}`,
    triggerSchema,
  });

  // 顺序挂载角色、道具与场景工序
  let builder: any = wf.step(characterPortraitStep);
  builder = builder.then(propLookdevStep);
  builder = builder.then(sceneAtmosphereStep);

  return builder.commit();
}

/**
 * 影视定妆子工作流高阶执行器：按提取清单逐一驱动出图
 */
export async function executeLookdevWorkflow(params: {
  projectId: string;
  force?: boolean;
  onProgress?: (note: string, percent: number) => void;
}): Promise<LookdevWorkflowResult> {
  const { projectId, force = false, onProgress } = params;
  const store = ProjectStore.getInstance();
  const entities = store.getArtifact<GlobalEntities>(projectId, 'lookdev_entities');

  if (!entities) {
    throw new Error(`[LookdevWorkflow] 项目 [${projectId}] 尚未提取视觉设定清单`);
  }

  const allItems: Array<{ id: string; kind: 'character' | 'item' | 'location'; name: string }> = [
    ...entities.characters.map((c) => ({ id: c.characterId, kind: 'character' as const, name: c.name })),
    ...entities.items.map((i) => ({ id: i.itemId, kind: 'item' as const, name: i.name })),
    ...entities.locations.map((l) => ({ id: l.locationId, kind: 'location' as const, name: l.name })),
  ];

  const total = allItems.length;
  let rendered = 0;

  for (let i = 0; i < total; i++) {
    const item = allItems[i];
    const itemLabel = item.kind === 'character' ? '角色立绘' : item.kind === 'item' ? '关键道具' : '场景空镜';
    onProgress?.(`定妆出图 (${i + 1}/${total})：[${itemLabel}] ${item.name}...`, Math.round(((i + 0.3) / total) * 100));

    let success = false;
    if (item.kind === 'character') {
      const res = await renderCharacterPortrait({ projectId, characterId: item.id, force });
      success = res.success;
    } else if (item.kind === 'item') {
      const res = await renderPropLookdev({ projectId, itemId: item.id, force });
      success = res.success;
    } else {
      const res = await renderSceneAtmosphere({ projectId, locationId: item.id, force });
      success = res.success;
    }

    if (success) rendered++;
    onProgress?.(`定妆已完成 (${i + 1}/${total})：[${itemLabel}] ${item.name}`, Math.round(((i + 1) / total) * 100));
  }

  const updated = store.getArtifact<GlobalEntities>(projectId, 'lookdev_entities')!;
  return {
    success: rendered > 0,
    entities: updated,
    renderedCount: rendered,
    totalCount: total,
  };
}

/**
 * 单实体定妆出图/重绘原子执行器 (可在工坊 UI 中针对单项重试/重绘)
 */
export async function renderSingleLookdevEntity(params: {
  projectId: string;
  entityId: string;
  kind: 'character' | 'item' | 'location';
  force?: boolean;
}) {
  const { projectId, entityId, kind, force = false } = params;
  if (kind === 'character') {
    return renderCharacterPortrait({ projectId, characterId: entityId, force });
  } else if (kind === 'item') {
    return renderPropLookdev({ projectId, itemId: entityId, force });
  } else if (kind === 'location') {
    return renderSceneAtmosphere({ projectId, locationId: entityId, force });
  }
  throw new Error(`[Lookdev] 未知的实体类型: ${kind}`);
}
