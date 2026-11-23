/**
 * client/src/components/studio/canvas/presets/promptDeconstructor.ts
 * 开放视听元数据纯净装配引擎 (Open Visual Assembler SSOT)
 *
 * 核心机制：
 * 1. 契约开放：直接读取开放元数据对象 (VisualDirective)，无任何枚举限制；
 * 2. 正交纯化：提示词框只承载纯剧情叙事主体，彻底剥离并净化机位、调色、姿态等功能组件内容；
 * 3. 严格分流：图片视听元数据 (ImageDirectives) 与 视频运镜元数据 (VideoDirectives) 严格隔离。
 */

import type { VisualDirective } from '../../../../types/index.js';
import type { DirectorDirectives } from '../DirectorDropdownBar.js';

export interface StructuredShotVisuals {
  directives: DirectorDirectives;
  pureSubject: string;
}

export interface VideoDirectives {
  motion?: VisualDirective;
  dynamic?: VisualDirective;
  focus?: VisualDirective;
}

export interface StructuredShotVideo {
  directives: VideoDirectives;
  pureAction: string;
}

/**
 * 纯化镜头叙事主体提示词 (Purify Subject Prompt)
 * 彻底剥离由视听功能组件（机位、调色、姿态等）注入的指令文本与英文残留
 */
export function purifySubjectPrompt(
  rawPrompt: string,
  directives?: DirectorDirectives
): string {
  if (!rawPrompt || !rawPrompt.trim()) return '';

  let cleaned = rawPrompt;

  // 1. 若传入了具体的 directives，首先精确剔除其指令文本
  if (directives) {
    const toRemove = [
      directives.camera?.instruction,
      directives.color?.instruction,
      directives.pose?.instruction,
    ].filter((inst): inst is string => Boolean(inst && inst.trim()));

    for (const inst of toRemove) {
      const trimmed = inst.trim();
      if (!trimmed) continue;
      cleaned = cleaned.split(trimmed).join('');
    }
  }

  // 2. 清洗常见的经典英文机位、姿态、调色等独立英文短语
  const commonDirectivesPatterns = [
    /\blow angle(?: view)?\b/gi,
    /\beye level(?: view)?\b/gi,
    /\bhigh angle(?: view)?\b/gi,
    /\boverhead(?: view)?\b/gi,
    /\bdutch angle(?: view)?\b/gi,
    /\bover the shoulder(?: view)?\b/gi,
    /\bclose[- ]?up(?: shot)?\b/gi,
    /\bextreme close[- ]?up\b/gi,
    /\bmedium shot\b/gi,
    /\bwide shot\b/gi,
    /\bdrone shot\b/gi,
    /\bstanding holding letter\b/gi,
    /\b(?:teal and (?:orange|gray)|bleach bypass|golden hour|cyberpunk neon)[^，,\n。]*/gi,
    /\b[a-zA-Z ]*color grade[^，,\n。]*/gi,
  ];

  for (const pattern of commonDirectivesPatterns) {
    cleaned = cleaned.replace(pattern, '');
  }

  // 3. 规范化标点与空白
  cleaned = cleaned
    .replace(/[，,]\s*[，,]+/g, '，')
    .replace(/[。.]\s*[，,]+/g, '。')
    .replace(/[，,]\s*[。.]+/g, '。')
    .replace(/[。.]\s*[。.]+/g, '。')
    .replace(/^[，,\s。.]+/g, '')
    .replace(/[，,\s]+$/g, '')
    .trim();

  // 若结尾没有标点且非空，补上句号
  if (cleaned && !/[。？！…]$/.test(cleaned)) {
    cleaned += '。';
  }

  return cleaned;
}

/**
 * 纯化视频运镜台本提示词 (Purify Video Action Prompt)
 * 剥离运镜、动力学、焦点等功能组件注入的指令与机械前缀叠拼
 */
export function purifyActionPrompt(
  rawPrompt: string,
  directives?: VideoDirectives
): string {
  if (!rawPrompt || !rawPrompt.trim()) return '';

  let cleaned = rawPrompt.trim();

  // 若存在完全重复的相同指令，保留首个并消除后续冗余
  if (directives) {
    const toDeduplicate = [
      directives.motion?.instruction,
      directives.dynamic?.instruction,
      directives.focus?.instruction,
    ].filter((inst): inst is string => Boolean(inst && inst.trim()));

    for (const inst of toDeduplicate) {
      const trimmed = inst.trim();
      if (!trimmed) continue;
      const firstIdx = cleaned.indexOf(trimmed);
      if (firstIdx !== -1 && cleaned.lastIndexOf(trimmed) !== firstIdx) {
        cleaned = cleaned.slice(0, firstIdx + trimmed.length) + cleaned.slice(firstIdx + trimmed.length).split(trimmed).join('');
      }
    }
  }

  // 清除常见遗留视频运镜英文机械占位短语
  const commonVideoPatterns = [
    /\bcinematic slow dolly in towards subject, smooth camera push-in\b/gi,
    /\bsmooth \d+\/\d+ cinematic motion dynamic, steady movement\b/gi,
    /\bcinematic slow dolly in\b/gi,
    /\bslow zoom in\b/gi,
    /\bcamera push-in\b/gi,
  ];

  for (const pattern of commonVideoPatterns) {
    cleaned = cleaned.replace(pattern, '');
  }

  cleaned = cleaned
    .replace(/[，,]\s*[，,]+/g, '，')
    .replace(/[。.]\s*[，,]+/g, '。')
    .replace(/[，,]\s*[。.]+/g, '。')
    .replace(/^[，,\s。.]+/g, '')
    .replace(/[，,\s]+$/g, '')
    .trim();

  return cleaned;
}

/**
 * 从镜头对象直接提取图片专属开放视听元数据
 */
