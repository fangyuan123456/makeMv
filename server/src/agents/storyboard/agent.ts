/**
 * agents/storyboard/agent.ts
 * 专职分幕分镜总导演机器人微内核 (Per-Clip Storyboard Director SSOT)
 *
 * 核心架构模式：
 * 1. 声明式工序能力规范 (getIntentToolSpecs SSOT)：
 *    直连 storyboardPlanningTool；
 * 2. 基类内置官方意图决策工具 (emit_director_intent) 与 P0 ➔ P5 漏斗；
 * 3. 外部提示词纯业务化，零硬编码具体工具名。
 */

import { AgentRunner } from '../runtime/runner.js';
import type { VisionImageRef } from '../../llm/vision-perception.js';
import { ProjectStore } from '../../project-store/ProjectStore.js';
import { computeProjectStaleMap } from '../../project-store/freshness.js';
import {
  imageUpscaleTool,
  shotKeyframeTool,
  shotVideoTool,
  storyboardPlanningTool,
} from '../../tools/film-production/index.js';
import type { AgentFocusContext, SubmittableToolSpec } from '../runtime/types.js';
import type { TaskRecord } from '../../task-engine/types.js';
import { storyboardCapabilities } from './capabilities.js';
import { getStoryboardContext } from './context.js';
import { storyboardRolePrompt } from './prompt.js';

export interface StoryboardActionIntent {
  action: 'propose' | 'approve' | 'modify' | 'chat_only';
  tool?: string;
  title: string;
  params: Record<string, any>;
  operations?: Array<{ tool: string; title: string; params: Record<string, any> }>;
  description?: string;
  reasoning?: string;
}

export class StoryboardAgent extends AgentRunner<StoryboardActionIntent> {
  public readonly clipId: string;

  constructor(options: { projectId: string; sessionId?: string; clipId?: string }) {
    // 若未显式传入 clipId，尝试从 sessionId (例如 storyboard_c1) 中提取
    let cid = options.clipId || '';
    if (!cid && options.sessionId && options.sessionId.startsWith('storyboard_')) {
      cid = options.sessionId.replace(/^storyboard_/, '');
    }
    const resolvedSessionId = cid ? `storyboard_${cid}` : (options.sessionId || 'storyboard');

    super({
      projectId: options.projectId,
      sessionId: resolvedSessionId,
    });

    this.clipId = cid;
  }

  public override getPostTaskPrompt(task: TaskRecord, title: string): string {
    if (task.toolName === imageUpscaleTool.toolName) {
      const factor = task.output?.multiplier || task.input?.multiplier || 2;
      const frameLabel = task.input?.frame === 'last' ? '末帧' : '首帧';
      return `【制片工序事件】关键帧高清超分工序【${title || task.toolName}】已完成（SeedVR2 ${factor}×，目标：${frameLabel}）并已同步更新画布。请简洁向创作者汇报清晰度提升结果。`;
    }
    if (task.toolName === shotKeyframeTool.toolName) {
      return `【制片工序事件】镜头关键帧渲染工序【${title || task.toolName}】已完成并已更新画布。请简洁向创作者汇报关键帧画面落地情况与下一步建议。`;
    }
    if (task.toolName === shotVideoTool.toolName) {
      return `【制片工序事件】镜头动态视频渲染工序【${title || task.toolName}】已完成并已绑定镜头。请简洁向创作者汇报视频渲染成果。`;
    }
    return `【制片工序事件】分幕分镜工序【${title || task.toolName}】已完成并物理落盘。请核对当前分幕【${this.clipId || '当前幕'}】的分镜台本，简要复盘镜头节拍与视听呈现。`;
  }

  /**
   * 声明分镜总导演支持的法定物理工具清单 (SSOT)
   */
  protected getIntentToolSpecs(): SubmittableToolSpec[] {
    return storyboardCapabilities(this.clipId);
  }

