/**
 * tools/film-production/shot-motion-prompt-tool/steps/01-motion-prompt/prompt.ts
 * 单镜视频动态与运镜提示词生成 (Shot Motion Prompt SSOT)
 */

import { getSkillsForStage } from '../../../shared/cinematography-grammar.js';

function formatDirective(directive: any, fallback: string): string {
  if (!directive) return fallback;
  const label = directive.label || directive.value || '';
  const detail = directive.instruction || directive.description || '';
  if (label && detail) return `${label}（具体指令：${detail}）`;
  return label || detail || fallback;
}

export function buildShotMotionPromptPrompt(params: {
  shot: {
    shotId: string;
    title: string;
    shotType?: string;
    location?: string;
    sceneSubject: string;
    cameraDirective?: any;
    motionDirective?: any;
    dynamicDirective?: any;
    focusDirective?: any;
    durationSec?: number;
    continuityMode?: string;
  };
  previousShot?: {
    shotId: string;
    title: string;
    sceneSubject?: string;
    videoPrompt?: string;
    isSameScene: boolean;
  };
  clipTitle: string;
  narrativeText?: string;
  instruction?: string;
  characters?: Array<{ characterId?: string; id?: string; name: string }>;
  items?: Array<{ itemId?: string; id?: string; name: string }>;
  storyOverview?: string;
}): string {
  const {
    shot,
    previousShot,
    clipTitle,
    narrativeText,
    instruction,
    characters = [],
    items = [],
    storyOverview,
  } = params;

  const isIdleLoop = /待机|循环|idle|loop|等待抉择/i.test(
    `${shot.title} ${shot.sceneSubject} ${instruction || ''}`
  );
  const totalSec = Math.max(4, Math.min(15, Math.round(shot.durationSec || 8)));

  return `你是一名享誉国际的顶级电影导演与摄影指导（Director & Director of Photography）。
现在请根据分幕剧情、关联定妆资产与本段事件，为演绎片段【${shot.shotId} · ${shot.title}】（总时长 ${totalSec} 秒）推演一份适配 MiniMax H3 全能参考直出（Ref2V）的【段落多机位视频提示词（videoPrompt）】：

${storyOverview ? `【全剧核心基调】：${storyOverview}\n` : ''}
【所属分幕】：${clipTitle}
${narrativeText ? `【兜底剧情参考】：\n${narrativeText}\n` : ''}

【当前演绎片段规格】：
- 所在场景：${shot.location || '沿用分幕主场景'}
- 段落时长：${totalSec} 秒
- 叙事核心事件：${shot.sceneSubject || '自然表演'}
- 空间连续性：${shot.continuityMode === 'detached' ? '独立新起幅（切入新视角/新站位）' : '承接同场景上一段末帧参考，延续站位与光色'}
- 既定运镜基调：${formatDirective(shot.motionDirective, '按剧情节奏自然调度')}
- 既定运动幅度：${formatDirective(shot.dynamicDirective, '电影级平缓 5/10')}
- 既定焦点跟踪：${formatDirective(shot.focusDirective, '锁定主体')}

【出场资产名单（必须严格使用以下法定标准全名，便于前端高亮与参考图对齐）】：
${shot.location ? `- 场景【${shot.location}】\n` : ''}${characters.map((c) => `- 角色【${c.name}】(ID: ${c.characterId || c.id || ''})`).join('\n') || '- 当前出场人物'}
${items.length > 0 ? items.map((it) => `- 道具【${it.name}】(ID: ${it.itemId || it.id || ''})`).join('\n') : ''}

${
  previousShot
    ? `【前序片段落幅上下文（用于动接动与站位接力）】：
- 前序片段：【${previousShot.shotId} · ${previousShot.title}】(${previousShot.isSameScene ? '同场景' : '跨场景'})
${previousShot.sceneSubject ? `- 前序事件：${previousShot.sceneSubject}\n` : ''}${previousShot.videoPrompt ? `- 前序视频提示词落幅参考：\n${previousShot.videoPrompt}\n` : ''}`
    : ''
}
${instruction ? `【创作者动态微调诉求】：\n${instruction}\n` : ''}

${getSkillsForStage('motion', { isIdleLoop })}

【H3 Ref2V 视频提示词输出格式要求（高信噪比，严禁静态画质废话）】：
1. **第一段固定写 \`人物站位：...\`**：用 1~2 句话定死出场人物和关键道具的初始位置、朝向/轴线及主光源方向与光线质感；${previousShot && previousShot.isSameScene && shot.continuityMode !== 'detached' ? '若同场景连续承接前序片段，必须显式衔接前序最后机位的物理站位、视线朝向与动作惯性，避免静止停顿或左右跳轴；' : ''}
2. **随后按时间轴拆分机位段落**（总时长严格相加等于 ${totalSec} 秒；单机位写 1 段，需要正反打/情绪递进/动作特写切镜时拆 2~3 个机位）：
   - 格式示例：
     \`镜头1：0—4秒，4秒（共1机位）\`
     \`[机位A·0—4秒·全景跟拍]：物理动作与关键音效。\`
   - 若同一镜头内需切机位，则写 \`（共2机位）\` 并依次列出 \`[机位A·...]\`、\`[机位B·...]\`（仅标明景别与叙事焦点，如全景/中景/近景/特写/正反打，具体构图与运镜由视频模型按叙事自然演绎）；
   - 有台词时单独另起一行写 \`角色名：（语气）台词内容\`；
3. **高信噪比瘦身铁律**：角色长相、服装、场景陈设与道具外观已由 Ref2V 的 \`<Picture N>\` 定妆图锁定，本段全部篇幅专注描写**站位 + 景别切镜节奏 + 物理动作 + 声音/台词**；
4. 输出符合 ShotMotionPromptOutputSchema 的 JSON。`;
}
