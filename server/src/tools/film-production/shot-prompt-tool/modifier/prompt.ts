/**
 * tools/film-production/shot-prompt-tool/modifier/prompt.ts
 * 单镜首帧生图词增量微调提示词 (Shot Prompt Modifier Prompt SSOT)
 */

import {
  CINEMATIC_FIVE_LAYER_FRAMEWORK,
  CINEMATIC_TEMPORAL_DYNAMICS_SPEC,
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
- 机位景别与摄影角度：${formatDirective(shot.cameraDirective, '全景/中景')}
- 调色影调：${formatDirective(shot.colorDirective, '沿用项目与场景风格')}
- 动作姿态与视线：${formatDirective(shot.poseDirective, '写实自然')}
- 运镜动向：${formatDirective(shot.motionDirective, '固定机位稳健构图')}
- 运动幅度：${formatDirective(shot.dynamicDirective, '电影级平缓 5/10')}
- 焦点跟踪：${formatDirective(shot.focusDirective, '锁定主体')}

${characters.length > 0 ? `【关联角色设定】：\n${characters.map((c) => `- 角色【${c.name}】: ${c.promptZh || c.appearanceSummary || '沿用定妆设定'}`).join('\n')}\n` : ''}
${locations.length > 0 ? `【关联场景空间蓝图】：\n${locations.map((l) => {
  let desc = `- 场景【${l.name}】: ${l.promptZh || l.atmosphere || '沿用定妆设定'}`;
  if (l.spatialLayout) {
    desc += `\n  * 空间客观蓝图：${l.spatialLayout}`;
  }
  return desc;
}).join('\n')}\n` : ''}

【创作者微调诉求】：
${instruction}

${CINEMATIC_FIVE_LAYER_FRAMEWORK}

${CINEMATIC_TEMPORAL_DYNAMICS_SPEC}

【推演铁律（视听时序一体化增量微调 SSOT）】：
1. 【增量继承，融合重构】：以既有首帧词和视频词为底稿，仅融合创作者诉求调整局部（如光影流向、机位高低角度、肢体交互、运镜动势），严禁全盘推翻已有的优秀视听描写；
2. 【严格明确相机拍摄角度与视点】：首帧画面必须明确写出摄影机构图角度（如平视/低角度微仰/略高微俯/过肩视点）与镜头焦段，绝不留白让渲染器盲猜；
3. 【视线与物理几何高度严密对齐】：人物视线必须与交互目标（如矮石碑、桌面物件等）的实际空间高度对齐；
4. 【严格相对视锥投影 · 绝禁罗盘方位】：空间描写必须 100% 采用以当前摄影机为原点的视锥相对语言（画左、画右、前景、中景核心地标、后景纵深）；⚠️绝对严禁使用任何“东南西北”！
5. 【视频时序优先反切起幅（消灭克隆分身红线）】：微调时先调整视频时序动作流（捕捉临停前两步迈步与停驻），再严格反切其第 0 毫秒瞬间更新首帧生图词，首帧中主体必须处于迈步起点，终点目标前空无一人，从物理上杜绝克隆分身；
6. 【100% 纯正向肯定句】：绝不输出任何否定词；
7. 输出符合 ShotPromptOutputSchema 的 JSON。`;
}
