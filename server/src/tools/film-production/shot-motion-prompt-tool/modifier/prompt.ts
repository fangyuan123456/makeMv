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
    firstFramePrompt?: string;
  };
  instruction?: string;
  customVideoPrompt?: string;
}): string {
  const { shot, instruction, customVideoPrompt } = params;

  return `你是一名国际顶级电影视效指导与执行导演。
现在请根据导演的微调诉求，对镜头【${shot.shotId} · ${shot.title}】的既有视频时序动作流（videoPrompt）执行精准定向微调：

【既有视频动态基底】：
${shot.videoPrompt || '暂无既有视频动作流'}

【当前镜头首帧起幅定格（不可破坏的物理起点）】：
${shot.firstFramePrompt || '沿用首帧设定'}

${instruction ? `【导演微调指令】：\n${instruction}\n` : ''}
${customVideoPrompt ? `【创作者指定动态雏形】：\n${customVideoPrompt}\n` : ''}

${getSkillsForStage('motion')}

【微调输出准则（50~100 字，高信噪比精简版）】：
1. 直接描述动作变化、简洁运镜与声音接续，去掉“从起幅定格连贯演进：”等套话前缀以及“电影级阻尼、超清细节、冷暖光比”等静态画质与抽象修辞；
2. 遵循景别动能分级法则（全景重位移与环境流，中景重肢体交互，特写重神态与生理微动态），严禁在全景镜头中写呼吸/喉结/眼神等亚像素不可见微动作；
3. 输出符合 ShotMotionPromptOutputSchema 的 JSON。`;
}
