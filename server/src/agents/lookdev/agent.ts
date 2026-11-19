import { AgentRunner } from '../runtime/runner.js';
import { ProjectStore } from '../../project-store/ProjectStore.js';
import type { VisionImageRef } from '../../llm/vision-perception.js';
import { assetExtractionTool, imageUpscaleTool, lookdevTool } from '../../tools/film-production/index.js';
import type { AgentFocusContext, SubmittableToolSpec } from '../runtime/types.js';
import type { TaskRecord } from '../../task-engine/types.js';
import { lookdevCapabilities } from './capabilities.js';
import { getActiveEntityUpscale, getLookdevContext } from './context.js';
import { LOOKDEV_ROLE_PROMPT } from './prompt.js';

export interface LookdevActionIntent {
  action: 'propose' | 'approve' | 'modify' | 'chat_only';
  tool?: string;
  title: string;
  params: Record<string, any>;
  operations?: Array<{ tool: string; title: string; params: Record<string, any> }>;
  coverage?: 'selected' | 'all_pending';
  description?: string;
  reasoning?: string;
}

export class LookdevAgent extends AgentRunner<LookdevActionIntent> {
  constructor(options: { projectId: string; sessionId?: string }) {
    super({ projectId: options.projectId, sessionId: options.sessionId || 'lookdev' });
  }

  public override getPostTaskPrompt(task: TaskRecord, title: string): string {
    if (task.toolName === imageUpscaleTool.toolName) {
      const factor = task.output?.multiplier || task.input?.multiplier || 2;
      return `【制片工序事件】高清超分工序【${title || task.toolName}】已完成（SeedVR2 ${factor}×）并物理落盘，已自动追加为最新高清版本且保留原版可回切。请简洁向创作者汇报清晰度提升成果。`;
    }
    if (task.toolName === lookdevTool.toolName && task.output?.reviewStatus === 'pending') {
      return `【制片工序事件】视觉资产修改【${title || task.toolName}】已生成候选图，保留原选用版本。请告知创作者在版本库对照本次要求并验收；未看图确认前，不得宣称任何姿态、服装、道具、颜色或背景修改已经实现。`;
    }
    return `【制片工序事件】视觉资产工序【${title || task.toolName}】已生成图片并物理落盘。请告知创作者核对画面；不得仅凭任务完成推断具体视觉要求已实现。`;
  }

  protected getIntentToolSpecs(): SubmittableToolSpec[] {
    return lookdevCapabilities();
  }

