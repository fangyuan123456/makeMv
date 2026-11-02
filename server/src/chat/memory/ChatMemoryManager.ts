/**
 * chat/memory/ChatMemoryManager.ts
 * 双轨上下文记忆管理器 (Dual-Track Memory Engine SSOT)
 *
 * 核心机制：
 * 1. 轨道一：短期自然语言滑动窗口 (Sliding Window，保证即时会话口吻与连贯性)；
 * 2. 轨道二：全局事实备忘录白板 (Scratchpad Memory，保证大局观、人设与禁忌永不失忆)；
 * 3. 资产权威保护等级 (Asset Hierarchy)：禁止粗粒度异步总结反向覆写高精度工序交付物；
 * 4. 服务端 100% 集中治理，拒绝客户端篡改与超长文本带宽浪费。
 */

import { ProjectStore } from '../../project-store/ProjectStore.js';
import { WorkflowStage } from '../../types/index.js';
import type { ChatSession, ChatMessage, ScratchpadMemory } from '../session/types.js';
import type { MemoryConfig, AssembledContext } from './types.js';
import {
  SCRATCHPAD_SUMMARIZER_SYSTEM_PROMPT,
  buildScratchpadUpdatePrompt,
} from './prompt.js';
import { ScratchpadSummarySchema } from './schema.js';
import { LLMRegistry } from '../../llm/LLMRegistry.js';

export class ChatMemoryManager {
  private static instance?: ChatMemoryManager;
  private readonly config: MemoryConfig;
  /** 🌟 并发防抖锁：防止连续发消息触发多次重复后台提炼 */
  private summarizingSessions = new Set<string>();
  /** 🌟 排队跟进标记：提炼执行期间若有新消息到达，记录排队并在完成后自动无缝补提炼 */
  private pendingFollowupSessions = new Set<string>();

  constructor(customConfig?: Partial<MemoryConfig>) {
    this.config = {
      windowSize: customConfig?.windowSize ?? 12, // 🌟 基准滑动窗口扩充至 12 条 (覆盖 6 轮对话，彻底满足连续改稿指令)
      summarizeInterval: customConfig?.summarizeInterval ?? 4,
    };
  }

  public static getInstance(): ChatMemoryManager {
    if (!ChatMemoryManager.instance) {
      ChatMemoryManager.instance = new ChatMemoryManager();
    }
    return ChatMemoryManager.instance;
  }

  /**
   * 将当前会话的备忘录白板格式化为高内聚提示词注入段落
   */
  public formatScratchpadPrompt(scratchpad?: ScratchpadMemory): string {
    if (!scratchpad) return '';
    const items: string[] = [];

    if (scratchpad.themeAndStyle) {
      items.push(`* 【视觉影调与风格基调】：${scratchpad.themeAndStyle}`);
    }
    if (scratchpad.logline) {
      items.push(`* 【一句话故事大纲 (Logline)】：${scratchpad.logline}`);
    }
    if (scratchpad.charactersSummary) {
      items.push(`* 【已确立的核心角色档案】：\n${scratchpad.charactersSummary}`);
    }
    if (scratchpad.characterVisualAnchors) {
      items.push(`* 【核心角色视觉定妆锚点 (发型/服装色彩/标志性配饰/定妆图)】：\n${scratchpad.characterVisualAnchors}`);
    }
    if (scratchpad.storySpine) {
      items.push(`* 【黄金核心冲突骨架】：\n${scratchpad.storySpine}`);
    }
    if (scratchpad.cinematographyAndRhythm) {
      items.push(`* 【镜头运动基调与剪辑节奏规范】：\n${scratchpad.cinematographyAndRhythm}`);
    }
    if (scratchpad.audioAndVoicePreferences) {
      items.push(`* 【角色音色偏好与声音对白质感】：\n${scratchpad.audioAndVoicePreferences}`);
    }
    if (scratchpad.packagingAndInteractiveSpec) {
      items.push(`* 【互动决策机制与交互包装规范】：\n${scratchpad.packagingAndInteractiveSpec}`);
    }
    if (scratchpad.userConstraints && scratchpad.userConstraints.length > 0) {
      const constraints = scratchpad.userConstraints.map((c) => `  - ${c}`).join('\n');
      items.push(`* 【创作者明确提出的刚性要求与禁忌红线 (绝对严格遵从)】：\n${constraints}`);
    }

    if (items.length === 0) return '';

    return `\n\n════════════════════════════════════════════════════════════════\n` +
      `📋【导演与创作者已拍板确认的全局事实备忘录 (Scratchpad)】\n` +
      `以下是你们之前在会议中已经确认的干货结论，请在接下来的对话中作为唯一合法事实基准，严禁偏离或违背红线：\n` +
      items.join('\n\n') +
      `\n════════════════════════════════════════════════════════════════\n`;
  }

