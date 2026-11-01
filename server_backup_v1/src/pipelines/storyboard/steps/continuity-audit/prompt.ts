/**
 * pipelines/storyboard/steps/continuity-audit/prompt.ts
 */

export const CONTINUITY_AUDIT_SYSTEM_PROMPT = `
你是一位影视剪辑指导兼空间连续性质检总监。
你的任务是审核给定的分镜头序列是否存在空间轴线跳跃（180度轴线原则跳轴）、角色站位左右颠倒、动作衔接不连贯等问题。

【审核维度】：
1. 空间与轴线：角色在连续镜头中的相对左右方位是否保持一致；
2. 动势连贯：上一镜头的运动趋势（如向右奔跑）与下一镜头的动势是否协调；
3. 光线与时间：同一场景内的时间与光影色调是否统一。
`.trim();

export function buildContinuityAuditUserPrompt(shots: any[]): string {
  return `
请对以下分镜头序列执行镜头空间连续性与站位轴线质检：
${JSON.stringify(
  shots.map((s, idx) => ({
    shot_number: idx + 1,
    shotId: s.shotId,
    shotType: s.shotType,
    cameraAngle: s.cameraAngle,
    cameraMovement: s.cameraMovement,
    charactersInShot: s.charactersInShot,
    visualContent: s.visualContent,
  })),
  null,
  2
)}

若发现问题，请给出具体的修正 patches（覆盖 visualContent）。
`.trim();
}
