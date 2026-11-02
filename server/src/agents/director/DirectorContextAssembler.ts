/**
 * agents/director/DirectorContextAssembler.ts
 * AI 导演上下文与双轨记忆装配器 (Director Context Assembler)
 * 
 * 单一职责：
 * 1. 动态阶段感知与系统 SOP 组装；
 * 2. 阶段聚焦外挂技能清单格式化；
 * 3. 权威视听交付物轻量化全景注入 (消除导演副手“资产盲视”，覆盖 Stage 1~7 全生命周期)；
 * 4. 独立影视审查官门禁拦截告诫动态注入 (双核博弈闭环，按阶段精准隔离)；
 * 5. 规范化多轮对话 Turns 组装，注入历史提案因果上下文；
 * 6. 🌟 确定性交替状态机 (Turns Alternation Normalizer)：保证多轮 Turns 绝对交替，根绝 400 异常。
 */

import { ProjectStore } from '../../project-store/ProjectStore.js';
import { ChatMemoryManager } from '../../chat/memory/ChatMemoryManager.js';
import { buildDirectorSystemPrompt } from './prompt.js';
import { SkillRegistry } from '../../skills/SkillRegistry.js';
import { CriticReviewerAgent } from '../reviewer/CriticReviewerAgent.js';
import { WorkflowStage, type StageArtifactMap } from '../../types/index.js';
import type { DirectorContext } from './types.js';

/**
 * 🌟 权威视听阶段产物轻量化语义提取器 (消除导演对真实交付物的资产盲视，覆盖 Stage 1 ~ Stage 7)
 */
