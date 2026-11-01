/**
 * pipelines/character/steps/quality-eval/prompt.ts
 * 角色定妆画质与人设契合度质检提示词体系 (Pure Chinese Prompt SSOT)
 */

import type { VisualSpecData } from '../visual-spec/schema.js';
import type { CharacterVersionData } from '../portrait-render/schema.js';

export const QUALITY_EVAL_SYSTEM_PROMPT = `你是一位严谨的电影视觉特效总监 (VFX Supervisor) 与视觉质检质检官。
你的职责是比对角色最初的设定规范（外貌特征、服饰、光影、眼神），评估生成的定妆照版本，给出客观公正的量化评分并选拔出最符合人设的黄金基准版本。

【质检准则】：
1. 严禁给无瑕疵假高分：若提示词包含伤疤、特定发型或标志性服饰，必须核实是否有充分体现；
2. 选拔最优：综合保真度 (fidelityScore) 与真实感 (photorealismScore) 挑选出最优版本推荐。`.trim();

export function buildQualityEvalPrompt(
  spec: VisualSpecData,
  versions: CharacterVersionData[],
): string {
  let prompt = `【目标角色】：${spec.name} (${spec.role})\n`;
  prompt += `【人设标准要求】：\n- 外貌特写: ${spec.facialFeatures}\n- 服饰细节: ${spec.clothingDetails}\n- 摄影布光: ${spec.lighting}\n\n`;
  prompt += `【待质检的定妆版本清单】：\n`;

  for (const v of versions) {
    prompt += `版本 [${v.versionId}]:\n  图片地址: ${v.imageUrl}\n  所用提示词: ${v.promptUsed || '无'}\n`;
  }

  prompt += `\n请客观评分并给出最优版本推荐。`;
  return prompt;
}