export function extractStructuredVisuals(shot: {
  cameraDirective?: VisualDirective;
  colorDirective?: VisualDirective;
  poseDirective?: VisualDirective;
  sceneSubject?: string;
  firstFramePrompt?: string;
  prompt?: string;
}): StructuredShotVisuals {
  const directives: DirectorDirectives = {
    camera: shot.cameraDirective || {
      label: '平视标准',
      instruction: '摄影机平视拍摄主体，视场平实自然',
      presetId: 'cam_eye_level',
    },
    color: shot.colorDirective,
    pose: shot.poseDirective,
  };

  const raw = (shot.firstFramePrompt || shot.prompt || shot.sceneSubject || '').trim();
  const pureSubject = purifySubjectPrompt(raw, directives);

  return { directives, pureSubject };
}

/**
 * 从镜头对象直接提取视频专属运镜与动力学元数据
 */
export function extractStructuredVideoDirectives(shot: {
  motionDirective?: VisualDirective;
  dynamicDirective?: VisualDirective;
  focusDirective?: VisualDirective;
  videoPrompt?: string;
  prompt?: string;
}): StructuredShotVideo {
  const directives: VideoDirectives = {
    motion: shot.motionDirective || {
      label: '缓缓推近',
      instruction: 'cinematic slow dolly in towards subject, smooth camera push-in',
      presetId: 'motion_dolly_in',
    },
    dynamic: shot.dynamicDirective || {
      label: '电影级平缓',
      instruction: 'smooth 5/10 cinematic motion dynamic, steady movement',
      presetId: 'dynamic_smooth_5',
    },
    focus: shot.focusDirective,
  };

  const raw = (shot.videoPrompt || shot.prompt || '').trim();
  const pureAction = purifyActionPrompt(raw, directives);

  return { directives, pureAction };
}

/**
 * 基于画面三维空间生图词 + 电影调色指令，干净重构出图 Prompt
 */
export function reconstructShotPrompt(
  pureSubject: string,
  directives: DirectorDirectives,
  userNote?: string
): string {
  const parts: string[] = [];

  // 1. 完整的画面三维空间提示词主体 (包含机位、空间、主体、道具物理坐标与动态)
  if (pureSubject.trim()) {
    parts.push(pureSubject.trim());
  }

  // 2. 摄影机机位指令 (若存在且未包含在主体中)
  if (directives.camera?.instruction) {
    const inst = directives.camera.instruction.trim();
    if (inst && !pureSubject.includes(inst) && !pureSubject.includes(directives.camera.label || '')) {
      parts.push(inst);
    }
  }

  // 3. 电影调色指令 (若存在且未包含在主体中)
  if (directives.color?.instruction) {
    const inst = directives.color.instruction.trim();
    if (inst && !pureSubject.includes(inst) && !pureSubject.includes(directives.color.label || '')) {
      parts.push(inst);
    }
  }

  // 4. 人物姿态指令 (若存在且未包含在主体中)
  if (directives.pose?.instruction) {
    const inst = directives.pose.instruction.trim();
    if (inst && !pureSubject.includes(inst) && !pureSubject.includes(directives.pose.label || '')) {
      parts.push(inst);
    }
  }

  // 5. 创作者补充自定义细节
  if (userNote && userNote.trim()) {
    parts.push(userNote.trim());
  }

  return (
    parts
      .map((p) => p.trim())
      .filter(Boolean)
      .join('，')
  );
}

/**
 * 基于纯净动作主体 + 视频运镜指令，干净重构视频台本 Prompt (高信噪比、严格去重)
 */
export function reconstructVideoPrompt(
  pureAction: string,
  directives: VideoDirectives,
  userNote?: string
): string {
  const trimmedAction = (pureAction || '').trim();
  const parts: string[] = [];

  // 1. 运镜轨迹方式 (Motion)：仅当主体未包含运镜或机位描述时才注入，杜绝前后双重重复
  const motionInst = directives.motion?.instruction?.trim();
  const motionLabel = directives.motion?.label?.trim();
  if (motionInst) {
    const alreadyHasMotion =
      trimmedAction.includes(motionInst) ||
      (motionLabel && trimmedAction.includes(motionLabel)) ||
      /^(摄影机|镜头|固定机位|俯拍|仰拍|推镜|拉镜|摇镜|移镜|跟随|环绕)/.test(trimmedAction);

    if (!alreadyHasMotion) {
      parts.push(motionInst);
    }
  }

  // 2. 核心表演与动作主体 (Action)
  if (trimmedAction) {
    parts.push(trimmedAction);
  }

  // 3. 焦点跟踪 (Focus)：若主体中尚未阐述焦点，适度补充
  const focusInst = directives.focus?.instruction?.trim();
  if (focusInst && !trimmedAction.includes(focusInst) && !trimmedAction.includes('焦点')) {
    parts.push(focusInst);
  }

  // 4. 动力学强度与平稳度 (Dynamic Amplitude)：若主体中尚未包含运动速率说明，适度补充
  const dynamicInst = directives.dynamic?.instruction?.trim();
  if (
    dynamicInst &&
    !trimmedAction.includes(dynamicInst) &&
    !trimmedAction.includes('运动幅度') &&
    !trimmedAction.includes('速率')
  ) {
    parts.push(dynamicInst);
  }

  // 5. 创作者补充自定义运镜指示
  if (userNote && userNote.trim()) {
    parts.push(userNote.trim());
  }

  // 中文视听自然规范连接：以句号规范连接，彻底告别 ", " 机械英式拼接
  return parts
    .map((p) => p.replace(/[，,。.]\s*$/, '').trim())
    .filter(Boolean)
    .join('。')
    .replace(/。{2,}/g, '。');
}