function formatArtifactsForDirector(artifacts: Partial<StageArtifactMap>): string {
  if (!artifacts || Object.keys(artifacts).length === 0) return '';
  const lines: string[] = ['\n\n📦【当前项目已落盘的权威视听工序资产 (Stage Deliverables SSOT)】：'];

  // 1. 故事圣经与叙事设计 (对齐 StoryBibleArtifact 强类型契约)
  const bible = (artifacts[WorkflowStage.NARRATIVE_DESIGN] as any)?.bible || artifacts[WorkflowStage.NARRATIVE_DESIGN];
  if (bible) {
    const title = bible.title ? `《${bible.title}》` : '';
    const theme = bible.theme || '';
    const style = bible.style || '';
    lines.push(`\n[Stage 1: 故事世界观圣经 (StoryBible)]`);
    if (title || theme || style) lines.push(`- 哲学立意与风格基调: ${[title, theme, style].filter(Boolean).join(' · ')}`);
    if (bible.logline) lines.push(`- 故事核心梗概: ${bible.logline}`);

    if (Array.isArray(bible.goldenSpine) && bible.goldenSpine.length > 0) {
      lines.push(`- 黄金四幕起承转合主干:`);
      bible.goldenSpine.forEach((act: any, idx: number) => {
        lines.push(`  * 第${idx + 1}幕 [${act.name}]: ${act.summary || ''} (核心冲突: ${act.cliffhanger || '无'})`);
      });
    }

    const characters = bible.characters || [];
    if (Array.isArray(characters) && characters.length > 0) {
      lines.push(`- 核心登场人物档案 (${characters.length}位):`);
      characters.forEach((c: any) => {
        lines.push(`  * 【${c.name}】(${c.role || '角色'}): 动机: ${c.motivation || '未详'} | 骨相特征: ${c.appearance || '未详'}`);
      });
    }
  }

  // 2. 角色视觉定妆
  const characterArtifact = artifacts[WorkflowStage.CHARACTER_DESIGN];
  if (characterArtifact && Array.isArray(characterArtifact.characters)) {
    lines.push(`\n[Stage 2: 核心角色视觉定妆照 (CharacterPortraits)]`);
    characterArtifact.characters.forEach((c) => {
      const status = c.imageUrl || c.selected ? '✓ 定妆照已就绪' : '待生成';
      lines.push(`- 【${c.name}】: ${status}`);
    });
  }

  // 3. 分场多分支剧本 (结构化场次索引，覆盖时空与对白)
  const sceneScript = artifacts[WorkflowStage.SCENE_SCRIPT];
  if (sceneScript && Array.isArray(sceneScript.scenes) && sceneScript.scenes.length > 0) {
    lines.push(`\n[Stage 3: 分场多分支剧本场次索引 (SceneScript)] 共 ${sceneScript.scenes.length} 场戏:`);
    sceneScript.scenes.forEach((sc: any) => {
      const dlgPreview = Array.isArray(sc.dialogues) && sc.dialogues.length > 0
        ? `核心对白: "${sc.dialogues[0].speaker}: ${sc.dialogues[0].line.slice(0, 30)}..."`
        : '纯动作/环境镜头';
      lines.push(`  * [场次 #${sc.nodeId}] (第${sc.act || 1}幕·${sc.timeOfDay || '日内'}·${sc.location || '场景'}): 《${sc.sceneTitle}》- ${sc.actionSummary?.slice(0, 45) || ''} | ${dlgPreview}`);
    });
  }

  // 4. 导演分镜头 (精确镜头索引与视听描述，支撑创作者指定修改第 N 镜)
  const storyboard = artifacts[WorkflowStage.STORYBOARD];
  if (storyboard && Array.isArray(storyboard.shots) && storyboard.shots.length > 0) {
    lines.push(`\n[Stage 4: 导演视听分镜镜头索引 (Storyboard)] 共 ${storyboard.shots.length} 个机位镜头:`);
    const totalShots = storyboard.shots.length;
    storyboard.shots.forEach((shot: any, idx: number) => {
      // 镜头过多时折叠中间项以防 Prompt 爆炸，首尾及关键项全部保留
      if (totalShots > 15 && idx >= 6 && idx < totalShots - 4) {
        if (idx === 6) lines.push(`  * ... [中间已折叠 ${totalShots - 10} 个镜头索引以防上下文溢出] ...`);
        return;
      }
      const shotId = shot.shotId || `shot_${idx + 1}`;
      const scale = shot.shotScale || '中景';
      const move = shot.cameraMovement || '固定镜头';
      const duration = shot.duration ? `${shot.duration}s` : '5s';
      const visual = shot.visualContent ? `画面: ${shot.visualContent.slice(0, 40)}` : '';
      const dialogue = shot.dialogueOrAction ? `对白/动作: ${shot.dialogueOrAction.slice(0, 30)}` : '';
      lines.push(`  * [镜头 #${shotId}] [${scale}·${duration}·${move}]: ${visual} | ${dialogue}`);
    });
  }

  // 5. 关键帧首帧参考图 (镜头画面生成状态)
  const keyframes = artifacts[WorkflowStage.KEYFRAME_REFERENCE];
  if (keyframes && Array.isArray(keyframes.shots) && keyframes.shots.length > 0) {
    lines.push(`\n[Stage 5: 分镜高清关键帧渲染状态 (Keyframes)] 共 ${keyframes.shots.length} 幅:`);
    const totalKf = keyframes.shots.length;
    keyframes.shots.forEach((kf: any, idx: number) => {
      if (totalKf > 15 && idx >= 6 && idx < totalKf - 4) {
        if (idx === 6) lines.push(`  * ... [中间已折叠 ${totalKf - 10} 个关键帧状态] ...`);
        return;
      }
      const shotId = kf.shotId || `shot_${idx + 1}`;
      const status = kf.imageUrl ? '✓ 高清画面已就绪' : '待生成';
      lines.push(`  * [镜头 #${shotId} 首帧]: ${status}`);
    });
  }

  // 6. 动态视听切片渲染 (Stage 6)
  const videoArtifact = artifacts[WorkflowStage.VIDEO_PRODUCTION];
  if (videoArtifact && Array.isArray(videoArtifact.clips) && videoArtifact.clips.length > 0) {
    const readyClips = videoArtifact.clips.filter((c: any) => c.videoUrl || c.status === 'rendered').length;
    lines.push(`\n[Stage 6: 动态视听视频切片库 (VideoProduction)] (已渲染就绪: ${readyClips}/${videoArtifact.clips.length}):`);
    const totalClips = videoArtifact.clips.length;
    videoArtifact.clips.forEach((clip: any, idx: number) => {
      if (totalClips > 15 && idx >= 6 && idx < totalClips - 4) {
        if (idx === 6) lines.push(`  * ... [中间已折叠 ${totalClips - 10} 个切片状态] ...`);
        return;
      }
      const shotId = clip.shotId || `shot_${idx + 1}`;
      const status = clip.videoUrl ? `✓ 渲染完成 (${clip.durationSec || 5}s)` : '待生成/渲染中';
      lines.push(`  * [切片 #${shotId}]: ${status}`);
    });
  }

  // 7. FMV 影游母带装配与互动拓扑 (Stage 7)
  const fmvArtifact = artifacts[WorkflowStage.FMV_PACKAGING];
  if (fmvArtifact) {
    const totalNodes = fmvArtifact.totalNodes || (fmvArtifact.fmvManifest?.nodes ? Object.keys(fmvArtifact.fmvManifest.nodes).length : 0);
    const endings = fmvArtifact.totalEndings || 0;
    const packageStatus = fmvArtifact.status === 'packaged' || fmvArtifact.gameManifestUrl ? '✓ 母带拓扑已发布' : '编排中';
    lines.push(`\n[Stage 7: 影游母带与分支拓扑 (FMVPackaging)] 状态: ${packageStatus}，包含 ${totalNodes} 个互动剧情节点，${endings} 个结局。`);
  }

  return lines.join('\n');
}

