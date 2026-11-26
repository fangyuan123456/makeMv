/**
 * tools/planner/screenplay-tool/steps/02-screenplay/prompt.ts
 * 步骤二：全景剧本编写专属提示词体系 (Screenplay Step Prompt SSOT)
 */

import type { PremiseOutput } from '../01-premise/schema.js';
import { getSkillPrompt } from '../../../../../skills/index.js';

export function buildScreenplaySystemPrompt(): string {
  return `你是一名享誉国际的顶级互动影游总编剧与视听导演。

你的核心职责是：根据故事大纲与人设，编写一部**兼具电影视听沉浸感、人物对手戏张力与紧凑因果闭环的高密度互动短剧剧本（每幕严格控制在 400~600 字，全剧精炼紧凑）**。

${getSkillPrompt('ai-interactive-screenplay')}

### 【工程契约约束】
- 严格依据大纲既定的场景、人物设定与【互动抉择点】推进，不擅自增删抉择点、生造无关题材角色或篡改大纲设定的走向。`;
}

export function buildFullScriptPrompt(params: {
  premise: PremiseOutput;
  userPrompt?: string;
}): string {
  const { premise, userPrompt } = params;
  const suggestedLength = `${premise.actOutlines.length * 400}-${premise.actOutlines.length * 600}`;

  let branchPointsGuide = '';
  if (Array.isArray(premise.branchPoints) && premise.branchPoints.length > 0) {
    branchPointsGuide = `\n【大纲规划的 ${premise.branchPoints.length} 个互动分支抉择点（严格实现，不新增选择节点，彻底取消合流）】：\n` +
      premise.branchPoints.map((bp) => {
        const choiceAOutcome = bp.choiceA.targetType === 'ENDING'
          ? `走向专有终局【${bp.choiceA.endingTitle || '终局'}】(${bp.choiceA.endingType || 'BE'})`
          : '推进主线剧情进入下一幕';
        const choiceBOutcome = bp.choiceB.targetType === 'ENDING'
          ? `走向专有终局【${bp.choiceB.endingTitle || '终局'}】(${bp.choiceB.endingType || 'BE'})`
          : '推进主线剧情进入下一幕';

        return `* 【互动抉择点 ${bp.pointIndex}】（位于第 ${bp.actNumber} 幕）：\n` +
          `  - 场景情境：${bp.sceneContext}\n` +
          `  - 核心困境：${bp.dilemma}\n` +
          `  - 选项 A：${bp.choiceA.text}（${choiceAOutcome}，手段与代价: ${bp.choiceA.approachAndCost}）\n` +
          `  - 选项 B：${bp.choiceB.text}（${choiceBOutcome}，手段与代价: ${bp.choiceB.approachAndCost}）\n`;
      }).join('\n');
  } else {
    branchPointsGuide = '\n【大纲未规划互动抉择点】：按大纲写作，不为凑数新增选择节点。\n';
  }

  return `【创作者核心诉求（全剧最高戏剧纲领）】：
${userPrompt ? `${userPrompt}\n` : '（按已确立大纲推演）'}
你已确立了以下故事设定与详实分幕大纲：
- 标题：《${premise.title}》
- 题材：${premise.genre}
- 故事梗概：${premise.logline}
${premise.worldSetting ? `- 世界观背景与既定真相：${premise.worldSetting}\n` : ''}- 核心角色：${premise.characters.map((c) => `${c.name}（身份: ${c.role}，外貌特征: ${c.appearance}，核心动机: ${c.motivation}）`).join('、')}
- 分幕故事大纲（正文紧凑推进，剧情饱满，拒绝无意义注水）：
${premise.actOutlines.map((a) => {
  let actText = `  * 第 ${a.actNumber} 幕《${a.title}》：\n` +
    `    - 核心冲突：${a.coreConflict}\n` +
    `    - 剧情展开脉络：${a.plotSummary || '（依据主线冲突推演）'}\n`;
  if (Array.isArray(a.scenes) && a.scenes.length > 0) {
    actText += `    - 场景流转：${a.scenes.join(' ➔ ')}\n`;
  }
  if (a.turningPoint) {
    actText += `    - 幕末转折：${a.turningPoint}\n`;
  }
  if (a.suspense) {
    actText += `    - 悬念核心：${a.suspense}\n`;
  }
  return actText;
}).join('\n')}
${branchPointsGuide}

现在，严格依据上述技能规范与大纲中的 ${premise.branchPoints.length} 个互动抉择点，撰写标准 **Markdown 格式互动影游剧本**：
- 全剧总计约 **${suggestedLength}** 汉字（硬上限不超过 2000 字），每幕严格聚焦 1 个核心主场景；
- 直接输出完整的剧本正文 Markdown，不要使用任何占位符。`;
}
