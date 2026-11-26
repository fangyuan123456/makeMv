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
    sceneSubject: string;
    firstFramePrompt?: string;
    firstFrameImageUrl?: string;
    cameraDirective?: any;
    motionDirective?: any;
    dynamicDirective?: any;
    focusDirective?: any;
    durationSec?: number;
    dialogue?: string;
  };
  clipTitle: string;
  narrativeText?: string;
  instruction?: string;
  characters?: Array<{ characterId: string; name: string }>;
  storyOverview?: string;
}): string {
  const {
    shot,
    clipTitle,
    narrativeText,
    instruction,
    characters = [],
    storyOverview,
  } = params;

  const isIdleLoop = /待机|循环|idle|loop|等待抉择/i.test(
    `${shot.title} ${shot.sceneSubject} ${instruction || ''}`
  );

  return `你是一名享誉国际的顶级电影导演与摄影指导（Director & Director of Photography）。
现在请根据已经定稿的【首帧起幅状态】与分幕剧情，为当前镜头【${shot.shotId} · ${shot.title}】推演一份具备高度物理可行性与镜头生命力的【专业图生视频动态时序提示词（videoPrompt）】：

${storyOverview ? `【全剧核心基调】：${storyOverview}\n` : ''}
【所属分幕】：${clipTitle}
${narrativeText ? `【分幕剧情脉络】：\n${narrativeText}\n` : ''}

【当前镜头已锁定的首帧起幅状态（以此作为物理第 0 秒严密起点，禁止推翻或冲突）】：
${shot.firstFramePrompt ? `- 首帧画面定格描述：${shot.firstFramePrompt}\n` : '- 首帧已确立镜头空间几何与人物站位\n'}
${shot.firstFrameImageUrl ? `- 首帧视觉参考图：${shot.firstFrameImageUrl}\n` : ''}

【当前镜头既定运镜与动态规格】：
- 镜头景别：${shot.shotType || '未指定（依据首帧起幅判定）'}
- 镜头时长：${shot.durationSec || 4} 秒
- 叙事核心事件：${shot.sceneSubject || '自然表演'}
- 既定运镜动向：${formatDirective(shot.motionDirective, '固定机位稳健构图')}
- 既定运动幅度：${formatDirective(shot.dynamicDirective, '电影级平缓 5/10')}
- 既定焦点跟踪：${formatDirective(shot.focusDirective, '锁定主体')}
${shot.dialogue ? `- 角色台词：${shot.dialogue}\n` : ''}

【出场角色名单（统一使用法定标准全名）】：
${characters.map((c) => `- 角色【${c.name}】(ID: ${c.characterId})`).join('\n') || '当前出场人物'}

${instruction ? `【创作者动态微调诉求】：\n${instruction}\n` : ''}

${getSkillsForStage('motion', { isIdleLoop })}

【视频时序推演输出要求（50~100 字，高信噪比纯动作与运镜指令）】：
1. 直接描述时间线上的物理动作变化与先后顺序（去掉“从起幅定格连贯演进：”等套话前缀；常规单镜保持单机位连贯演进，仅当台本或指令明确要求多机位切换时，按时间段依次写清各机位动作）；
2. 明确具体焦段/景别与简洁运镜（如 50mm 稳定中景推进 / 85mm 手持呼吸跟拍），严禁“电影级平缓阻尼、将视线吸入空间”等抽象修辞；
3. **高信噪比瘦身铁律**：外貌服饰、静态光比与场景陈设已由首帧/参考图锁定，**绝对禁止在视频动态词里重复写“深蓝布褂、冷暖光比 3:1、青砖反光、电影质感、超清细节”等静态画质套话**，把全部字数留给**物理动作变化 + 道具交互 + 声音/台词接续**；
4. 遵循 LOD 景别动能分级（全景看位移与环境流，近景特写才释放微表情与生理微动态）；
5. 输出符合 ShotMotionPromptOutputSchema 的 JSON。`;
}