  /**
   * 组装本分幕专属分镜导演 System Prompt
   */
  protected assembleSystemPrompt(): string {
    const {
      clipTitle,
      narrativeText,
      targetDurationSec,
      shots,
      unupscaledFirstShots,
      unupscaledLastShots,
      shotsSummary,
    } = getStoryboardContext(this.projectId, this.clipId);

    const staleMap = computeProjectStaleMap(this.projectId);
    const clipStale = this.clipId ? staleMap.clips[this.clipId] : undefined;
    const staleKfShots = shots
      .map((s: any) => ({ sid: s.shotId || s.id, info: staleMap.shotKeyframes[s.shotId || s.id] }))
      .filter((x: any) => Boolean(x.info));
    const staleVidShots = shots
      .map((s: any) => ({ sid: s.shotId || s.id, info: staleMap.shotVideos[s.shotId || s.id] }))
      .filter((x: any) => Boolean(x.info));
    const staleLines = [
      ...(clipStale ? [`- 本幕分镜台本：⚠ ${clipStale.reason}`] : []),
      ...(staleKfShots.length > 0
        ? [`- 上游定妆已变更需重绘的关键帧 (${staleKfShots.length})：${staleKfShots.map((x: any) => `${x.sid}(${x.info.reason})`).join('；')}`]
        : []),
      ...(staleVidShots.length > 0
        ? [`- 上游关键帧已变更需重渲的视频 (${staleVidShots.length})：${staleVidShots.map((x: any) => `${x.sid}(${x.info.reason})`).join('；')}`]
        : []),
    ];

    return `${storyboardRolePrompt(this.clipId, clipTitle)}

【当前分幕专属性质与剧本文本】：
- 分幕标识：${this.clipId}（${clipTitle}）
- 本幕时长：${targetDurationSec} 秒 | 镜头总数：${shots.length} 镜
- 本幕剧本正文：
\`\`\`text
${narrativeText}
\`\`\`

【本幕当前已排布的镜头清单 (${shots.length} 镜)】：
${shotsSummary || '  (当前尚未排布镜头)'}

【本幕已出图但尚未超分镜头】：
- 首帧未超分 (${unupscaledFirstShots.length}): ${unupscaledFirstShots.map((s: any) => s.shotId).join('、') || '全部已超分或暂无已生成首帧'}
- 末帧未超分 (${unupscaledLastShots.length}): ${unupscaledLastShots.map((s: any) => s.shotId).join('、') || '无'}
${staleLines.length > 0 ? `\n【上下游同步提醒（上游资产已变更）】：\n${staleLines.join('\n')}\n` : ''}

### 本幕业务边界与选型约定
- **分镜台本重排（${storyboardPlanningTool.toolName}）**：用于增删镜头、调整景别/运镜/节奏或重写提示词（params 含 clipId: "${this.clipId}", instruction）。
- **关键帧生图/重绘（${shotKeyframeTool.toolName}）**：用于为单镜（传 shotId、clipId: "${this.clipId}"、可选 frame: "first"|"last"、force: true）生成或重绘首尾帧；批量处理多个指定镜头时必须使用 operations 数组逐镜编排并留空顶层 targetTool。
- **关键帧高清超分（${imageUpscaleTool.toolName}）**：创作者仅要求“变清晰/超分/去模糊”且不改构图时使用（targetKind: "shot_keyframe"、targetId: shotId、clipId: "${this.clipId}"、frame、multiplier 默认 2）；批量超分多个镜头时必须使用 operations 数组逐镜编排（默认只处理【本幕已出图但尚未超分镜头】，自动跳过已超分镜头）。
- **镜头动态视频（${shotVideoTool.toolName}）**：用于基于关键帧渲染镜头视频（传 shotId、clipId: "${this.clipId}"、可选 customPrompt、force）；批量渲染多个指定镜头时同样使用 operations 数组逐镜编排。
- 若当前视口已聚焦具体镜头（如「镜头 01 · 首帧处理」），且创作者未明确说“全部/所有/本幕/多镜”（例如只说“帮我把图片生成一下”“超分一下”），默认只针对当前聚焦的那 1 个镜头及子步骤发起单步提案，严禁擅自扩成全幕批量生成。

${AgentRunner.renderFunnelPromptMatrix()}
`;
  }

