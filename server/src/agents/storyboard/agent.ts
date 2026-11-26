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
import type { AgentFocusContext, SubmittableToolSpec } from '../runtime/types.js';
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
      hasShootingScript,
      shootingScriptSummary,
      phaseEvaluation,
      shots,
      unupscaledFirstShots,
      unupscaledLastShots,
      shotsSummary,
      storyOverview,
      previousClipSummary,
      nextClipSummary,
      taskHealth,
    } = getStoryboardContext(this.projectId, this.clipId);

    return `${storyboardRolePrompt(this.clipId, clipTitle)}

【全剧故事主线与核心基调】：
${storyOverview}

【当前分幕制作流水线状态机 (Storyboard SOP Pipeline)】：
- 当前所处阶段：${phaseEvaluation.description}
- 当前首要任务：${phaseEvaluation.currentMission}
- 视听演绎剧本状态：${hasShootingScript ? '已就绪 🟢 (具备时空环境锁与对白表演流)' : '待生成 🟡 (文学故事剧本尚未升级为视听演绎剧本)'}

${previousClipSummary ? `【前序分幕因果承接】：\n${previousClipSummary}\n` : ''}
【当前分幕专属性质与剧本文本】：
- 分幕标识：${this.clipId}（${clipTitle}）
- 本幕时长：${targetDurationSec} 秒 | 镜头总数：${shots.length} 镜
- 本幕文学剧本正文：
\`\`\`text
${narrativeText}
\`\`\`
${nextClipSummary ? `【后续分幕戏剧走向】：\n${nextClipSummary}\n` : ''}

【本幕视听演绎剧本案头 (Shooting Script)】：
${shootingScriptSummary}

【本幕当前已细化的分镜镜头清单 (${shots.length} 镜)】：
${shotsSummary || '  (当前尚未细化排布分镜镜头)'}

${taskHealth?.promptSummary || ''}

【本幕已出图但尚未超分镜头】：
- 首帧未超分 (${unupscaledFirstShots.length}): ${unupscaledFirstShots.map((s: any) => s.shotId).join('、') || '全部已超分或暂无已生成首帧'}
- 末帧未超分 (${unupscaledLastShots.length}): ${unupscaledLastShots.map((s: any) => s.shotId).join('、') || '无'}

### 视口交互与单镜聚焦原则
- 若当前视口已聚焦具体镜头（如「镜头 01 · 首帧」），且创作者未明确说明“全幕/全部/多镜”，默认仅针对当前聚焦的 1 镜发起提案，严禁擅自扩成全幕批量生成。`;
  }

  /**
   * 工序完成后的复盘与顺位推演引导 (Pipeline Post-Task SOP Hook)
   */
  public override getPostTaskPrompt(task: any, title: string): string {
    const toolName = task.toolName;

    if (toolName === 'film.shooting_script') {
      return `【工序完成事实】：
工序【${title || '视听摄制台本与分镜切片'}】已顺利执行完毕并物理落盘。
本幕场景时空环境锁已成功建立，分镜头单与画布镜头序列（shots）已一步到位生成并具备纯物理动作、精准角色对白与现场拟音！

【工序复盘与引导要求】：
1. **[成果复盘]**：汇报摄制台本中提炼出的时空环境锁与全量镜头切分概览（镜头总数、景别节奏、动作与对白事实）；
2. **[创作者自主探索]**：严禁自动出卡捆绑下游算力任务。使用 chat_only 礼貌告知创作者：“分镜切片已全部就位并同步至画布，您可以随时在画布中查看镜头、微调提示词或对指定镜头进行出图渲染”。`;
    }

    return super.getPostTaskPrompt(task, title);
  }

  /**
   * 多步计划（如批量推演视听词）执行完毕后的汇总复盘
   * 坚决贯彻镜头解锁顺序与承接纪律，杜绝擅自全量跨镜头提案出图
   */
  public override getPostPlanPrompt(
    planTitle: string,
    steps: Array<{ title: string; tool: string; status: string; durationMs?: number; error?: string }>
  ): string {
    const succeeded = steps.filter((s) => s.status === 'completed');
    const failed = steps.filter((s) => s.status === 'failed');
    const cancelled = steps.filter((s) => s.status === 'cancelled');
    const lines = steps.map((s, i) => {
      const sec = s.durationMs ? ` (${(s.durationMs / 1000).toFixed(1)}s)` : '';
      const statusText =
        s.status === 'completed'
          ? `完成${sec}`
          : s.status === 'failed'
          ? `失败: ${s.error || '未知错误'}`
          : s.status === 'cancelled'
          ? '已取消'
          : s.status;
      return `${i + 1}. ${s.title} [${statusText}]`;
    });

    return `【制片计划执行完毕】多步计划【${planTitle}】已全部结束（成功 ${succeeded.length}/${steps.length}，失败 ${failed.length}，取消 ${cancelled.length}）：
${lines.join('\n')}
请核对当前最新项目资产，用简练清晰的中文向创作者做整体汇总复盘。

【分镜镜头解锁顺序与承接纪律（严禁全量并发提案出图）】：
1. 关键帧渲染存在严格的镜头解锁顺序与视听承接方式（continuityMode：linked/auto 依赖前序镜头尾帧实拍成图；detached 独立机位）；
2. 严禁在此处跨镜头擅自打包全幕（如镜01–${steps.length}）批量出图提案！未获得前序镜头成图基准的受控镜头尚处于锁定状态；
3. 本轮以自然语言（chat_only）总结已落盘的视听推演成果，提示创作者可先从第 1 个已解锁镜头（或视口聚焦镜头）开始逐镜审阅与发起关键帧渲染。`;
  }

  private findFocusedShot(focus: AgentFocusContext): any | undefined {
    if (focus.target?.kind !== 'shot' || !focus.target.id) return undefined;
    const { shots } = getStoryboardContext(this.projectId, this.clipId);
    return shots.find((s: any) => s.shotId === focus.target!.id);
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
    const hasFirst = Boolean(matchedShot.firstFrameImageUrl);
    const hasLast = Boolean(matchedShot.lastFrameImageUrl);
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

    // 视听元数据与挂载标签状态（权威当前已生效标签 + 创作者新调整待生效标签）
    const effectiveDirectives = [
      matchedShot.cameraDirective?.label ? `机位:「${matchedShot.cameraDirective.label}」` : null,
      matchedShot.colorDirective?.label ? `调色:「${matchedShot.colorDirective.label}」` : null,
      matchedShot.poseDirective?.label ? `姿态:「${matchedShot.poseDirective.label}」` : null,
      matchedShot.motionDirective?.label ? `运镜:「${matchedShot.motionDirective.label}」` : null,
      matchedShot.dynamicDirective?.label ? `动力幅度:「${matchedShot.dynamicDirective.label}」` : null,
      matchedShot.focusDirective?.label ? `主体焦点:「${matchedShot.focusDirective.label}」` : null,
    ].filter(Boolean);

    const directiveLines: string[] = [
      `当前镜头已生效标签：${effectiveDirectives.length > 0 ? effectiveDirectives.join(' · ') : '尚未显式挂载'}`,
    ];

    if (focus.meta?.hasDirectiveChanges && focus.meta.changedSummary) {
      directiveLines.push(`⚡ 创作者新调整的标签（待下次出图或保存生效）：${focus.meta.changedSummary}`);
    } else if (focus.meta?.draftDirectives && focus.meta.draftDirectives !== '无') {
      directiveLines.push(`创作者当前预览挂载标签：${focus.meta.draftDirectives}`);
    }

    return [
      `镜头规格：${matchedShot.shotType || '默认景别'} | ${matchedShot.cameraMovement || '默认运镜'} | 时长 ${matchedShot.durationSec || 4}s | 状态：${statusParts.join(' / ')}`,
      ...directiveLines,
    ];
  }

  protected override resolveFocusImages(focus: AgentFocusContext): VisionImageRef[] {
    const matchedShot = this.findFocusedShot(focus);
    if (!matchedShot) return [];

    const images: VisionImageRef[] = [];
    const shotLabel = focus.target?.label || matchedShot.shotId || '当前镜头';
    const firstUrl = matchedShot.firstFrameImageUrl;
    const lastUrl = matchedShot.lastFrameImageUrl;
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
            String(c?.characterId || '').toLowerCase() === norm ||
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
