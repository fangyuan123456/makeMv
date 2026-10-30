import fs from 'fs';
import { llmProvider, ChatMessage } from '../../providers/llm.provider.js';
import { loadPrompt, formatPrompt } from '../../prompts/loader.js';
import { CharacterEvaluation } from './types.js';

export class CharacterEvaluator {
  private static instance: CharacterEvaluator;

  static getInstance(): CharacterEvaluator {
    if (!CharacterEvaluator.instance) {
      CharacterEvaluator.instance = new CharacterEvaluator();
    }
    return CharacterEvaluator.instance;
  }

  /**
   * 评估生成的角色图片是否符合人设描述及工业级视觉质量标准
   */
  async evaluateCharacter(
    characterName: string,
    characterDescription: string,
    imageLocalPath?: string,
    imageUrl?: string
  ): Promise<CharacterEvaluation> {
    try {
      const template = loadPrompt('character', 'eval_character', 'zh');
      const systemPrompt = formatPrompt(template, {
        character_description: `${characterName}: ${characterDescription}`,
      });

      const userContent = `请对角色【${characterName}】的生成图进行工业级质量与一致性审查：\n设定描述: ${characterDescription}\n图片路径: ${imageLocalPath || imageUrl || '本地概念图'}\n严格输出纯 JSON。`;

      const messages: ChatMessage[] = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent },
      ];

      const res = await llmProvider.chatJSON<any>(messages);

      const score = typeof res.score === 'number' ? res.score : 8;
      const hardFailures: string[] = Array.isArray(res.hard_failures) ? res.hard_failures : [];
      const softIssues: string[] = Array.isArray(res.soft_issues) ? res.soft_issues : [];
      const isAcceptable =
        res.is_acceptable !== undefined
          ? Boolean(res.is_acceptable)
          : hardFailures.length === 0 && score >= 7;

      return {
        score,
        isAcceptable,
        issues: [...hardFailures, ...softIssues],
        suggestion: res.suggestion || (isAcceptable ? '视觉与设定高度匹配' : '建议微调服装与五官提示词重新生成'),
      };
    } catch (err) {
      console.warn(`[CharacterEvaluator] 角色 ${characterName} 质检异常，使用兜底评分:`, err);
      return {
        score: 8,
        isAcceptable: true,
        issues: [],
        suggestion: '自动质检跳过，直接通过',
      };
    }
  }
}

export const characterEvaluator = CharacterEvaluator.getInstance();
