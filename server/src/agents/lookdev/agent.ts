import { AgentRunner } from '../runtime/runner.js';
import { ProjectStore } from '../../project-store/ProjectStore.js';
import type { VisionImageRef } from '../../llm/vision-perception.js';
import { lookdevTool } from '../../tools/film-production/index.js';
import { imageUpscaleTool } from '../../tools/media/index.js';
import type { AgentFocusContext, SubmittableToolSpec } from '../runtime/types.js';
import { lookdevCapabilities } from './capabilities.js';
import { getActiveEntityUpscale, getLookdevContext } from './context.js';
import { LOOKDEV_ROLE_PROMPT } from './prompt.js';

export interface LookdevActionIntent {
  action: 'propose' | 'approve' | 'modify' | 'chat_only';
  tool?: string;
  title: string;
  params: Record<string, any>;
  operations?: Array<{ tool: string; title: string; params: Record<string, any> }>;
  description?: string;
  reasoning?: string;
}

export class LookdevAgent extends AgentRunner<LookdevActionIntent> {
  constructor(options: { projectId: string; sessionId?: string }) {
    super({ projectId: options.projectId, sessionId: options.sessionId || 'lookdev' });
  }

  protected getIntentToolSpecs(): SubmittableToolSpec[] {
    return lookdevCapabilities();
  }

  protected assembleSystemPrompt(): string {
    const { project, entities, prd, characters, locations, items, pendingChars, pendingLocs,
      pendingItems, unupscaledChars, unupscaledLocs, unupscaledItems,
      staleEntities, staleChars, staleLocs, staleItems,
      charSummary, locSummary, itemSummary, taskHealth } = getLookdevContext(this.projectId);

    return `${LOOKDEV_ROLE_PROMPT}

【当前项目视觉资产清单】：
- 项目标题：${project?.meta?.title || prd?.gameTitle || '未命名短剧'}
- 全局艺术风格：${entities?.artStyle || '电影级写实摄影质感，真实光影'}

[1. 角色资产库] (${characters.length} 个角色):
${charSummary || '暂无角色'}

[2. 场景空间库] (${locations.length} 个场景):
${locSummary || '暂无场景'}

[3. 核心道具库] (${items.length} 个道具):
${itemSummary || '暂无道具'}

【当前待定妆实体清单】：
- 角色 (${pendingChars.length}): ${pendingChars.map((c: any) => `${c.name}(ID: ${c.characterId})`).join('、') || '全部已定妆'}
- 场景 (${pendingLocs.length}): ${pendingLocs.map((l: any) => `${l.name}(ID: ${l.locationId})`).join('、') || '全部已出图'}
- 道具 (${pendingItems.length}): ${pendingItems.map((i: any) => `${i.name}(ID: ${i.itemId})`).join('、') || '全部已出图'}

${taskHealth?.promptSummary || ''}

【当前已出图但尚未超分清单】：
- 角色 (${unupscaledChars.length}): ${unupscaledChars.map((c: any) => `${c.name}(ID: ${c.characterId})`).join('、') || '已全部超分或暂无已定妆图'}
- 场景 (${unupscaledLocs.length}): ${unupscaledLocs.map((l: any) => `${l.name}(ID: ${l.locationId})`).join('、') || '已全部超分或暂无已出图'}
- 道具 (${unupscaledItems.length}): ${unupscaledItems.map((i: any) => `${i.name}(ID: ${i.itemId})`).join('、') || '已全部超分或暂无已出图'}`;
  }

  private findFocusedEntity(focus: AgentFocusContext): any | undefined {
    if (!focus.target?.id) return undefined;
    const { characters, locations, items } = getLookdevContext(this.projectId);
    const pool =
      focus.target.kind === 'character'
        ? characters
        : focus.target.kind === 'location'
        ? locations
        : focus.target.kind === 'item'
        ? items
        : [...characters, ...locations, ...items];

    return pool.find(
      (item: any) => (item.characterId || item.locationId || item.itemId) === focus.target!.id
    );
  }

  protected override resolveFocusDetails(focus: AgentFocusContext): string[] {
    const matched = this.findFocusedEntity(focus);
    if (!matched) return [];

    const upscaleMeta = getActiveEntityUpscale(matched);
    const layout = matched.spatialLayout;
    const layoutLines = layout ? [`空间基准：${layout}`] : [];

    return [
      `当前状态：${matched.imageUrl ? '已定妆' : '待定妆'}${matched.imageUrl ? (upscaleMeta ? `（已超分 ${upscaleMeta.multiplier}×）` : '（未超分）') : ''}`,
      ...layoutLines,
    ];
  }

  protected override resolveFocusImages(
    focus: AgentFocusContext,
    ctx?: { hasAttachments?: boolean }
  ): VisionImageRef[] {
    const matched = this.findFocusedEntity(focus);
    if (matched) {
      const label = focus.target?.label || matched.name || focus.target?.id || '当前资产';
      const note = matched.promptZh || matched.appearanceSummary;
      const images: VisionImageRef[] = [];
      if (matched.imageUrl) {
        images.push({
          mediaUrl: matched.imageUrl,
          label,
          role: '当前定妆实图',
          note,
        });
      }
      if (matched.referenceImageUrl && matched.referenceImageUrl !== matched.imageUrl) {
        images.push({
          mediaUrl: matched.referenceImageUrl,
          label,
          role: '原始参考底图',
        });
      }
      return images;
    }

    // 未点选具体卡片但创作者本轮主动发了截图/局部图时，依据结构化 focus.meta.activeTab 附带当前展台已出图的候选实体做“图对图”识别
    if (!ctx?.hasAttachments) return [];
    const { characters, locations, items } = getLookdevContext(this.projectId);
    const activeTab = focus.meta?.activeTab;
    const candidatePool =
      activeTab === 'locations'
        ? locations.map((l: any) => ({ id: l.locationId, name: l.name, imageUrl: l.imageUrl, kind: '场景' }))
        : activeTab === 'items'
        ? items.map((i: any) => ({ id: i.itemId, name: i.name, imageUrl: i.imageUrl, kind: '道具' }))
        : characters.map((c: any) => ({ id: c.characterId, name: c.name, imageUrl: c.imageUrl, kind: '角色' }));

    return candidatePool
      .filter((item) => Boolean(item.imageUrl))
      .slice(0, 4)
      .map((item) => ({
        mediaUrl: item.imageUrl,
        label: `${item.name}(ID: ${item.id})`,
        role: `当前展台候选${item.kind}实图`,
      }));
  }

