/**
 * tools/film-production/shot-prompt-tool/steps/01-prompt/prompt.ts
 * 单镜视听一体化推演提示词 (Shot Audio-Visual Direction-First SSOT)
 */

import {
  CINEMATIC_FIVE_LAYER_FRAMEWORK,
  CINEMATIC_MULTI_CHARACTER_BLOCKING_TEMPLATE,
  CINEMATIC_SHOT_PROMPT_EXECUTION_SPEC,
  getSkillsForStage,
} from '../../../shared/cinematography-grammar.js';

function formatDirective(directive: any, fallback: string): string {
  if (!directive) return fallback;
  const label = directive.label || directive.value || '';
  const detail = directive.instruction || directive.description || '';
  if (label && detail) return `${label}（具体指令：${detail}）`;
  return label || detail || fallback;
}

export function buildShotPromptPrompt(params: {
  shot: {
    shotId: string;
    title: string;
    shotType?: string;
    sceneSubject: string;
    cameraDirective?: any;
    colorDirective?: any;
    poseDirective?: any;
    weatherDirective?: any;
    motionDirective?: any;
    dynamicDirective?: any;
    focusDirective?: any;
    dialogue?: string;
    audioPrompt?: string;
    durationSec?: number;
  };
  clipTitle: string;
  continuityMode?: 'auto' | 'linked' | 'detached';
  narrativeText?: string;
  instruction?: string;
  characters?: Array<{ characterId: string; name: string; promptZh?: string; appearanceSummary?: string }>;
  locations?: Array<{ locationId: string; name: string; promptZh?: string; atmosphere?: string }>;
  items?: Array<{ itemId: string; name: string; promptZh?: string; appearanceSummary?: string }>;
  storyOverview?: string;
  previousShot?: {
    shotId: string;
    title: string;
    shotType?: string;
    cameraDirective?: any;
    sceneSubject?: string;
    firstFramePrompt?: string;
    videoPrompt?: string;
    videoLastFrameUrl?: string;
  };
}): string {
  const {
    shot,
    clipTitle,
    continuityMode = 'auto',
    narrativeText,
    instruction,
    characters = [],
    locations = [],
    items = [],
    storyOverview,
    previousShot,
  } = params;

  const isLinked = continuityMode === 'linked' || (continuityMode === 'auto' && Boolean(previousShot));

  const cameraSpec = [
    shot.shotType ? `台本指定：${shot.shotType}` : '',
    shot.cameraDirective ? `光学指令：${formatDirective(shot.cameraDirective, '')}` : '',
  ]
    .filter(Boolean)
    .join('；') || '中景平视';

  return `你是一名享誉国际的顶级电影导演与摄影指导（Film Director & Director of Photography）。
现在请根据分幕剧情、机位设定与角色外观，对当前单个镜头【${shot.shotId} · ${shot.title}】进行【视听一体化推演（Direction-First）】，同时推演产出首帧静态生图词（firstFramePrompt）与动态运镜表演词（videoPrompt）：

${storyOverview ? `【全剧核心基调】：${storyOverview}\n` : ''}
【所属分幕】：${clipTitle}
${narrativeText ? `【分幕剧情脉络】：\n${narrativeText}\n` : ''}

${previousShot && isLinked ? `【上一镜头接戏基准（Continuous & Motion Anchor · 承接模式）】：
- 连续性状态：【🔗 继承承接前序镜头尾帧】
- 上一镜号：${previousShot.shotId} · ${previousShot.title}
${previousShot.shotType ? `- 上一镜景别与机位：${previousShot.shotType}\n` : ''}${previousShot.cameraDirective ? `- 上一镜光学角度：${formatDirective(previousShot.cameraDirective, '')}\n` : ''}${previousShot.sceneSubject ? `- 上一镜叙事动势：${previousShot.sceneSubject}\n` : ''}
${previousShot.firstFramePrompt ? `- 上一镜首帧画面：${previousShot.firstFramePrompt}\n` : ''}
${previousShot.videoPrompt ? `- 上一镜落幅动态：${previousShot.videoPrompt}\n` : ''}
${previousShot.videoLastFrameUrl ? `- 上一镜视频物理末帧：${previousShot.videoLastFrameUrl}\n` : ''}
⚠️【⭐ @link 承接声明与减法规范】：
当前镜头处于【承接模式】，首帧提示词【机位视点与环境时空】开篇必须包含 \`@link(前序尾帧)\` 声明！
- **环境做减法（保留场景全名）**：前序尾帧已锁定空间结构与冷暖光色，首段直接写“延续前序尾帧的[场景全名]空间与冷暖光色，机位[推近/偏转角度]切至[景别视角]，背景自然虚化”，不再长篇复述门窗、挂饰、桌面等全屋陈设；
- **姿态与位置显式继承**：从上一镜状态直接继承人物核心站位与姿势（如保持蜷坐靠墙或既定站姿、手持道具状态），防止模型站立或人物分身；
- **防同景别撞图红线**：对照上方上一镜景别与机位，严禁连续两镜采用相同景别与相同视角（如连拍两张正前方全景）；若同为全景或同景别，本镜必须大幅度偏转机位（≥45° 侧拍或俯仰反打）或明显推近景别；
- **空间视锥独立换算**：若机位发生偏转，画左、画右结构依据【空间客观蓝图】重新换算。\n` : (continuityMode === 'detached' ? `【独立机位起幅模式 (Detached Mode)】：
本镜头为独立新机位构图，不强制继承上一镜头的构图与尾帧，独立完整描述本镜头的空间机位与光影；必须在首帧提示词中**一字不差**地写出下方【关联资产外观规格】中的场景完整全名，严禁简称、省字或使用别名。\n` : '【首镜定场与动能契约】：本镜为本幕开篇镜头，负责确立空间地理透视、光影氛围与人物出场站位，运镜稳健建立空间张力；必须在首帧提示词中**一字不差**地写出下方【关联资产外观规格】中的场景完整全名，严禁简称、省字或使用别名。\n')}