export class DirectorContextAssembler {
  private static instance?: DirectorContextAssembler;

  public static getInstance(): DirectorContextAssembler {
    if (!DirectorContextAssembler.instance) {
      DirectorContextAssembler.instance = new DirectorContextAssembler();
    }
    return DirectorContextAssembler.instance;
  }

  /**
   * 组装面向大模型对话推演的完整上下文
   */
  public assemble(projectId: string, sessionId: string): DirectorContext {
    const memoryManager = ChatMemoryManager.getInstance();
    const projectStore = ProjectStore.getInstance();

    const project = projectStore.getProject(projectId);
    const session = projectStore.getSession(projectId, sessionId);

    if (!session) {
      throw new Error(`[DirectorContextAssembler] 会话 ${sessionId} 不存在`);
    }

    // 🌟 单一事实来源 (SSOT)：项目当前工序阶段以 ProjectStore 状态黑板为准
    const currentStage = project?.currentStage || session.currentStage || WorkflowStage.NARRATIVE_DESIGN;

    // 1. 系统 SOP 与外挂技能清单
    const rawSystemPrompt = buildDirectorSystemPrompt(currentStage);
    const skillsPrompt = SkillRegistry.getInstance().formatSkillsForPrompt(currentStage);

    // 2. 🌟 权威视听交付物轻量化全景注入 (消除导演副手“资产盲视”)
    const artifacts = project?.stageArtifacts || {};
    const artifactsPrompt = formatArtifactsForDirector(artifacts);

    // 3. 双核博弈自愈闭环 (Director ⇄ Critic Feedback Loop)：感知独立审查官门禁拦截报告 (按工序阶段隔离)
    const reviewReport = CriticReviewerAgent.getInstance().getEffectiveReport(projectId, currentStage);
    let reviewDirective = '';
    if (
      reviewReport &&
      reviewReport.stageReviewed === currentStage && // 🌟 刚性阶段隔离：仅当审查报告属于当前工序时生效
      reviewReport.gateStatus !== 'PASS' &&
      reviewReport.gateStatus !== 'STALE' &&
      reviewReport.criticalFlaws &&
      reviewReport.criticalFlaws.length > 0
    ) {
      const flawsSummary = reviewReport.criticalFlaws
        .map((f, i) => `${i + 1}. [${f.severity}] ${f.location}: ${f.description}\n   -> 审查官修改建议: ${f.suggestion}`)
        .join('\n');

      reviewDirective = `\n\n🚨【独立影视审查官与剧本医生门禁拦截告诫 (Critic Gate Alert)】\n` +
        `审查官已针对当前工序出具了【${reviewReport.gateStatus}】决策 (总评: ${reviewReport.scores?.overallScore ?? 0}/100)！\n` +
        `终审评语: "${reviewReport.verdict}"\n` +
        `以下核心逻辑破绽已被门禁刚性拦截:\n${flawsSummary}\n\n` +
        `【总导演本次对话应对铁律】：\n` +
        `1. 你必须在本次自然回复中，主动且严肃地向创作者指出上述破绽，并重点引导创作者推敲具体的戏剧自愈与设定修正方案；\n` +
        `2. 在上述致命破绽未被解决前，严禁发起推进下一阶段工序的行动提案！\n`;
    } else if (
      reviewReport &&
      reviewReport.stageReviewed === currentStage &&
      reviewReport.gateStatus === 'PASS' &&
      Array.isArray(reviewReport.debateLogs) &&
      reviewReport.debateLogs.length > 0
    ) {
      const lastDebate = reviewReport.debateLogs[reviewReport.debateLogs.length - 1];
      reviewDirective = `\n\n🛡️【独立审查官辩驳放行共识 (Critic Defense Cleared)】\n` +
        `创作者此前就戏剧设定向审查官发起辩护并已成功获得认可 (门禁已准许放行 PASS，总评: ${reviewReport.scores?.overallScore ?? 85}/100)！\n` +
        `最新澄清共识：“创作者说明: ${lastDebate.userMessage} ➔ 审查官裁决: ${lastDebate.reply}”\n` +
        `【总导演本次对话应对建议】：请充分尊重并呼应这一辩护共识，在对话中积极协助创作者以此为基石顺利推进后续工序。\n`;
    }

    const combinedSystemPrompt = `${rawSystemPrompt}${skillsPrompt}${artifactsPrompt}${reviewDirective}`;

    // 4. 双轨记忆装配
    const existingMessages = projectStore.getMessages(projectId, sessionId);
    const assembled = memoryManager.assembleContext(
      session,
      combinedSystemPrompt,
      existingMessages
    );

    // 5. 🌟 确定性角色交替状态机 (Role Alternation Invariance)：根除多轮 400 异常与上下文毒化
    const turns: Array<{ role: 'user' | 'assistant'; content: string }> = [];
    for (const msg of assembled.slidingWindowMessages) {
      if (msg.role !== 'user' && msg.role !== 'assistant') continue;
      // 🌟 纯净创作内容过滤 (SSOT)：丢弃中断与网络异常消息，杜绝出戏致歉污染大模型对话前情
      if (msg.isError || msg.isAborted) continue;

      let contentText = msg.content || '';

      // 🌟 因果记忆闭环：若 Assistant 历史消息携带自主行动提案，显式透传其语义与当前生命周期状态
      if (msg.role === 'assistant' && msg.actionProposal) {
        const p = msg.actionProposal;
        const statusDesc = p.status === 'executed' ? '已执行完毕' : p.status === 'dismissed' ? '已废弃/忽略' : '待创作者确认';
        contentText += `\n\n[行动提议记录: 《${p.label}》 | 关联工序: ${p.skill} | 状态: ${statusDesc}]`;
      }

      if (!contentText.trim()) continue;

      const lastTurn = turns[turns.length - 1];
      if (lastTurn && lastTurn.role === msg.role) {
        // 🌟 相邻同角色语义换行合并：消灭连续相同角色，确保数学级交替
        lastTurn.content += `\n\n${contentText}`;
      } else {
        turns.push({ role: msg.role, content: contentText });
      }
    }

    // 🌟 首条 Role 刚性门禁：若首条消息为 assistant，丢弃直至首条为 user，彻底根除大模型 400 校验异常
    while (turns.length > 0 && turns[0].role !== 'user') {
      turns.shift();
    }

    return {
      systemPromptWithScratchpad: assembled.systemPromptWithScratchpad,
      turns,
      currentStage,
      reviewReport,
    };
  }
}