  /**
   * 动态提取当前短期精细滑动窗口 (Sliding Window)
   */
  public getSlidingWindowMessages(
    allMessages: ChatMessage[],
    windowSize: number = this.config.windowSize
  ): ChatMessage[] {
    // 过滤掉纯系统消息，只提取真正的交互对话
    const dialogMessages = allMessages.filter((m) => m.role !== 'system');
    let recent = dialogMessages.slice(-windowSize);
    // 🌟 首消息 Role 刚性门禁：若截断后首条消息为 assistant，丢弃它直至首条为 user，杜绝大模型 API 报 400
    while (recent.length > 0 && recent[0].role !== 'user') {
      recent = recent.slice(1);
    }

    return recent;
  }

  /**
   * 🌟 核心组装器：组装最终送给大模型的单一事实上下文
   * 杜绝客户端拼装！服务端将【系统人设 + 白板事实 + 滑动窗口】三位一体智能融合
   */
  public assembleContext(
    session: ChatSession,
    rawSystemPrompt: string,
    existingMessages: ChatMessage[]
  ): AssembledContext {
    const scratchpad = session.scratchpad;
    const scratchpadSection = this.formatScratchpadPrompt(scratchpad);
    const systemPromptWithScratchpad = `${rawSystemPrompt.trim()}${scratchpadSection}`;

    // 🌟 改稿高频期与后期制作阶段弹性倾斜：在叙事大纲之后的制作阶段扩充窗口深度至 14 条
    const isPostProduction = session.currentStage !== WorkflowStage.NARRATIVE_DESIGN;
    const effectiveWindowSize = isPostProduction ? Math.max(this.config.windowSize, 14) : this.config.windowSize;

    const slidingWindowMessages = this.getSlidingWindowMessages(
      existingMessages,
      effectiveWindowSize
    );

    return {
      systemPromptWithScratchpad,
      slidingWindowMessages,
      scratchpad,
    };
  }

  /**
   * 旁路异步微任务：检查是否需要更新全局事实备忘录
   * 不阻塞主交互响应，在后台默默维护白板
   */
  public maybeTriggerBackgroundSummarization(
    projectId: string,
    sessionId: string,
    forceImmediate: boolean = false
  ): void {
    const store = ProjectStore.getInstance();
    const session = store.getSession(projectId, sessionId);
    if (!session) return;

    const allMessages = store.getMessages(projectId, sessionId);
    // 消息太少且未要求强制立即提炼时跳过
    const lastCount = session.scratchpad?.lastSummarizedCount || 0;
    const increment = allMessages.length - lastCount;
    if (!forceImmediate) {
      if (allMessages.length < this.config.windowSize) return;
      if (increment < this.config.summarizeInterval) return;
    }
    if (allMessages.length === 0) return;

    // 异步执行提炼
    setTimeout(async () => {
      try {
        await this.executeSummarization(projectId, sessionId);
      } catch (err) {
        console.warn(`[ChatMemoryManager] 异步提炼备忘录失败 (已安全降级):`, err);
      }
    }, 0);
  }