  protected override resolveDirectorIntent(args: any): any {
    const intent = super.resolveDirectorIntent(args);
    const { shots } = getStoryboardContext(this.projectId, this.clipId);

    const normalizeClipParams = (rawParams: any) => ({
      ...(rawParams || {}),
      projectId: this.projectId,
      ...(this.clipId ? { clipId: rawParams?.clipId || this.clipId } : {}),
    });

    const validateUpscaleParams = (
      rawParams: any,
      allowPendingUpstream = false
    ): { ok: true; data: any; alreadyUpscaled: boolean } | { ok: false; message: string } => {
      const parsed = imageUpscaleTool.inputSchema.safeParse(normalizeClipParams(rawParams));
      if (!parsed.success) {
        return { ok: false, message: '关键帧高清超分参数不完整，请明确要处理的镜头编号（如镜头 01 首帧）。' };
      }
      const { targetKind, targetId, frame = 'first', multiplier = 2, force = false } = parsed.data;
      if (targetKind !== 'shot_keyframe') {
        return { ok: false, message: '分镜工坊仅支持对镜头关键帧执行高清超分；角色/场景/道具定妆超分请在视觉定妆页面与定妆总监对话。' };
      }
      if (allowPendingUpstream) {
        return { ok: true, data: parsed.data, alreadyUpscaled: false };
      }
      const matchedShot = shots.find((s: any) => s.shotId === targetId || s.id === targetId);
      if (!matchedShot) {
        return { ok: false, message: `本分幕未找到镜头 [${targetId}]，请核对当前分幕的镜头清单。` };
      }
      const hasImage = frame === 'last'
        ? Boolean(matchedShot.lastFrameImageUrl || matchedShot.lastFrameUrl)
        : Boolean(matchedShot.firstFrameImageUrl || matchedShot.keyframeUrl || matchedShot.imageUrl);
      if (!hasImage) {
        const frameLabel = frame === 'last' ? '末帧' : '首帧';
        return { ok: false, message: `镜头【${matchedShot.title || targetId}】尚未生成${frameLabel}图片，无法执行高清超分，请先生成${frameLabel}。` };
      }
      const existingUpscale = frame === 'last' ? matchedShot.lastFrameUpscale : matchedShot.firstFrameUpscale;
      const alreadyUpscaled = Boolean(!force && existingUpscale && existingUpscale.multiplier >= multiplier);
      return { ok: true, data: parsed.data, alreadyUpscaled };
    };

    if (Array.isArray(intent?.operations) && intent.operations.length > 0) {
      const filteredOps: any[] = [];
      let skippedCount = 0;
      let plannedReplan = false;
      const plannedKeyframeShotIds = new Set<string>();

      for (const operation of intent.operations) {
        if (operation.tool === storyboardPlanningTool.toolName) {
          plannedReplan = true;
          operation.params = normalizeClipParams(operation.params);
        } else if (operation.tool === shotKeyframeTool.toolName) {
          operation.params = normalizeClipParams(operation.params);
          if (operation.params?.shotId) {
            plannedKeyframeShotIds.add(operation.params.shotId);
          } else {
            plannedReplan = true;
          }
        } else if (operation.tool === shotVideoTool.toolName) {
          operation.params = normalizeClipParams(operation.params);
        } else if (operation.tool === imageUpscaleTool.toolName) {
          const targetId = operation.params?.targetId;
          const allowUpstream = plannedReplan || Boolean(targetId && plannedKeyframeShotIds.has(targetId));
          const check = validateUpscaleParams(operation.params, allowUpstream);
          if (!check.ok) return { action: 'chat_only', replyOverride: true, reply: check.message };
          if (check.alreadyUpscaled) {
            skippedCount++;
            continue;
          }
          operation.params = check.data;
        }
        filteredOps.push(operation);
      }
      if (filteredOps.length === 0 && skippedCount > 0) {
        return {
          action: 'chat_only',
          replyOverride: true,
          reply: '本幕所选镜头关键帧均已完成对应倍率的高清超分，无需重复处理。如需升级更高倍率（如 4×）或强制重新超分，请明确告诉我。',
        };
      }
      intent.operations = filteredOps;
      return intent;
    }

    if (intent?.tool === imageUpscaleTool.toolName) {
      const check = validateUpscaleParams(intent.params);
      if (!check.ok) return { action: 'chat_only', replyOverride: true, reply: check.message };
      intent.params = check.data;
    } else if (
      intent?.tool === storyboardPlanningTool.toolName ||
      intent?.tool === shotKeyframeTool.toolName ||
      intent?.tool === shotVideoTool.toolName
    ) {
      intent.params = normalizeClipParams(intent.params);
    }

    return intent;
  }

  private findFocusedShot(focus: AgentFocusContext): any | undefined {
    if (focus.target?.kind !== 'shot' || !focus.target.id) return undefined;
    const { shots } = getStoryboardContext(this.projectId, this.clipId);
    return shots.find((s: any) => s.shotId === focus.target!.id || s.id === focus.target!.id);
  }

