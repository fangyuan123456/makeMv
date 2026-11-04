/**
 * mastra/agents/context-assembler.ts
 * 导演智能体全景视听上下文装配器 (Director Context Assembler SSOT)
 * 
 * 职责（法典 0.4 单一事实来源与双轨记忆清晰划界）：
 * 1. 动态提取项目状态黑板、已落盘资产摘要、审查官各阶段门禁状态，消除模型上下文盲区；
 * 2. 专门产出 System Instructions 工程事实，彻底剥离历史对话拼贴，消灭 MockMemory 跨轮上下文雪崩！
 */

import { ProjectStore } from '../../project-store/ProjectStore.js';
import { WorkflowStage } from '../../types/index.js';

export interface AssembledContext {
  projectId: string;
  projectName: string;
  currentStage: string;
  assetsSummary: string;
  criticGatesSummary: string;
  creativeIdea: string;
  style: string;
}

export class ContextAssembler {
  private static instance?: ContextAssembler;

  public static getInstance(): ContextAssembler {
    if (!ContextAssembler.instance) {
      ContextAssembler.instance = new ContextAssembler();
    }
    return ContextAssembler.instance;
  }

  /**
   * 为指定项目组装高信噪比视听工程上下文
   */
  public assemble(projectId: string): AssembledContext {
    const store = ProjectStore.getInstance();
    const project = store.getProject(projectId);

    if (!project) {
      return {
        projectId,
        projectName: '未命名项目',
        currentStage: WorkflowStage.NARRATIVE_DESIGN,
        assetsSummary: '项目尚未初始化',
        criticGatesSummary: '无质检记录',
        creativeIdea: '',
        style: '',
      };
    }

    const stages = [
      { id: WorkflowStage.NARRATIVE_DESIGN, label: '叙事架构 (Story Bible)' },
      { id: WorkflowStage.CHARACTER_DESIGN, label: '角色定妆 (Character Portrait)' },
      { id: WorkflowStage.SCENE_SCRIPT, label: '分场文学剧本 (Scene Script)' },
      { id: WorkflowStage.STORYBOARD, label: '视听镜头分镜 (Storyboard)' },
      { id: WorkflowStage.KEYFRAME_REFERENCE, label: '关键帧参考图 (Keyframe Reference)' },
      { id: WorkflowStage.VIDEO_PRODUCTION, label: '动态视频切片 (Video Production)' },
      { id: WorkflowStage.FMV_PACKAGING, label: '互动母带打包 (FMV Packaging)' },
    ];

    // 1. 抽取资产实际内容高信噪比摘要
    const assetsLines: string[] = [];
    for (const s of stages) {
      const art = store.getArtifact<any>(projectId, s.id);
      if (!art) {
        assetsLines.push(`- 【${s.label}】: ⏳ 待生成`);
        continue;
      }

      // 根据工序提取细粒度资产索引，彻底根治模型“资产盲视”
      if (s.id === WorkflowStage.NARRATIVE_DESIGN && art.goldenSpine) {
        const charList = Array.isArray(art.characters)
          ? art.characters.map((c: any) => `${c.name}${c.role ? `(${c.role})` : ''}`).join('、')
          : '无';
        const endings = art.storyGraph?.endingsCount ?? '未知';
        assetsLines.push(`- 【${s.label}】: ✅ 已就绪 | 故事终局数: ${endings} 个 | 核心角色: [${charList}]`);
        if (art.logline) {
          assetsLines.push(`    * 核心一句话大纲: ${art.logline}`);
        }
      } else if (s.id === WorkflowStage.CHARACTER_DESIGN && Array.isArray(art.characters) && art.characters.length > 0) {
        const charItems = art.characters.map((c: any, idx: number) => {
          const status = c.imageUrl ? '✓已定妆' : '待渲染';
          const visual = c.appearance || c.visualPrompt || '暂无详细描述';
          const shortVisual = visual.length > 35 ? visual.slice(0, 35) + '...' : visual;
          return `    * [${idx + 1}] ${c.name} (${status}): ${shortVisual}`;
        });
        assetsLines.push(`- 【${s.label}】: ✅ 已就绪 (共 ${art.characters.length} 位角色)\n${charItems.join('\n')}`);
      } else if (s.id === WorkflowStage.SCENE_SCRIPT && Array.isArray(art.scenes) && art.scenes.length > 0) {
        const maxDisplay = 10;
        const sceneItems = art.scenes.slice(0, maxDisplay).map((sc: any, idx: number) => {
          const id = sc.sceneId || `scene_${idx + 1}`;
          const loc = sc.location || '未知场景';
          const summary = sc.summary || sc.content || sc.atmosphere || '无摘要';
          const shortSum = summary.length > 35 ? summary.slice(0, 35) + '...' : summary;
          return `    * ${id}【${loc}】: ${shortSum}`;
        });
        if (art.scenes.length > maxDisplay) {
          sceneItems.push(`    ... (其余 ${art.scenes.length - maxDisplay} 场已折叠)`);
        }
        assetsLines.push(`- 【${s.label}】: ✅ 已就绪 (共 ${art.scenes.length} 场戏)\n${sceneItems.join('\n')}`);
      } else if (s.id === WorkflowStage.STORYBOARD && Array.isArray(art.shots) && art.shots.length > 0) {
        const maxDisplay = 10;
        const shotItems = art.shots.slice(0, maxDisplay).map((sh: any, idx: number) => {
          const id = sh.shotId || `shot_${idx + 1}`;
          const shotSize = sh.shotSize || '中景';
          const cam = sh.cameraMovement || '固定';
          return `    * [${id}] ${shotSize}/${cam}: ${(sh.visualComposition || '无画面说明').slice(0, 30)}`;
        });
        if (art.shots.length > maxDisplay) {
          shotItems.push(`    ... (其余 ${art.shots.length - maxDisplay} 镜已折叠)`);
        }
        assetsLines.push(`- 【${s.label}】: ✅ 已就绪 (共 ${art.shots.length} 镜台本)\n${shotItems.join('\n')}`);
      } else if (s.id === WorkflowStage.KEYFRAME_REFERENCE && Array.isArray(art.keyframes) && art.keyframes.length > 0) {
        const renderedCount = art.keyframes.filter((k: any) => k.imageUrl).length;
        assetsLines.push(`- 【${s.label}】: ✅ 已就绪 (共 ${art.keyframes.length} 帧基准图，已渲染 ${renderedCount} 帧)`);
      } else if (s.id === WorkflowStage.VIDEO_PRODUCTION && Array.isArray(art.clips) && art.clips.length > 0) {
        const renderedClips = art.clips.filter((c: any) => c.videoUrl).length;
        assetsLines.push(`- 【${s.label}】: ✅ 已就绪 (共 ${art.clips.length} 个动态切片，已渲染 ${renderedClips} 段)`);
      } else if (s.id === WorkflowStage.FMV_PACKAGING && art.gameManifestUrl) {
        assetsLines.push(`- 【${s.label}】: ✅ 母带已打包 (互动节点: ${art.totalNodes || 0} 个，总时长: ${art.playableDurationSec || 0}s)`);
      } else {
        assetsLines.push(`- 【${s.label}】: ✅ 资产已落盘`);
      }
    }

    // 2. 抽取审查官门禁判定与最新缺陷备忘
    const gatesLines: string[] = [];
    const reviewArtifact = store.getArtifact<any>(projectId, 'critic_review');
    if (!reviewArtifact) {
      gatesLines.push('- 最新质检门禁: 暂无审查记录 (创作者推进工序时可适时提议审查)');
    } else {
      const decision = reviewArtifact.gateDecision || 'WARN';
      const score = reviewArtifact.overallScore ?? '未评分';
      gatesLines.push(`- 最新质检门禁: [${decision}] (综合得分: ${score}/100)`);
      if (reviewArtifact.blockingIssues && reviewArtifact.blockingIssues.length > 0) {
        gatesLines.push(`  * 刚性阻断项: ${reviewArtifact.blockingIssues.join('；')}`);
      }
      if (reviewArtifact.suggestions && reviewArtifact.suggestions.length > 0) {
        gatesLines.push(`  * 导演改进建议: ${reviewArtifact.suggestions.join('；')}`);
      }
    }

    return {
      projectId,
      projectName: project.title,
      currentStage: project.currentStage,
      assetsSummary: assetsLines.join('\n'),
      criticGatesSummary: gatesLines.join('\n'),
      creativeIdea: project.meta?.idea || '',
      style: project.meta?.style || '电影质感，写实光影',
    };
  }