  /**
   * 执行实际的白板提炼更新
   */
  public async executeSummarization(
    projectId: string,
    sessionId: string
  ): Promise<void> {
    const lockKey = `${projectId}:${sessionId}`;
    if (this.summarizingSessions.has(lockKey)) {
      // 🌟 锁内排队保护：提炼进行中到达的新消息不丢弃，标记排队以便当前提炼结束后立即追赶
      this.pendingFollowupSessions.add(lockKey);
      return;
    }
    this.summarizingSessions.add(lockKey);

    try {
      const store = ProjectStore.getInstance();
      const session = store.getSession(projectId, sessionId);
      if (!session) return;

      const allMessages = store.getMessages(projectId, sessionId);
      const lastCount = session.scratchpad?.lastSummarizedCount || 0;
      const targetCount = allMessages.length;

      // 🌟 100% 增量无缝分析：从上次提炼终点开始切片，绝不人为丢弃中间消息
      const startIndex = Math.max(0, lastCount);
      // 🌟 纯净创作内容过滤 (SSOT)：基于强类型契约过滤异常与中断占位，彻底杜绝魔数字符串嗅探与误杀
      const messagesToAnalyze = allMessages
        .slice(startIndex)
        .filter((m) => !m.isError && !m.isAborted && !!m.content?.trim())
        .map((m) => ({ role: m.role, content: m.content }));
      if (messagesToAnalyze.length === 0) return;

      const userPrompt = buildScratchpadUpdatePrompt(
        session.scratchpad,
        messagesToAnalyze
      );

      const llm = LLMRegistry.get();
      const updated = await llm.generateObject<Partial<ScratchpadMemory>>(
        userPrompt,
        ScratchpadSummarySchema,
        SCRATCHPAD_SUMMARIZER_SYSTEM_PROMPT,
        {
          stage: 'scratchpad_summary',
          temperature: 0.2,
        }
      );

      if (updated) {
        // 🌟 解决 ABA 竞态覆写：大模型生成耗时数秒后，重新拉取最新 Session，防止覆写推理期间生成的最新权威资产
        const latestSession = store.getSession(projectId, sessionId);
        if (!latestSession) return;
        const currentScratchpad = latestSession.scratchpad || {};

        // 🌟 资产权威防护 (SSOT)：以 ProjectStore 状态黑板中是否已落盘权威阶段产物为唯一法定准绳，彻底消灭字符串猜测
        const projectStore = ProjectStore.getInstance();
        const hasNarrativeArtifact = !!projectStore.getArtifact(projectId, WorkflowStage.NARRATIVE_DESIGN);
        const hasCharacterArtifact = !!projectStore.getArtifact(projectId, WorkflowStage.CHARACTER_DESIGN);

        // 如果状态黑板中已确立故事圣经/角色定妆资产，则白板以此为法定权威，日常粗浅闲聊总结绝不覆写！
        const safeCharactersSummary = (hasCharacterArtifact || hasNarrativeArtifact) && currentScratchpad.charactersSummary
          ? currentScratchpad.charactersSummary
          : updated.charactersSummary || currentScratchpad.charactersSummary || '';

        const safeCharacterVisualAnchors = hasCharacterArtifact && currentScratchpad.characterVisualAnchors
          ? currentScratchpad.characterVisualAnchors
          : updated.characterVisualAnchors || currentScratchpad.characterVisualAnchors || '';

        const safeStorySpine = hasNarrativeArtifact && currentScratchpad.storySpine
          ? currentScratchpad.storySpine
          : updated.storySpine || currentScratchpad.storySpine || '';

        // 🌟 禁忌源头收敛：基于纪要官大模型深度提纯后的全量清单进行格式清理与去重，消除无序拼接与无限膨胀
        let resolvedConstraints = currentScratchpad.userConstraints || [];
        if (Array.isArray(updated.userConstraints) && updated.userConstraints.length > 0) {
          const cleaned = updated.userConstraints
            .map((c) => String(c).trim())
            .filter(Boolean);
          if (cleaned.length > 0) {
            resolvedConstraints = Array.from(new Set(cleaned));
          }
        }

        store.updateScratchpad(projectId, sessionId, {
          themeAndStyle: updated.themeAndStyle || currentScratchpad.themeAndStyle,
          logline: updated.logline || currentScratchpad.logline,
          charactersSummary: safeCharactersSummary,
          characterVisualAnchors: safeCharacterVisualAnchors,
          storySpine: safeStorySpine,
          userConstraints: resolvedConstraints,
          cinematographyAndRhythm: updated.cinematographyAndRhythm || currentScratchpad.cinematographyAndRhythm,
          audioAndVoicePreferences: updated.audioAndVoicePreferences || currentScratchpad.audioAndVoicePreferences,
          packagingAndInteractiveSpec: updated.packagingAndInteractiveSpec || currentScratchpad.packagingAndInteractiveSpec,
          lastSummarizedCount: targetCount,
        });
        console.log(`[ChatMemoryManager] 📋 会话 ${sessionId} 全局备忘录白板已自动更新 (增量 ${messagesToAnalyze.length} 条，进度 ${targetCount})`);
      }
    } finally {
      this.summarizingSessions.delete(lockKey);
      // 🌟 自动追赶排队提炼微任务：提炼期间堆积的新消息立即自动补录
      if (this.pendingFollowupSessions.delete(lockKey)) {
        setTimeout(() => {
          this.executeSummarization(projectId, sessionId).catch((err) => {
            console.warn(`[ChatMemoryManager] 追赶排队提炼备忘录失败:`, err);
          });
        }, 50);
      }
    }
  }