  protected override resolveFocusDetails(focus: AgentFocusContext): string[] {
    const matchedShot = this.findFocusedShot(focus);
    if (!matchedShot) return [];

    const chars = Array.isArray(matchedShot.characters) && matchedShot.characters.length > 0
      ? matchedShot.characters.join('、')
      : '无（当前为空镜）';
    const items = Array.isArray(matchedShot.items) && matchedShot.items.length > 0
      ? matchedShot.items.join('、')
      : '无';
    const hasFirst = Boolean(matchedShot.firstFrameImageUrl || matchedShot.keyframeUrl);
    const hasLast = Boolean(matchedShot.lastFrameImageUrl || matchedShot.lastFrameUrl);
    const firstLabel = hasFirst
      ? matchedShot.firstFrameUpscale
        ? `首帧已生成（已超分 ${matchedShot.firstFrameUpscale.multiplier}×）`
        : '首帧已生成（未超分）'
      : '首帧未生成';
    const lastLabel = hasLast
      ? matchedShot.lastFrameUpscale
        ? `末帧已生成（已超分 ${matchedShot.lastFrameUpscale.multiplier}×）`
        : '末帧已生成（未超分）'
      : null;
    const statusParts = [
      firstLabel,
      ...(lastLabel ? [lastLabel] : []),
      matchedShot.videoUrl ? '视频已生成' : '视频未生成',
    ];

    return [
      `景别与运镜：${matchedShot.shotType || '未知'} | ${matchedShot.cameraMovement || '未知'} | 时长 ${matchedShot.durationSec || 4}s | 状态：${statusParts.join(' / ')}`,
      `出场角色：${chars} | 涉及道具：${items}`,
      `首帧提示词：${matchedShot.firstFramePrompt || '无'}`,
      ...(matchedShot.lastFramePrompt ? [`末帧提示词：${matchedShot.lastFramePrompt}`] : []),
      `动态视频提示词：${matchedShot.videoPrompt || '无'}`,
      ...(matchedShot.dialogue ? [`对白：${matchedShot.dialogue}`] : []),
      ...(matchedShot.transitionAnchor ? [`衔接锚点：${matchedShot.transitionAnchor}`] : []),
    ];
  }

  protected override resolveFocusImages(focus: AgentFocusContext): VisionImageRef[] {
    const matchedShot = this.findFocusedShot(focus);
    if (!matchedShot) return [];

    const images: VisionImageRef[] = [];
    const shotLabel = focus.target?.label || matchedShot.shotId || '当前镜头';
    const firstUrl = matchedShot.firstFrameImageUrl || matchedShot.keyframeUrl;
    const lastUrl = matchedShot.lastFrameImageUrl || matchedShot.lastFrameUrl;
    const isLastFocused = focus.meta?.step === 'last';

    // 1. 当前聚焦帧排第一，另一帧排第二（支持首末帧衔接观察）
    const frameEntries = isLastFocused
      ? [
          ...(lastUrl ? [{ mediaUrl: lastUrl, label: `${shotLabel} · 末帧`, role: '当前聚焦末帧', note: matchedShot.lastFramePrompt }] : []),
          ...(firstUrl ? [{ mediaUrl: firstUrl, label: `${shotLabel} · 首帧`, role: '同镜首帧', note: matchedShot.firstFramePrompt }] : []),
        ]
      : [
          ...(firstUrl ? [{ mediaUrl: firstUrl, label: `${shotLabel} · 首帧`, role: '当前聚焦首帧', note: matchedShot.firstFramePrompt }] : []),
          ...(lastUrl ? [{ mediaUrl: lastUrl, label: `${shotLabel} · 末帧`, role: '同镜末帧', note: matchedShot.lastFramePrompt }] : []),
        ];
    images.push(...frameEntries);

    // 2. 附带本镜出场角色的定妆基准图（最多 2 张，方便跨图看一致性、服装搭配与造型延续）
    const shotChars: string[] = Array.isArray(matchedShot.characters) ? matchedShot.characters : [];
    if (shotChars.length > 0) {
      const entities = ProjectStore.getInstance().getArtifact<any>(this.projectId, 'lookdev_entities');
      const characters: any[] = Array.isArray(entities?.characters) ? entities.characters : [];
      let addedRefs = 0;
      for (const token of shotChars) {
        if (addedRefs >= 2) break;
        const norm = String(token || '').trim().toLowerCase();
        if (!norm) continue;
        const matchedChar = characters.find(
          (c) =>
            String(c?.characterId || c?.id || '').toLowerCase() === norm ||
            String(c?.name || '').trim().toLowerCase() === norm
        );
        if (matchedChar?.imageUrl) {
          images.push({
            mediaUrl: matchedChar.imageUrl,
            label: matchedChar.name || matchedChar.characterId,
            role: '出场角色定妆基准',
          });
          addedRefs++;
        }
      }
    }

    return images;
  }
}