  protected assembleSystemPrompt(): string {
    const { project, entities, prd, characters, locations, items, pendingChars, pendingLocs,
      pendingItems, unupscaledChars, unupscaledLocs, unupscaledItems, charSummary, locSummary, itemSummary } = getLookdevContext(this.projectId);

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
- 角色 (${pendingChars.length}): ${pendingChars.map((c: any) => `${c.name}(ID: ${c.characterId || c.id})`).join('、') || '全部已定妆'}
- 场景 (${pendingLocs.length}): ${pendingLocs.map((l: any) => `${l.name}(ID: ${l.locationId || l.id})`).join('、') || '全部已出图'}
- 道具 (${pendingItems.length}): ${pendingItems.map((i: any) => `${i.name}(ID: ${i.itemId || i.id})`).join('、') || '全部已出图'}

【当前已出图但尚未超分清单】：
- 角色 (${unupscaledChars.length}): ${unupscaledChars.map((c: any) => `${c.name}(ID: ${c.characterId || c.id})`).join('、') || '已全部超分或暂无已定妆图'}
- 场景 (${unupscaledLocs.length}): ${unupscaledLocs.map((l: any) => `${l.name}(ID: ${l.locationId || l.id})`).join('、') || '已全部超分或暂无已出图'}
- 道具 (${unupscaledItems.length}): ${unupscaledItems.map((i: any) => `${i.name}(ID: ${i.itemId || i.id})`).join('、') || '已全部超分或暂无已出图'}

### 定妆工坊业务边界与选型约定
- **定妆生成/外貌微调（${lookdevTool.toolName}）**：
  - 处理 **1 个资产**：使用 targetTool: "${lookdevTool.toolName}" + params: { targetKind, targetId, ... }（修改已有图片设 force: true）；
  - 创作者明确要求双脚并拢或脚踝贴合时，在角色定妆 params 中填写 poseConstraint: { stance: "feet_together" }，并让 instruction/customPrompt 与此一致；自然直立则用 stance: "neutral"。
  - 批量处理 **指定的多个资产（如“前三个角色”“把A和B定妆”）**：**必须使用 operations 数组并留空顶层 targetTool**，按上方清单中的真实 ID 为每个资产拆 1 条 { targetTool: "${lookdevTool.toolName}", title: "角色定妆 · 名称", params: { targetKind, targetId } }；
  - 要求 **全部剩余待定妆资产**：设 coverage: "all_pending" + targetTool: "${lookdevTool.toolName}"，由服务端自动展开为 Plan 清单。
- **高清超分（${imageUpscaleTool.toolName}）**：创作者仅要求“变清晰/超分/去模糊”且不改外观造型时使用（targetKind、targetId、multiplier 默认 2）；批量处理多个指定资产同样用 operations 数组逐项编排；全量批量超分设 coverage: "all_pending" + targetTool: "${imageUpscaleTool.toolName}"，默认仅处理【当前已出图但尚未超分清单】，自动跳过已超分实体（除非明确要求升级 4× 或强制重跑设 force: true）。
- **资产提取/增删（${assetExtractionTool.toolName}）**：只能使用清单里存在的 ID；新增或删除实体使用 mode: "modify"；若创作者仅要求重提某一类资产（如“只重新提取角色”），必须传 targetKinds（如 ["character"]），未选中类别的已有清单与定妆图会原样保留，提取不自动生图。
- 对话承诺必须与最终提案参数一致；物理任务完成前不得声称资产已生成。生成完成只证明有新图片，不证明画面符合修改要求；未获创作者验收，不得宣称具体视觉变化已达成。

### 决策与执行协议
你持有 emit_director_intent 意图工具。调用时必须先向创作者自然语言说明方案或确认，不能只调用工具。
- propose：提出定妆或资产提取方案，由创作者批准。
- approve：创作者明确同意当前待审提案时授权执行。
- modify：根据创作者意见重塑完整提案参数。
- chat_only：审美讨论或信息不足时先回答或追问。

${AgentRunner.renderFunnelPromptMatrix()}
`;
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
      (item: any) => (item.characterId || item.locationId || item.itemId || item.id) === focus.target!.id
    );
  }

  protected override resolveFocusDetails(focus: AgentFocusContext): string[] {
    const matched = this.findFocusedEntity(focus);
    if (!matched) return [];

    const upscaleMeta = getActiveEntityUpscale(matched);
    return [
      `出图状态：${matched.imageUrl ? '已定妆' : '待定妆'}${matched.imageUrl ? (upscaleMeta ? `（已超分 ${upscaleMeta.multiplier}×）` : '（未超分）') : ''}`,
      ...(matched.appearanceSummary ? [`外观摘要：${matched.appearanceSummary}`] : []),
      ...(matched.promptZh ? [`当前生图提示词：${matched.promptZh}`] : []),
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
        ? locations.map((l: any) => ({ id: l.locationId || l.id, name: l.name, imageUrl: l.imageUrl, kind: '场景' }))
        : activeTab === 'items'
        ? items.map((i: any) => ({ id: i.itemId || i.id, name: i.name, imageUrl: i.imageUrl, kind: '道具' }))
        : characters.map((c: any) => ({ id: c.characterId || c.id, name: c.name, imageUrl: c.imageUrl, kind: '角色' }));

    return candidatePool
      .filter((item) => Boolean(item.imageUrl))
      .slice(0, 4)
      .map((item) => ({
        mediaUrl: item.imageUrl,
        label: `${item.name}(ID: ${item.id})`,
        role: `当前展台候选${item.kind}实图`,
      }));
  }

  protected override resolveDirectorIntent(args: any): any {
    if (args?.coverage === 'all_pending' && (args.action === 'propose' || args.action === 'modify')) {
      const requestedTool = args.targetTool;
      if (!requestedTool) throw new Error('全量定妆提案缺少明确的目标工具');
      if (requestedTool === imageUpscaleTool.toolName) {
        const { unupscaledChars, unupscaledLocs, unupscaledItems } = getLookdevContext(this.projectId);
        const multiplier = Number(args.params?.multiplier) || 2;
        const operations = [
          ...unupscaledChars.map((c: any) => ({
            targetTool: imageUpscaleTool.toolName,
            title: `角色高清超分 (${multiplier}×) · ${c.name || c.characterId || c.id}`,
            params: { projectId: this.projectId, targetKind: 'character', targetId: c.characterId || c.id, multiplier },
          })),
          ...unupscaledLocs.map((l: any) => ({
            targetTool: imageUpscaleTool.toolName,
            title: `场景高清超分 (${multiplier}×) · ${l.name || l.locationId || l.id}`,
            params: { projectId: this.projectId, targetKind: 'location', targetId: l.locationId || l.id, multiplier },
          })),
          ...unupscaledItems.map((i: any) => ({
            targetTool: imageUpscaleTool.toolName,
            title: `道具高清超分 (${multiplier}×) · ${i.name || i.itemId || i.id}`,
            params: { projectId: this.projectId, targetKind: 'item', targetId: i.itemId || i.id, multiplier },
          })),
        ];
        if (!operations.length) {
          return { action: 'chat_only', replyOverride: true, reply: '当前已出图的角色、场景和道具都已完成高清超分，无需重复处理。' };
        }
        args = {
          ...args,
          targetTool: undefined,
          params: {},
          title: args.title || `全剧剩余资产高清超分计划（共 ${operations.length} 项）`,
          operations,
        };
      } else if (requestedTool === lookdevTool.toolName) {
        const { pendingChars, pendingLocs, pendingItems } = getLookdevContext(this.projectId);
        const sharedInstruction = typeof args.params?.instruction === 'string' ? args.params.instruction : undefined;
        const operations = [
          ...pendingChars.map((c: any) => ({
            targetTool: lookdevTool.toolName,
            title: `角色定妆 · ${c.name || c.characterId || c.id}`,
            params: {
              projectId: this.projectId,
              targetKind: 'character',
              targetId: c.characterId || c.id,
              ...(sharedInstruction ? { instruction: sharedInstruction } : {}),
              force: false,
            },
          })),
          ...pendingLocs.map((l: any) => ({
            targetTool: lookdevTool.toolName,
            title: `场景定妆 · ${l.name || l.locationId || l.id}`,
            params: {
              projectId: this.projectId,
              targetKind: 'location',
              targetId: l.locationId || l.id,
              ...(sharedInstruction ? { instruction: sharedInstruction } : {}),
              force: false,
            },
          })),
          ...pendingItems.map((i: any) => ({
            targetTool: lookdevTool.toolName,
            title: `道具定妆 · ${i.name || i.itemId || i.id}`,
            params: {
              projectId: this.projectId,
              targetKind: 'item',
              targetId: i.itemId || i.id,
              ...(sharedInstruction ? { instruction: sharedInstruction } : {}),
              force: false,
            },
          })),
        ];
        if (!operations.length) {
          return { action: 'chat_only', replyOverride: true, reply: '当前角色、场景和道具都已完成定妆。' };
        }
        args = {
          ...args,
          targetTool: undefined,
          params: {},
          title: args.title || `全剧剩余资产定妆计划（共 ${operations.length} 项）`,
          operations,
        };
      } else {
        throw new Error(`全量定妆不支持工序: ${requestedTool}`);
      }
    }

    const intent = super.resolveDirectorIntent(args);
    const entities = (ProjectStore.getInstance().getArtifact(this.projectId, 'lookdev_entities') as any) || {};
    const collections: Record<string, any[]> = {
      character: entities.characters || [],
      location: entities.locations || [],
      item: entities.items || [],
    };
    const idKeys: Record<string, string> = { character: 'characterId', location: 'locationId', item: 'itemId' };

    const validateLookdevParams = (rawParams: any): { ok: true; data: any } | { ok: false; message: string } => {
      const parsed = lookdevTool.inputSchema.safeParse({ ...(rawParams || {}), projectId: this.projectId });
      if (!parsed.success) {
        return { ok: false, message: '定妆目标缺少有效的资产类型或 ID，请明确要处理的角色、场景或道具。' };
      }
      const { targetKind, targetId } = parsed.data;
      const matched = collections[targetKind].find((entity) => (entity[idKeys[targetKind]] || entity.id) === targetId);
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
      const matched = collections[targetKind].find((entity) => (entity[idKeys[targetKind]] || entity.id) === targetId);
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