  /**
   * 构造系统级视听工程全景感知 System Prompt
   * 彻底剥离多轮对话历史拼贴，交给 Mastra Memory 原生管理，根治上下文雪崩
   */
  public buildSystemInstructions(projectId: string, sessionId?: string): string {
    const ctx = this.assemble(projectId);
    const store = ProjectStore.getInstance();
    const session = sessionId ? store.getSession(projectId, sessionId) : undefined;
    const project = store.getProject(projectId);

    // 抽取 9 大 Working Memory 白板字段 (持久化事实来源)
    const scratchpad = session?.scratchpad;
    const whiteboard = (project?.meta?.whiteboard as any) || {};

    const constraints = (scratchpad?.userConstraints && scratchpad.userConstraints.length > 0)
      ? scratchpad.userConstraints.join('；')
      : (project?.meta?.userConstraints?.join('；') || whiteboard.taboos || '无特别禁忌');

    const visualAnchors = scratchpad?.characterVisualAnchors || '尚无定妆视觉锚点';
    const storySpine = scratchpad?.storySpine || whiteboard.narrative_threads || '单主线推进';

    const memoryBlock = [
      '【影视工业备忘录白板 (Working Memory 持久化事实)】:',
      `- 题材与影调风格: ${scratchpad?.themeAndStyle || ctx.style}`,
      `- 戏剧冲突骨架: ${storySpine}`,
      `- 核心定妆视觉锚点: ${visualAnchors}`,
      `- 创作者刚性禁忌与偏好红线: ${constraints}`,
    ].join('\n');

    return [
      '【当前视听工程实时全景感知 (SSOT)】:',
      `- 项目唯一 ID: ${ctx.projectId} (调用高阶工具如 propose-stage-action / inspect-project-state 时请携带此 projectId)`,
      `- 项目名称: ${ctx.projectName}`,
      `- 当前工序阶段: ${ctx.currentStage}`,
      `- 核心创意构思: ${ctx.creativeIdea || '创作者尚未定义，待通过对话推演'}`,
      `- 视听美学风格: ${ctx.style}`,
      `\n${memoryBlock}`,
      `\n【已就绪视听资产清单】:\n${ctx.assetsSummary}`,
      `\n【审查官质检门禁】:\n${ctx.criticGatesSummary}`,
      `\n【总导演权限与防脱轨防闲聊刚性警示】:`,
      `- 当前服务项目: 【${ctx.projectName}】(阶段: ${ctx.currentStage})`,
      `- 权限红线: 若创作者输入任何脱离影视创作、剧本推演与当前工程的闲聊、日常琐事、天气、通用编程写代码等无关话题，必须坚决执行【防脱轨护栏】，严禁顺从回答，严禁调用 propose-stage-action 工具，必须沉稳礼貌拒绝并引导其聚焦当前【${ctx.currentStage}】阶段的推进！`,
    ].join('\n');
  }

  /**
   * 格式化提示词（保留用于单次无记忆请求或测试用例兼容）
   */
  public formatPromptWithContext(projectId: string, userMessage: string, sessionId?: string): string {
    const systemBlock = this.buildSystemInstructions(projectId, sessionId);
    return [
      systemBlock,
      '\n【创作者最新指令】:',
      userMessage || '(创作者无输入，请主动依据当前项目阶段提出下一步导演建议)',
    ].join('\n');
  }
}
