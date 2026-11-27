/**
 * agents/runtime/intent-resolver.ts
 * 专职导演意图解析与多层客观门禁校验器 (Director Intent Resolver SSOT)
 *
 * 核心架构职责：
 * 1. 负责将大模型调用的 emit_director_intent 结构化解析为 SessionActionIntent；
 * 2. 部署全系统刚性门禁（Defense in Depth）：防空跑、防参数丢失、防待审提案越级跳过；
 * 3. 单一事实来源与零别名：统一规范 targetTool 与 tool 字段。
 */

import type { SessionActionIntent, SubmittableToolSpec } from './types.js';
import { getLookdevContext, getActiveEntityUpscale } from '../lookdev/context.js';
import { getStoryboardContext } from '../storyboard/context.js';
import { formatPipelineEntityLabel } from './pipeline.js';

export interface ResolveIntentContext {
  args: any;
  projectId: string;
  specs: SubmittableToolSpec[];
  pendingProposal?: SessionActionIntent | null;
  clipId?: string;
  sessionId?: string;
}

export class DirectorIntentResolver {
  /**
   * 意图参数自动水合（Auto-Hydration SSOT）
   * 自动注入 projectId、当前分幕 clipId 等环境属性，并规范特定标记
   */
  public static hydrateParams(toolName: string, rawParams: any, ctx: ResolveIntentContext): Record<string, any> {
    const params: Record<string, any> = {
      ...(rawParams || {}),
      projectId: ctx.projectId,
    };
    if (ctx.clipId && !params.clipId) {
      params.clipId = ctx.clipId;
    }
    return params;
  }

  /**
   * 目标实体存在性与前置产物刚性门禁（Entity Existence & State Guard SSOT）
   */
  public static checkEntityAndState(
    toolName: string,
    params: any,
    ctx: ResolveIntentContext,
    allowPendingUpstream = false
  ): { ok: true; data: any; alreadyProcessed?: boolean } | { ok: false; message: string } {
    if (!ctx.projectId) return { ok: true, data: params };

    // 1. 视觉定妆生成与重绘
    if (toolName === 'film.lookdev') {
      const { targetKind, targetId } = params || {};
      if (!targetKind || !targetId) {
        return { ok: false, message: '定妆工序缺少目标类型 targetKind 或目标编号 targetId' };
      }
      const { characters, locations, items } = getLookdevContext(ctx.projectId);
      if (targetKind === 'character') {
        const found = characters.find((c: any) => c.characterId === targetId || c.id === targetId);
        if (!found) {
          const valid = characters.map((c: any) => `${c.name || c.characterId}(${c.characterId || c.id})`).join('、');
          return { ok: false, message: `在当前项目中未找到角色 [${targetId}]，当前合法角色为：${valid || '暂无'}` };
        }
      } else if (targetKind === 'location') {
        const found = locations.find((l: any) => l.locationId === targetId || l.id === targetId);
        if (!found) {
          const valid = locations.map((l: any) => `${l.name || l.locationId}(${l.locationId || l.id})`).join('、');
          return { ok: false, message: `在当前项目中未找到场景 [${targetId}]，当前合法场景为：${valid || '暂无'}` };
        }
      } else if (targetKind === 'item') {
        const found = items.find((i: any) => i.itemId === targetId || i.id === targetId);
        if (!found) {
          const valid = items.map((i: any) => `${i.name || i.itemId}(${i.itemId || i.id})`).join('、');
          return { ok: false, message: `在当前项目中未找到道具 [${targetId}]，当前合法道具为：${valid || '暂无'}` };
        }
      }
      return { ok: true, data: params };
    }

    // 2. 镜头视频
    if (toolName === 'film.shot_video') {
      const shotId = params?.shotId;
      if (allowPendingUpstream || !ctx.clipId) {
        return { ok: true, data: params };
      }
      const { shots } = getStoryboardContext(ctx.projectId, ctx.clipId);
      if (shots.length > 0 && shotId) {
        const matchedShot = shots.find((s: any) => s.shotId === shotId);
        if (!matchedShot) {
          const validShots = shots.map((s: any) => s.shotId).join('、');
          return { ok: false, message: `本分幕未找到镜头 [${shotId}]，当前分幕合法镜头编号为：${validShots || '暂无'}` };
        }
      }
      return { ok: true, data: params };
    }

    // 3. 高清超分 (film.image_upscale)
    if (toolName === 'film.image_upscale') {
      const { targetKind, targetId, multiplier = 2, force = false } = params || {};
      if (!targetKind || !targetId) {
        return { ok: false, message: '高清超分参数不完整，请指明目标类型 targetKind 与目标编号 targetId。' };
      }

      // 3.2 角色/场景/道具 定妆超分
      if (['character', 'location', 'item'].includes(targetKind)) {
        const { characters, locations, items } = getLookdevContext(ctx.projectId);
        const pool = targetKind === 'character' ? characters : targetKind === 'location' ? locations : items;
        const kindLabel = targetKind === 'character' ? '角色' : targetKind === 'location' ? '场景' : '道具';
        const matched = pool.find((item: any) => (item.characterId || item.locationId || item.itemId || item.id) === targetId);
        if (!matched) {
          const valid = pool.map((item: any) => `${item.name || item.id}(${item.characterId || item.locationId || item.itemId || item.id})`).join('、');
          return { ok: false, message: `在当前项目中未找到${kindLabel} [${targetId}]，当前合法资产为：${valid || '暂无'}` };
        }
        if (!matched.imageUrl && !allowPendingUpstream) {
          return { ok: false, message: `${kindLabel}【${matched.name || targetId}】尚未生成定妆图，无法执行高清超分，请先进行视觉定妆。` };
        }
        const upscaleMeta = getActiveEntityUpscale(matched);
        const alreadyProcessed = Boolean(!force && upscaleMeta && upscaleMeta.multiplier >= multiplier);
        return { ok: true, data: params, alreadyProcessed };
      }
    }

    return { ok: true, data: params };
  }

