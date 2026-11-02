/**
 * llm/MockLLMService.ts
 * 离线高保真大模型模拟服务
 */

import { LLMService, LLMOptions } from './LLMService.js';
import { SkillRegistry } from '../skills/SkillRegistry.js';

export class MockLLMService implements LLMService {
  public hasVisionCapability(): boolean {
    return true;
  }

  public async generateTextWithImages(
    prompt: string,
    images: string[],
    systemPrompt?: string,
    options?: LLMOptions
  ): Promise<string> {
    return JSON.stringify({ passed: true, score: 95, issues: [] });
  }

  public async generateMultiTurn(
    systemPrompt: string,
    history: Array<{ role: 'user' | 'assistant'; content: string }>,
    options?: LLMOptions
  ): Promise<string> {
    return JSON.stringify({
      thought: 'Mock execution finished',
      tool: 'finish',
      args: { summary: 'Mock execution completed successfully.' },
    });
  }

  public async generateMultiTurnStream(
    systemPrompt: string,
    history: Array<{ role: 'user' | 'assistant'; content: string }>,
    onToken: (token: string) => Promise<void> | void,
    options?: LLMOptions
  ): Promise<string> {
    const text = '【AI导演】：收到您的创作指示，我已基于当前视听语境完成阶段推敲，请确认如下推进提案。';
    await onToken(text);

    // 🌟 Mock 模拟流式 Tool Calling 回调 (动态委托 SkillRegistry 单一事实来源，零硬编码特判)
    if (options?.onToolCall && options?.tools?.propose_stage_action) {
      const stageName = options?.stage || 'narrative_design';
      const stageSkills = SkillRegistry.getInstance().listForStage(stageName);
      const targetSkill = stageSkills.find((s) => s.category !== 'critic') || stageSkills[0];

      if (targetSkill) {
        await options.onToolCall({
          toolCallId: `mock_tc_${Date.now()}`,
          toolName: 'propose_stage_action',
          args: {
            skill: targetSkill.name,
            label: `推进【${targetSkill.displayName}】(Mock模拟提案)`,
            description: targetSkill.description || '当前处于 Mock 测试模式，模拟抛出阶段推进行动提案卡片。',
            params: { isMock: true },
          },
        });
      }
    }

    return text;
  }

  public async generateText(prompt: string, systemPrompt?: string, options?: LLMOptions): Promise<string> {
    return JSON.stringify({ success: true, message: 'Mock LLM Response' });
  }

  public async generateObject<T>(
    prompt: string,
    schema: any,
    systemPrompt?: string,
    options?: LLMOptions
  ): Promise<T> {
    return {} as T;
  }
}