  /**
   * 🌟 权威工序资产反向同步至备忘录白板 (消除白板设定漂移与滞后，覆盖 Stage 1 与 Stage 2 视觉锚点)
   */
  public syncAuthoritativeArtifactsToScratchpad(
    projectId: string,
    sessionId: string,
    artifacts: Record<string, any>
  ): void {
    const store = ProjectStore.getInstance();
    const session = store.getSession(projectId, sessionId);
    if (!session) return;

    const updates: any = {};

    // 1. Stage 1 叙事世界观同步
    const bible = artifacts[WorkflowStage.NARRATIVE_DESIGN]?.bible || artifacts[WorkflowStage.NARRATIVE_DESIGN];
    if (bible) {
      if (bible.title || bible.theme || bible.style) {
        updates.themeAndStyle = `《${bible.title || '未命名'}》 | ${bible.theme || ''} | ${bible.style || ''}`;
      }
      if (bible.logline) {
        updates.logline = bible.logline;
      }
      if (Array.isArray(bible.characters) && bible.characters.length > 0) {
        updates.charactersSummary = bible.characters
          .map((c: any) => `* 【${c.name}】(${c.role || '角色'}): 动机: ${c.motivation || '未详'} | 骨相特征: ${c.appearance || c.appearancePrompt || '未详'}`)
          .join('\n');
      }
      if (Array.isArray(bible.goldenSpine) && bible.goldenSpine.length > 0) {
        updates.storySpine = bible.goldenSpine
          .map((act: any, idx: number) => `第${idx + 1}幕 [${act.name}]: ${act.summary || ''}`)
          .join('\n');
      }
    }

    // 2. 🌟 Stage 2 角色视觉定妆锚点同步 (发型、服装色彩、标志性配饰、定妆就绪状态)
    const charArtifact = artifacts[WorkflowStage.CHARACTER_DESIGN];
    if (charArtifact && Array.isArray(charArtifact.characters) && charArtifact.characters.length > 0) {
      const visualAnchorsList = charArtifact.characters.map((c: any) => {
        const isReady = c.imageUrl || c.selected;
        const status = isReady ? '✓ 定妆已锁定' : '待生成';
        const visualSpec = c.visualPrompt ? ` | 标志性外观: ${c.visualPrompt}` : '';
        const baseAppearance = c.appearance ? ` | 外貌: ${c.appearance}` : '';
        return `* 【${c.name}】(${status})${baseAppearance}${visualSpec}`;
      });
      updates.characterVisualAnchors = visualAnchorsList.join('\n');
    }

    if (Object.keys(updates).length > 0) {
      store.updateScratchpad(projectId, sessionId, updates);
      console.log(`[ChatMemoryManager] 🌟 已将权威工序资产(世界观+视觉定妆锚点)反向同步至会话 ${sessionId} 白板`);
    }
  }
}