  /**
   * 将大模型触发的 emit_director_intent 调用解析为规范的 SessionActionIntent
   */
  public static resolve(ctx: ResolveIntentContext): SessionActionIntent | null {
    const { args, projectId, specs, pendingProposal } = ctx;
    if (!args || typeof args !== 'object') return null;

    const action = args.action;
    if (!['propose', 'modify', 'approve', 'chat_only'].includes(action)) {
      throw new Error('意图动作无效');
    }
    if (args.invalidatePendingProposal === true && action !== 'chat_only') {
      throw new Error('旧提案失效标记仅可用于澄清对话，不能同时批准执行');
    }

    if (action === 'chat_only') {
      return {
        action: 'chat_only',
        title: '',
        params: {},
        reply: args.reply || '',
      };
    }

    let description = typeof args.description === 'string' ? args.description.trim() : '';
    if ((action === 'propose' || action === 'modify') && !description) {
      // 容错自愈：若模型未单独传 description，优先回退提取 title 作为面向创作者的说明
      description = typeof args.title === 'string' && args.title.trim()
        ? args.title.trim()
        : '执行当前制片工序方案';
    }

    if (action === 'approve' && !pendingProposal) {
      return {
        action: 'chat_only',
        title: '',
        params: {},
        reply: '当前没有待确认的方案。请说明要执行的内容，我会先提交方案供你确认。',
      };
    }

    // 目标工序解析：只有 approve 可以继承挂起提案；新提案/修改必须明确选择目标工具。
    const rawOperations = action === 'approve'
      ? pendingProposal?.operations
      : args.operations;
    const hasOperations = Array.isArray(rawOperations) && rawOperations.length > 0;
    const requestedToolName = action === 'approve'
      ? pendingProposal?.tool
      : (args.tool || args.targetTool);

    if ((action === 'propose' || action === 'modify') && !requestedToolName && !hasOperations) {
      throw new Error('当前提案缺少明确的目标工具，已阻止执行，请先澄清要修改或生成的具体内容');
    }

    const matchedSpec = specs.find((s) => s.toolName === requestedToolName);
    if (requestedToolName && !matchedSpec) {
      throw new Error(`当前阶段不支持工序: ${requestedToolName}`);
    }

    let operations: Array<{ tool: string; title: string; params: any }> | undefined;

    if (hasOperations) {
      const filteredOps: Array<{ tool: string; title: string; params: any }> = [];
      let skippedCount = 0;
      let plannedReplan = false;
      const plannedLookdevIds = new Set<string>();

      for (const operation of rawOperations) {
        const operationTool = operation.tool || operation.targetTool;
        const spec = specs.find((item) => item.toolName === operationTool);
        if (!spec) throw new Error(`当前阶段不支持工序: ${operationTool}`);

        // 1. 底座统一参数水合 (Auto-Hydration)
        const hydrated = DirectorIntentResolver.hydrateParams(operationTool, operation.params, ctx);

        // 2. 状态与依赖拓扑记录
        if (operationTool === 'film.shooting_script') {
          plannedReplan = true;
        } else if (operationTool === 'film.lookdev') {
          if (hydrated.targetId) {
            plannedLookdevIds.add(hydrated.targetId);
          }
        }

        // 3. 底座统一刚性实体与状态门禁 (Entity Existence Guard)
        const allowUpstream = plannedReplan ||
          Boolean(hydrated.targetId && plannedLookdevIds.has(hydrated.targetId));

        const check = DirectorIntentResolver.checkEntityAndState(operationTool, hydrated, ctx, allowUpstream);
        if (!check.ok) {
          return {
            action: 'chat_only',
            title: '',
            params: {},
            reply: check.message,
          };
        }
        if (check.alreadyProcessed) {
          skippedCount++;
          continue;
        }

        const parsed = spec.schema.safeParse(check.data);
        if (!parsed.success) {
          throw new Error(`${spec.title} 参数不完整: ${parsed.error.issues.map((issue) => issue.path.join('.')).join('、')}`);
        }

        filteredOps.push({
          tool: spec.toolName,
          title: operation.title || spec.title,
          params: parsed.data,
        });
      }

      if (filteredOps.length === 0 && skippedCount > 0) {
        return {
          action: 'chat_only',
          title: '',
          params: {},
          reply: '所选目标均已完成对应倍率的高清超分，无需重复处理。如需升级更高倍率（如 4×）或强制重新超分，请明确告诉我。',
        };
      }

      operations = filteredOps;
    }

    const toolName = requestedToolName || matchedSpec?.toolName;
    const title = args.title || pendingProposal?.title || matchedSpec?.title || '制片工序任务';

    // 【门禁 1 · 授权批准执行 (approve)】
    if (action === 'approve') {
      if (!pendingProposal) {
        throw new Error('当前没有可批准的待审提案');
      }

      if (operations && operations.length > 0) {
        return {
          action: 'approve',
          ...(toolName ? { tool: toolName } : {}),
          title: pendingProposal.title || title,
          params: DirectorIntentResolver.hydrateParams(toolName || '', pendingProposal.params || {}, ctx),
          operations,
          description: pendingProposal.description,
        };
      }

      // 自动无损继承前序待审提案中的完整参数，并做 Schema 刚性校验
      const finalParams = DirectorIntentResolver.hydrateParams(toolName || '', pendingProposal.params || {}, ctx);
      if (!matchedSpec) throw new Error('当前待审方案缺少有效的目标工序');
      const validatedParams = matchedSpec.schema.safeParse(finalParams);
      if (!validatedParams.success) {
        const details = validatedParams.error.issues
          .map((issue) => issue.path.length ? `${issue.path.join('.')}: ${issue.message}` : issue.message)
          .join('；');
        throw new Error(`${matchedSpec.title} 提案参数已失效，请重新生成方案：${details}`);
      }

      return {
        action: 'approve',
        tool: toolName,
        title: pendingProposal.title || title,
        params: validatedParams.data,
        description: pendingProposal.description,
      };
    }

    // 【门禁 2 · 方案修改重塑 (modify)】
    if (action === 'modify') {
      const sameTool = Boolean(toolName && pendingProposal?.tool && toolName === pendingProposal.tool);
      let mergedParams: Record<string, any> = DirectorIntentResolver.hydrateParams(
        toolName || '',
        {
          ...(sameTool ? (pendingProposal?.params || {}) : {}),
          ...(args.params || {}),
        },
        ctx
      );

      if (!operations && matchedSpec) {
        const check = DirectorIntentResolver.checkEntityAndState(toolName || '', mergedParams, ctx, false);
        if (!check.ok) {
          return {
            action: 'chat_only',
            title: '',
            params: {},
            reply: check.message,
          };
        }
        const validated = matchedSpec.schema.safeParse(check.data);
        if (!validated.success) {
          const details = validated.error.issues
            .map((issue) => (issue.path.length ? `${issue.path.join('.')}: ${issue.message}` : issue.message))
            .join('；');
          throw new Error(`${matchedSpec.title} 参数不完整：${details}`);
        }
        mergedParams = validated.data;
      }
      const cleanTitle = title.replace(/^【修改方案】\s*/, '');

      const finalOps = operations && operations.length > 0
        ? operations
        : (toolName && matchedSpec ? [{ tool: toolName, title: `【修改方案】${cleanTitle}`, params: mergedParams }] : undefined);

      return {
        action: 'modify',
        tool: toolName,
        title: `【修改方案】${cleanTitle}`,
        params: mergedParams,
        ...(finalOps ? { operations: finalOps } : {}),
        description,
      };
    }

    // 【门禁 3 · 初次构思出具提案 (propose)】
    let finalProposeParams: Record<string, any> = DirectorIntentResolver.hydrateParams(
      toolName || '',
      args.params || {},
      ctx
    );

    if (!operations && matchedSpec) {
      const check = DirectorIntentResolver.checkEntityAndState(toolName || '', finalProposeParams, ctx, false);
      if (!check.ok) {
        return {
          action: 'chat_only',
          title: '',
          params: {},
          reply: check.message,
        };
      }
      if (check.alreadyProcessed) {
        return {
          action: 'chat_only',
          title: '',
          params: {},
          reply: `目标已完成 ${finalProposeParams.multiplier || 2}× 高清超分，无需重复处理。如需升级更高倍率（如 4×）或强制重新超分，请明确告诉我。`,
        };
      }
      const validated = matchedSpec.schema.safeParse(check.data);
      if (!validated.success) {
        const details = validated.error.issues
          .map((issue) => (issue.path.length ? `${issue.path.join('.')}: ${issue.message}` : issue.message))
          .join('；');
        throw new Error(`${matchedSpec.title} 参数不完整：${details}`);
      }
      finalProposeParams = validated.data;
    }

    // 刚性标题净化：彻底消灭“复盘”、“自愈”、“待审”等元指令伪标题污染卡片
    let cleanProposeTitle = title;
    if (/复盘|自愈|待审/.test(cleanProposeTitle)) {
      const entityLabel = formatPipelineEntityLabel(finalProposeParams);
      const stageName = matchedSpec?.stageName || matchedSpec?.title || '制片工序任务';
      cleanProposeTitle = entityLabel ? `${entityLabel} · ${stageName}` : stageName;
    }

    const finalOperations = operations && operations.length > 0
      ? operations
      : (toolName && matchedSpec ? [{ tool: toolName, title: cleanProposeTitle, params: finalProposeParams }] : undefined);

    return {
      action: 'propose',
      tool: toolName,
      title: cleanProposeTitle,
      params: finalProposeParams,
      ...(finalOperations ? { operations: finalOperations } : {}),
      description,
    };
  }
}