【当前镜头台本与视听规格】：
- 镜头编号：${shot.shotId}
- 镜头标题：${shot.title}
- 叙事核心：${shot.sceneSubject}
- 镜头时长：${shot.durationSec || 3} 秒
- 既定机位景别与摄影角度（硬约束）：${cameraSpec}
⚠️【机位与景别绝对执行红线】：首帧与视频运镜必须 100% 遵照上方【既定机位景别与摄影角度】执行！若台本明确指定了景别（如中景/特写）或机位朝向（如内侧反打、过肩借景、侧身斜切），严禁受前序镜头的景别或正中轴线惯性牵引而擅自变成全景或回到大门中轴线；中景/特写镜头必须以人物主体为主导，背景与非核心陈设自然虚化或退为借景。
- 既定调色影调：${formatDirective(shot.colorDirective, '沿用项目与场景风格')}
- 既定天气与环境光影硬约束：${formatDirective(shot.weatherDirective, '沿用场景全局环境')}（环境与天气光影首位定调）
- 既定动作姿态与受力（硬约束）：${formatDirective(shot.poseDirective, '写实自然')}
⚠️【动作姿态与肢体绝对执行红线】：首帧与视频运镜必须 100% 遵照上方【既定动作姿态与受力】执行！若台本明确指定为非站姿（如蹲伏、蜷缩、跪地、瘫坐、倒地），首帧必须显式展开为重力接触点与关节折叠（臀部贴地、双膝曲起护胸、重心极低），严禁受参考图站姿先验影响而擅自退化为站立肖像；若指定手持/操作道具，必须明确三点接触（手握部位+道具部位+地面接触），绝不可两手空空！
- 既定运镜动向：${formatDirective(shot.motionDirective, '固定机位稳健构图')}
- 既定运动幅度：${formatDirective(shot.dynamicDirective, '电影级平缓 5/10')}
- 既定焦点跟踪：${formatDirective(shot.focusDirective, '锁定主体')}
${shot.dialogue ? `- 角色台词：${shot.dialogue}\n` : ''}
${shot.audioPrompt ? `- 环境拟音：${shot.audioPrompt}\n` : ''}

【关联资产外观规格】：
${characters.map((c) => `- 角色【${c.name}】: ${c.promptZh || c.appearanceSummary || '沿用定妆设定'}`).join('\n') || '无特定角色设定'}
${locations.map((l: any) => {
  let desc = `- 场景【${l.name}】: ${l.promptZh || l.atmosphere || '沿用定妆设定'}`;
  if (l.spatialLayout) {
    desc += `\n  * 空间客观蓝图：${l.spatialLayout}`;
  }
  return desc;
}).join('\n') || '无特定场景设定'}
${items.map((it) => `- 道具【${it.name}】: ${it.promptZh || it.appearanceSummary || '沿用定妆设定'}`).join('\n') || '无特定道具设定'}

${instruction ? `【创作者视听微调诉求】：\n${instruction}\n` : ''}

${getSkillsForStage('keyframe')}

${CINEMATIC_FIVE_LAYER_FRAMEWORK}

${CINEMATIC_MULTI_CHARACTER_BLOCKING_TEMPLATE}

${CINEMATIC_SHOT_PROMPT_EXECUTION_SPEC}
`;
}
