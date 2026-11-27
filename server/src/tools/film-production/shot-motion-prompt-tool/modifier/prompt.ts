/**
 * tools/film-production/shot-motion-prompt-tool/modifier/prompt.ts
 * 单镜视频动态与运镜微调提示词 (Shot Motion Modifier Prompt SSOT)
 */

import { getSkillsForStage } from '../../shared/cinematography-grammar.js';

export function buildShotMotionModifierPrompt(params: {
  shot: {
    shotId: string;
    title: string;
    videoPrompt?: string;
  };
  instruction?: string;
  customVideoPrompt?: string;
}): string {
  const { shot, instruction, customVideoPrompt } = params;

  return `你是一名国际顶级电影导演与摄影指导。
现在请根据导演的微调诉求，对演绎片段【${shot.shotId} · ${shot.title}】的既有视频多机位提示词（videoPrompt）执行精准定向微调：

【既有视频提示词基底】：
${shot.videoPrompt || '暂无既有视频提示词'}

${instruction ? `【导演微调指令】：\n${instruction}\n` : ''}
${customVideoPrompt ? `【创作者指定提示词雏形】：\n${customVideoPrompt}\n` : ''}

${getSkillsForStage('motion')}

【微调输出准则（适配 H3 Ref2V 段落多机位直出）】：
1. 保留「人物站位：...」与时间戳机位格式（\`[机位A·起—止秒·景别]：动作与音效\`），仅按导演指令精准调整指定机位、景别节奏、动作或台词，具体角度与运镜由视频模型自然演绎；
2. 角色外貌服饰与场景静态质感已由定妆参考图锁定，全部篇幅专注描写站位、景别切镜节奏、物理动作与声音；
3. 输出符合 ShotMotionPromptOutputSchema 的 JSON。`;
}