  protected override resolveDirectorIntent(args: any, turn?: any): any {
    const intent = super.resolveDirectorIntent(args, turn);
    const { characters, locations, items } = getLookdevContext(this.projectId);
    const collections: Record<string, any[]> = {
      character: characters,
      location: locations,
      item: items,
    };
    const findEntity = (kind: string, id: string) => {
      const list = collections[kind] || [];
      return list.find((entity) => (entity.characterId || entity.locationId || entity.itemId || entity.id) === id);
    };

    const validateLookdevParams = (rawParams: any): { ok: true; data: any } | { ok: false; message: string } => {
      const parsed = lookdevTool.inputSchema.safeParse({ ...(rawParams || {}), projectId: this.projectId });
      if (!parsed.success) {
        return { ok: false, message: '定妆目标缺少有效的资产类型或 ID，请明确要处理的角色、场景或道具。' };
      }
      const { targetKind, targetId } = parsed.data;
      const matched = findEntity(targetKind, targetId);
      if (!matched) {
        return { ok: false, message: `定妆提案中的资产 ID 不在当前清单：${targetId}。请先核对或提取资产。` };
      }
      return { ok: true, data: parsed.data };
    };

    const validateUpscaleParams = (rawParams: any): { ok: true; data: any; alreadyUpscaled: boolean; entityName: string } | { ok: false; message: string } => {
      const parsed = imageUpscaleTool.inputSchema.safeParse({ ...(rawParams || {}), projectId: this.projectId });
      if (!parsed.success) {
        return { ok: false, message: '高清超分参数不完整，请明确要提升清晰度的角色、场景或道具。' };
      }
      const { targetKind, targetId, multiplier = 2, force = false } = parsed.data;
      if (targetKind !== 'character' && targetKind !== 'location' && targetKind !== 'item') {
        return { ok: false, message: '定妆工坊仅支持对角色、场景或道具资产执行高清超分；分镜关键帧超分请在分镜页面与分镜导演对话。' };
      }
      const matched = findEntity(targetKind, targetId);
      if (!matched) {
        return { ok: false, message: `高清超分目标 [${targetId}] 不在当前定妆资产清单中，请先核对资产。` };
      }
      if (!matched.imageUrl) {
        return { ok: false, message: `【${matched.name || targetId}】尚未生成定妆图，无法直接高清超分，请先为它生成定妆图。` };
      }
      const existingUpscale = getActiveEntityUpscale(matched);
      const alreadyUpscaled = Boolean(!force && existingUpscale && existingUpscale.multiplier >= multiplier);
      return { ok: true, data: parsed.data, alreadyUpscaled, entityName: matched.name || targetId };
    };

    if (Array.isArray(intent?.operations) && intent.operations.length > 0) {
      const filteredOps: any[] = [];
      let skippedCount = 0;
      const plannedLookdevKeys = new Set<string>();
      for (const operation of intent.operations) {
        if (operation.tool === lookdevTool.toolName) {
          const check = validateLookdevParams(operation.params);
          if (!check.ok) return { action: 'chat_only', replyOverride: true, reply: check.message };
          operation.params = check.data;
          plannedLookdevKeys.add(`${check.data.targetKind}:${check.data.targetId}`);
        } else if (operation.tool === imageUpscaleTool.toolName) {
          const parsed = imageUpscaleTool.inputSchema.safeParse({ ...(operation.params || {}), projectId: this.projectId });
          const targetKey = parsed.success ? `${parsed.data.targetKind}:${parsed.data.targetId}` : '';
          // 若同一 Plan 前序步骤刚为该实体安排了定妆生图，则允许后续步骤衔接超分（不因当前无旧图或旧图已超分而拦截）
          if (targetKey && plannedLookdevKeys.has(targetKey)) {
            operation.params = parsed.data;
          } else {
            const check = validateUpscaleParams(operation.params);
            if (!check.ok) return { action: 'chat_only', replyOverride: true, reply: check.message };
            if (check.alreadyUpscaled) {
              skippedCount++;
              continue;
            }
            operation.params = check.data;
          }
        }
        filteredOps.push(operation);
      }
      if (filteredOps.length === 0 && skippedCount > 0) {
        return {
          action: 'chat_only',
          replyOverride: true,
          reply: '当前所选定妆资产均已完成对应倍率的高清超分，无需重复处理。如需升级更高倍率（如 4×）或强制重新超分，请明确告诉我。',
        };
      }
      intent.operations = filteredOps;
      return intent;
    }

    if (intent?.tool === imageUpscaleTool.toolName) {
      const check = validateUpscaleParams(intent.params);
      if (!check.ok) return { action: 'chat_only', replyOverride: true, reply: check.message };
      intent.params = check.data;
      return intent;
    }

    if (intent?.tool === lookdevTool.toolName) {
      const check = validateLookdevParams(intent.params);
      if (!check.ok) return { action: 'chat_only', replyOverride: true, reply: check.message };
      intent.params = check.data;
      return intent;
    }

    return intent;
  }
}
