/**
 * tools/film-production/storyboard-breakdown-tool/modifier/prompt.ts
 * 单幕分镜台本微调提示词 (Storyboard Breakdown Modifier Prompt SSOT)
 */

export function buildStoryboardBreakdownModifyPrompt(params: {
  clipId: string;
  existingShots: Array<{ shotId: string; title: string; sceneSubject: string; dialogue?: string }>;
  instruction: string;
  targetShotId?: string;
}): string {
  const { clipId, existingShots, instruction, targetShotId } = params;

  return `你是一名专业电影分镜总监。
创作者对分幕【${clipId}】现有的分镜台本提出了修改指令，请根据指令输出更新后的镜头序列：

【当前分幕已有镜头序列】：
${existingShots.map((s) => `- [${s.shotId}] ${s.title}: ${s.sceneSubject}${s.dialogue ? ` (台词: "${s.dialogue}")` : ''}`).join('\n')}

${targetShotId ? `【聚焦修改目标镜头】：${targetShotId}\n` : ''}
【创作者修改指令】：
${instruction}

【调整规范】：
1. 严格落实创作者指令（如新增镜头、删除镜头、调整某镜的景别、修改台词）；
2. 保持未受影响镜头的 ID 与主干稳定性；
3. 输出符合 StoryboardBreakdownOutputSchema 的 JSON。`;
}
