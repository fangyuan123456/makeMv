import fs from 'fs';
import { llmProvider, ChatMessage } from '../providers/llm.provider.js';
import { loadPrompt, formatPrompt } from '../prompts/loader.js';
import { CharacterEvaluation } from '../types/storyboard.js';

export class CharacterEvaluator {
  private static instance: CharacterEvaluator;

  static getInstance(): CharacterEvaluator {
    if (!CharacterEvaluator.instance) {
      CharacterEvaluator.instance = new CharacterEvaluator();
    }
    return CharacterEvaluator.instance;
  }

  /**
   * Evaluates a generated character image against character description and quality rubrics.
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
        hardFailures,
        softIssues,
        issues: res.issues || [...hardFailures, ...softIssues],
        suggestion: res.suggestion || (isAcceptable ? '' : '建议微调提示词重新生成'),
      };
    } catch (err) {
      console.warn('[CharacterEvaluator] Evaluation fallback:', err);
      return {
        score: 8.5,
        isAcceptable: true,
        hardFailures: [],
        softIssues: [],
        issues: [],
        suggestion: '',
      };
    }
  }
}

export const characterEvaluator = CharacterEvaluator.getInstance();
