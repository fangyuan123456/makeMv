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

import { SessionStore } from '../session/SessionStore.js';
import { ProjectStore } from '../../project-store/ProjectStore.js';
import { WorkflowStage } from '../../types/index.js';
import type { ChatSession, ChatMessage, ScratchpadMemory } from '../session/types.js';
import type { MemoryConfig, AssembledContext } from './types.js';
import {
  SCRATCHPAD_SUMMARIZER_SYSTEM_PROMPT,
  buildScratchpadUpdatePrompt,
} from './prompt.js';
import { LLMRegistry } from '../../llm/LLMRegistry.js';

export class ChatMemoryManager {
  private static instance?: ChatMemoryManager;
  private readonly config: MemoryConfig;
  /** 🌟 并发防抖锁：防止连续发消息触发多次重复后台提炼 */
  private summarizingSessions = new Set<string>();

  constructor(customConfig?: Partial<MemoryConfig>) {
    this.config = {
      windowSize: customConfig?.windowSize ?? 6,
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
    if (scratchpad.storySpine) {
      items.push(`* 【黄金核心冲突骨架】：\n${scratchpad.storySpine}`);
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
  ): Array<{ role: 'user' | 'assistant' | 'system' | 'tool'; content: string }> {
    // 过滤掉纯系统消息，只提取真正的交互对话
    const dialogMessages = allMessages.filter((m) => m.role !== 'system');
    const recent = dialogMessages.slice(-windowSize);

    return recent.map((m) => ({
      role: m.role,
      content: m.content,
    }));
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

    const slidingWindowMessages = this.getSlidingWindowMessages(
      existingMessages,
      this.config.windowSize
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
    const store = SessionStore.getInstance();
    const session = store.getSession(projectId, sessionId);
    if (!session) return;

    const allMessages = store.getMessages(projectId, sessionId);
    // 消息太少且未要求强制立即提炼时跳过
    if (!forceImmediate && allMessages.length < this.config.windowSize) return;
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
      return;
    }
    this.summarizingSessions.add(lockKey);

    try {
      const store = SessionStore.getInstance();
      const session = store.getSession(projectId, sessionId);
      if (!session) return;

      const allMessages = store.getMessages(projectId, sessionId);
      // 取最近一段对话来提炼
      const messagesToAnalyze = allMessages.slice(-8).map((m) => ({
        role: m.role,
        content: m.content,
      }));

      const userPrompt = buildScratchpadUpdatePrompt(
        session.scratchpad,
        messagesToAnalyze
      );

      const llm = LLMRegistry.get();
      const schema = {
        type: 'object',
        properties: {
          themeAndStyle: { type: 'string' },
          logline: { type: 'string' },
          charactersSummary: { type: 'string' },
          storySpine: { type: 'string' },
          userConstraints: { type: 'array', items: { type: 'string' } },
        },
      };

      const updated = await llm.generateObject<Partial<ScratchpadMemory>>(
        userPrompt,
        schema,
        SCRATCHPAD_SUMMARIZER_SYSTEM_PROMPT,
        {
          stage: 'scratchpad_summary',
          temperature: 0.2,
        }
      );

      if (updated) {
        // 🌟 资产权威防护 (SSOT)：以 ProjectStore 状态黑板中是否已落盘权威阶段产物为唯一法定准绳，彻底消灭字符串猜测
        const projectStore = ProjectStore.getInstance();
        const hasNarrativeArtifact = !!projectStore.getArtifact(projectId, WorkflowStage.NARRATIVE_DESIGN);
        const hasCharacterArtifact = !!projectStore.getArtifact(projectId, WorkflowStage.CHARACTER_DESIGN);

        // 如果状态黑板中已确立故事圣经/角色定妆资产，则白板以此为法定权威，日常粗浅闲聊总结绝不覆写！
        const safeCharactersSummary = (hasCharacterArtifact || hasNarrativeArtifact) && session.scratchpad.charactersSummary
          ? session.scratchpad.charactersSummary
          : updated.charactersSummary || session.scratchpad.charactersSummary || '';

        const safeStorySpine = hasNarrativeArtifact && session.scratchpad.storySpine
          ? session.scratchpad.storySpine
          : updated.storySpine || session.scratchpad.storySpine || '';

        store.updateScratchpad(projectId, sessionId, {
          themeAndStyle: updated.themeAndStyle || session.scratchpad.themeAndStyle,
          logline: updated.logline || session.scratchpad.logline,
          charactersSummary: safeCharactersSummary,
          storySpine: safeStorySpine,
          userConstraints: Array.isArray(updated.userConstraints) && updated.userConstraints.length > 0
            ? Array.from(new Set([...(session.scratchpad.userConstraints || []), ...updated.userConstraints]))
            : session.scratchpad.userConstraints,
        });
        console.log(`[ChatMemoryManager] 📋 会话 ${sessionId} 全局备忘录白板已自动更新 (基于 ProjectStore SSOT 刚性防护)`);
      }
    } finally {
      this.summarizingSessions.delete(lockKey);
    }
  }
}
