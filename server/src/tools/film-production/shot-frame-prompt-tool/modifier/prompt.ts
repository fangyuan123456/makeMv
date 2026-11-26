/**
 * tools/film-production/shot-prompt-tool/modifier/prompt.ts
 * 单镜首帧生图词增量微调提示词 (Shot Prompt Modifier Prompt SSOT)
 */

import {
  CINEMATIC_MULTI_CHARACTER_BLOCKING_TEMPLATE,
  CINEMATIC_SHOT_PROMPT_MODIFY_SPEC,
  getSkillsForStage,
} from '../../shared/cinematography-grammar.js';

function formatDirective(directive: any, fallback: string): string {
  if (!directive) return fallback;
  const label = directive.label || directive.value || '';
  const detail = directive.instruction || directive.description || '';
  if (label && detail) return `${label}（具体指令：${detail}）`;
  return label || detail || fallback;
}

export function buildShotPromptModifyPrompt(params: {
  shot: {
    shotId: string;
    title: string;
    shotType?: string;
    sceneSubject: string;
    firstFramePrompt?: string;
    videoPrompt?: string;
    cameraDirective?: any;
    colorDirective?: any;
    poseDirective?: any;
    motionDirective?: any;
    dynamicDirective?: any;
    focusDirective?: any;
    dialogue?: string;
    durationSec?: number;
  };
  clipTitle: string;
  instruction: string;
  characters?: Array<{ characterId: string; name: string; promptZh?: string; appearanceSummary?: string }>;
  locations?: Array<{ locationId: string; name: string; promptZh?: string; atmosphere?: string; spatialLayout?: any }>;
}): string {
  const { shot, clipTitle, instruction, characters = [], locations = [] } = params;

  const cameraSpec = [
    shot.shotType ? `台本指定机位景别（第一优先硬约束）：${shot.shotType}` : '',
    shot.cameraDirective ? `光学指令：${formatDirective(shot.cameraDirective, '')}` : '',
  ]
    .filter(Boolean)
    .join('；') || '中景平视';

  return `你是一名享誉国际的顶级电影导演与摄影指导（Film Director & Director of Photography）。
创作者对镜头【${shot.shotId} · ${shot.title}】提出了画面与视听微调指令，请进行【视听一体化增量微调（Direction-First）】，同时优化首帧生图词（firstFramePrompt）与动态运镜词（videoPrompt）：

【所属分幕】：${clipTitle}
【镜头核心叙事】：${shot.sceneSubject}
- 镜头时长：${shot.durationSec || 3} 秒

【既有首帧生图词（基准底稿）】：
${shot.firstFramePrompt || '暂无，请以镜头设定推演'}

【既有视频动态词（基准底稿）】：
${shot.videoPrompt || '暂无，请以镜头设定推演'}

【当前机位与动态规格】：
- 既定机位景别与摄影角度（硬约束）：${cameraSpec}
⚠️【机位与景别绝对执行红线】：首帧与视频运镜必须 100% 遵照上方【既定机位景别与摄影角度】执行！若台本明确指定了景别（如中景/特写）或机位朝向（如内侧反打、过肩借景、侧身斜切），严禁擅自变成全景或正前方中轴线！
- 调色影调：${formatDirective(shot.colorDirective, '沿用项目与场景风格')}
- 既定动作姿态与受力（硬约束）：${formatDirective(shot.poseDirective, '写实自然')}
⚠️【动作姿态与肢体绝对执行红线】：首帧与视频运镜必须 100% 遵照上方【既定动作姿态与受力】执行！若台本明确指定为非站姿（如蹲伏、蜷缩、跪地、瘫坐、倒地），首帧必须显式展开为重力接触点与关节折叠（臀部贴地、双膝曲起护胸、重心极低），严禁擅自退化为站立肖像；若指定手持/操作道具，必须明确三点接触（手握部位+道具部位+地面接触），绝不可两手空空！
- 运镜动向：${formatDirective(shot.motionDirective, '固定机位稳健构图')}
- 运动幅度：${formatDirective(shot.dynamicDirective, '电影级平缓 5/10')}
- 焦点跟踪：${formatDirective(shot.focusDirective, '锁定主体')}

${characters.length > 0 ? `【关联角色设定】：\n${characters.map((c) => `- 角色【${c.name}】: ${c.promptZh || c.appearanceSummary || '沿用定妆设定'}`).join('\n')}\n` : ''}
${locations.length > 0 ? `【关联场景空间蓝图】（⚠️ firstFramePrompt 中涉及场景时，必须一字不差地写出 \`场景【xxx】\` 中的完整标准全名，若旧底稿使用了简称/别名须一并修正）：\n${locations.map((l) => {
  let desc = `- 场景【${l.name}】: ${l.promptZh || l.atmosphere || '沿用定妆设定'}`;
  if (l.spatialLayout) {
    desc += `\n  * 空间客观蓝图：${l.spatialLayout}`;
  }
  return desc;
}).join('\n')}\n` : ''}

【创作者微调诉求】：
${instruction}

${getSkillsForStage('keyframe')}

${CINEMATIC_MULTI_CHARACTER_BLOCKING_TEMPLATE}

${CINEMATIC_SHOT_PROMPT_MODIFY_SPEC}
`;
}
