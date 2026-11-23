/**
 * tools/film-production/shot-prompt-tool/steps/01-prompt/prompt.ts
 * 单镜视听一体化推演提示词 (Shot Audio-Visual Direction-First SSOT)
 */

import {
  CINEMATIC_FIVE_LAYER_FRAMEWORK,
  CINEMATIC_TEMPORAL_DYNAMICS_SPEC,
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
  narrativeText?: string;
  instruction?: string;
  characters?: Array<{ characterId: string; name: string; promptZh?: string; appearanceSummary?: string }>;
  locations?: Array<{ locationId: string; name: string; promptZh?: string; atmosphere?: string }>;
  items?: Array<{ itemId: string; name: string; promptZh?: string; appearanceSummary?: string }>;
  storyOverview?: string;
  previousShot?: {
    shotId: string;
    title: string;
    sceneSubject?: string;
    firstFramePrompt?: string;
    videoPrompt?: string;
  };
}): string {
  const {
    shot,
    clipTitle,
    narrativeText,
    instruction,
    characters = [],
    locations = [],
    items = [],
    storyOverview,
    previousShot,
  } = params;

  return `你是一名享誉国际的顶级电影导演与摄影指导（Film Director & Director of Photography）。
现在请根据分幕剧情、机位设定与角色外观，对当前单个镜头【${shot.shotId} · ${shot.title}】进行【视听一体化推演（Direction-First）】，同时推演产出首帧静态生图词（firstFramePrompt）与动态运镜表演词（videoPrompt）：

${storyOverview ? `【全剧核心基调】：${storyOverview}\n` : ''}
【所属分幕】：${clipTitle}
${narrativeText ? `【分幕剧情脉络】：\n${narrativeText}\n` : ''}

${previousShot ? `【上一镜头接戏基准（Continuous & Motion Anchor）】：
- 上一镜号：${previousShot.shotId} · ${previousShot.title}
${previousShot.sceneSubject ? `- 上一镜叙事动势：${previousShot.sceneSubject}\n` : ''}
${previousShot.firstFramePrompt ? `- 上一镜首帧画面：${previousShot.firstFramePrompt}\n` : ''}
${previousShot.videoPrompt ? `- 上一镜动态运镜：${previousShot.videoPrompt}\n` : ''}
【接戏依据】：上一镜首帧不代表末态，仅承接台本明确的动作结果与已知轴线；未知末态不可推定。运镜节奏与主体动能形成电影剪辑呼应（动接动或合理的呼吸感）。
⚠️【空间视锥独立换算红线（消灭纸板背景）】：上一镜首帧画面仅用于锁定人物伤情、手持道具与光色连续性，**绝对严禁机械照抄上一镜的环境背景描写**！本镜头的相机架设点与拍摄朝向一旦发生偏转，画左、画右、前后景结构必须依据【空间客观蓝图】重新进行三维几何投影换算！\n` : '【首镜定场与动能契约】：本镜为本幕开篇镜头，负责确立空间地理透视、光影氛围与人物出场站位，运镜稳健建立空间张力。\n'}

【当前镜头台本与视听规格】：
- 镜头编号：${shot.shotId}
- 镜头标题：${shot.title}
- 叙事核心：${shot.sceneSubject}
- 镜头时长：${shot.durationSec || 3} 秒
- 既定机位景别与摄影角度：${formatDirective(shot.cameraDirective, '全景/中景')}
- 既定调色影调：${formatDirective(shot.colorDirective, '沿用项目与场景风格')}
- 既定天气与环境光影硬约束：${formatDirective(shot.weatherDirective, '沿用场景全局环境')}
- 既定动作姿态与视线：${formatDirective(shot.poseDirective, '写实自然')}
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

${CINEMATIC_FIVE_LAYER_FRAMEWORK}

${CINEMATIC_TEMPORAL_DYNAMICS_SPEC}

【核心推演原则（视频时序优先，反切起幅首帧 SSOT）】：
1. 【阶段一 · 先行确立全镜视听时序动作流（videoPrompt）】：
   - 描述画面在 3~5 秒内的完整物理动态演进（100~180 字）。
   - 优先规划摄影机运镜动向（如平视缓慢推近）与速度节奏；
   - ⚠️【微位移控制红线】：若包含入场走动，必须捕捉临近终点的最后两步迈步与收步（1~2米短程），主体随后在目标旁站定、神情变化与呼吸，严禁几十米长途跋涉；
   - 描写次级环境流（微风轻拂衣角、枝叶摇曳、薄雾缓慢流转）。
2. 【阶段二 · 严格反切第 0 秒起幅首帧（firstFramePrompt）】：
   - 描述摄影机快门在上述视频动作第 0 毫秒捕获的起幅定格画面（150~220 字）。
   - ⭐【环境与天气光影首位定调（杜绝白昼漂移）】：首帧提示词开篇第一句必须严格依据【既定天气与环境光影硬约束】定下场景时空与光质（例如：“深秋黄昏时分，薄雾低垂笼罩，低角度暗橙色斜阳余晖照射，地表泛着冷色阴影……”），将其置于最高提示词权重，绝不能被人物服饰细节冲淡稀释成大白天白光！
   - ⚠️【动作起点物理切片】：首帧主体必须严格处于视频动作的第一毫秒起点状态！若视频动作是“迈出最后两步走到石碑前”，则首帧中主体必须处于离石碑一步半处正迈步前行（重心在前脚，后脚轻离地），而石碑前必须空无一人（绝不能提前画在终点碑前造成分身）！
   - 必须遵循五层公理：明确写出摄影机角度（平视/微低角度仰拍/俯拍）与焦段透视（如35mm广角）；
   - 人物视线与交互物体的物理高度对齐；
   - 100% 纯正向肯定句，绝不输出任何否定词。
3. 输出符合 ShotPromptOutputSchema 的 JSON。`;
}
