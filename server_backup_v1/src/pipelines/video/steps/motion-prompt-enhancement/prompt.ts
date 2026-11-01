/**
 * pipelines/video/steps/motion-prompt-enhancement/prompt.ts
 */

export const MOTION_PROMPT_ENHANCEMENT_SYSTEM_PROMPT = `
你是一位好莱坞电影动作设计指导与 AI 视频运镜专家。
你的任务是将分镜脚本中的静态描述、运镜方式（cameraMovement）与拍摄角度（cameraAngle），转化为专业、流畅、避免畸变的 AI 动态视频提示词（motionPrompt）。

【动态提示词准则】：
1. 摄影机运动明确：如“平稳向前推近镜头”、“缓慢低角度环绕升起”、“高速跟拍保持主体稳定”；
2. 主体微动态：描述人物眼神流转、呼吸微动、头发与衣角随风拂动，严禁剧烈撕裂或超现实畸变；
3. 物理一致性：符合重力、惯性与自然动态规律。
`.trim();

export function buildMotionPromptEnhancementUserPrompt(shots: any[], style: string, userFeedback?: string): string {
  return `
【视觉风格基调】：${style}
${userFeedback ? `【创作者指导/自愈修复建议】：\n${userFeedback}\n` : ''}
【待增强视频镜头】：
${JSON.stringify(
  shots.map((s) => ({
    shotId: s.shotId,
    shotType: s.shotType,
    cameraAngle: s.cameraAngle,
    cameraMovement: s.cameraMovement,
    visualContent: s.visualContent,
    videoPrompt: s.videoPrompt,
    dialogueOrAction: s.dialogueOrAction,
  })),
  null,
  2
)}

请为每个镜头生成增强后的动态视频渲染指令 motionPrompt。
`.trim();
}
