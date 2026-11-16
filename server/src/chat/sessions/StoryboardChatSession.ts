/**
 * server/src/chat/sessions/StoryboardChatSession.ts
 * 专职分幕分镜总导演机器人微内核 (Per-Clip Storyboard Director SSOT)
 *
 * 核心架构模式：
 * 1. 声明式工序能力规范 (getIntentToolSpecs SSOT)：
 *    直连 storyboardPlanningTool；
 * 2. 基类内置官方意图决策工具 (emit_director_intent) 与 P0 ➔ P5 漏斗；
 * 3. 外部提示词纯业务化，零硬编码具体工具名。
 */

import { z } from 'zod';
import { BaseChatSession } from '../BaseChatSession.js';
import { ProjectStore } from '../../project-store/ProjectStore.js';
import { storyboardPlanningTool } from '../../tools/film-production/index.js';
import type { SubmittableToolSpec } from '../types.js';

export interface StoryboardActionIntent {
  action: 'run_tool' | 'approve' | 'modify' | 'next_stage';
  tool: 'film.storyboard_planning';
  title: string;
  params: {
    projectId: string;
    clipId: string;
    instruction?: string;
    [key: string]: any;
  };
  description?: string;
  reasoning?: string;
}

export class StoryboardChatSession extends BaseChatSession<StoryboardActionIntent> {
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
    return [
      {
        toolName: storyboardPlanningTool.toolName,
        title: `优化分幕[${this.clipId || '当前'}]分镜台本`,
        description: storyboardPlanningTool.description,
        schema: storyboardPlanningTool.inputSchema || z.any(),
      },
    ];
  }

  /**
   * 组装本分幕专属分镜导演 System Prompt
   */
  protected assembleSystemPrompt(): string {
    const store = ProjectStore.getInstance();
    const project = store.getProject(this.projectId) as any;
    const prd = (store.getArtifact(this.projectId, 'universal_prd') as any) || (store.getArtifact(this.projectId, 'prd') as any) || project?.prd || {};
    const storyboards = (store.getArtifact(this.projectId, 'storyboards') as any[]) || project?.storyboards || [];

    // 1. 定位当前分幕的 PRD 剧情切片
    const currentPrdClip = (prd?.clips || []).find((c: any) => c.id === this.clipId) || {};
    const clipTitle = currentPrdClip.title || this.clipId || '当前分幕';
    const narrativeText = currentPrdClip.narrativeText || '暂无剧本正文';

    // 2. 定位当前分幕现存的分镜台本订单
    const currentStoryboardClip = storyboards.find((s: any) => s.clipId === this.clipId || s.sourceNodeId === this.clipId);
    const shots: any[] = Array.isArray(currentStoryboardClip?.shots) ? currentStoryboardClip.shots : [];

    const shotsSummary = shots
      .map(
        (s: any, idx: number) =>
          `  - 镜号 ${idx + 1} (${s.shotId}): [${s.shotType || 'MEDIUM_SHOT'}] 运镜: ${s.cameraMovement || 'locked-off'} | 时长: ${s.durationSec || 4}s | 首帧画面: ${s.firstFramePrompt?.slice(0, 80) || ''}...`
      )
      .join('\n');

    return `你是一名享誉业界的顶级电影视听总导演与分镜大师（Storyboard & Cinematography Director）。
你现在正在工序 2【分镜台本制作工坊】中，专职担任【${this.clipId} · ${clipTitle}】分幕的执行导演。

【你的专注领域（仅限当前分幕 ${this.clipId} 的镜头语言）】：
1. 镜头切分与戏剧节拍：以戏剧节拍（Dramatic Beat）为骨架，为本幕剧情设计富有呼吸感与张力的镜头序列；
2. 景别亲密度与机位调度：根据信息广度与情感亲密度（远景/中景/特写/主观POV/正反打）自适应调整；
3. 摄影机动势与运镜：推、拉、摇、移、跟镜头与情绪张力的匹配；
4. 视听三明治结构微调：优化本幕镜头的首帧构图词、运镜表演词、环境拟音与台词。
你【不负责】角色外观立绘的重绘，若创作者询问换服装改外貌，请引导创作者在视觉定妆工坊中与定妆总监交流。

【当前分幕专属性质与剧本文本】：
- 分幕标识：${this.clipId}（${clipTitle}）
- 本幕时长：${currentStoryboardClip?.targetDurationSec || 0} 秒 | 镜头总数：${shots.length} 镜
- 本幕剧本正文：
\`\`\`text
${narrativeText}
\`\`\`

【本幕当前已排布的镜头清单 (${shots.length} 镜)】：
${shotsSummary || '  (当前尚未排布镜头)'}

### 决策与执行协议
你持有官方意图决策工具【emit_director_intent】。在流式自然语言回复中，严格根据分幕剧本、镜头清单、意图决策漏斗与当前挂载的能力编目，调用该工具发射决策信号：
- 必须输出对话正文（Mandatory Speech）：在调用 emit_director_intent 的同时，必须在对话正文中先阐明分镜调整思路或确认对白，严禁正文留空；
- propose: 出具针对本幕分镜台本的微调重排方案卡片（params 包含 clipId: "${this.clipId}", instruction）；
- approve: 识别创作者认可授权指令（如“同意/准了/开跑/开始吧”），直接授权执行；
- modify: 吸收创作者修改意见，重塑镜头分镜参数；
- chat_only: 纯视听美学交流或无需修改台本时使用，无需发起微调方案。

${BaseChatSession.renderFunnelPromptMatrix()}
`;
  }
}
