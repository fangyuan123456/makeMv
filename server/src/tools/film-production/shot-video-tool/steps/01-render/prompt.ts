/**
 * tools/film-production/shot-video-tool/steps/01-render/prompt.ts
 * 镜头视频动作表演与音效提示词装配 (遵循行业标准与多角色空间锚定语法)
 *
 * 核心设计：
 * 全线采用全能多图参考视频生成 (Ref2V) 契约，剥离任何冗余的静态首帧外壳与抑制性文字，
 * 确保大模型交叉注意力动能充沛，以电影标准自然物理速率驱动多机位动作与运镜。
 */

import type { CinematicShotOrder } from '../../../../../project-store/contracts/film-production/film-spec.js';

/**
 * 影视工业级 Ref2V 纯净动词流装配 (High-Dynamics Clean Motion SSOT)
 * 全链路读写纯净自然语言；自动容错剥离任何残留的 @ 符号，释放大模型物理动能。
 */
export function formatVideoMotionPrompt(
  rawMotion: string,
  hasLastFrame = false,
  _entities?: any,
  isRef2V = false
): string {
  let cleanMotion = (rawMotion || '').trim();

  // 1. 容错转译历史遗留的 @首帧 符号为起点动能语义
  cleanMotion = cleanMotion.replace(/[@＠](?:frame_0|first_frame|首帧)/g, '首帧画面定格状态');

  // 2. 剥离任何残留的 @ 符号，保留纯净物理名称（杜绝特殊符号干扰扩散注意力）
  cleanMotion = cleanMotion.replace(/[@＠]([\u4e00-\u9fa5_a-zA-Z0-9]+)/g, '$1').replace(/[@＠]/g, '');

  // 2.5 Ref2V 全能参考直出模式：无静态首帧，直接输出纯净动作与运镜指令，不强加“以首帧定格为起点”外壳
  if (isRef2V) {
    return cleanMotion.endsWith('。') ? cleanMotion : `${cleanMotion}。`;
  }

  // 3. 剥离冗余八股前缀与空洞尾缀，只保留干脆的动作、运镜与声音指令
  cleanMotion = cleanMotion.replace(/^(?:从首帧|以首帧|从起幅|以起幅)[^：:]*[：:]\s*/, '').trim();
  const withPeriod = cleanMotion.endsWith('。') ? cleanMotion : `${cleanMotion}。`;

  if (hasLastFrame) {
    return `平稳过渡至尾帧：${withPeriod}`;
  }
  return withPeriod;
}

export function buildShotCinematographyPrompt(shot: CinematicShotOrder): {
  videoPrompt: string;
  audioPrompt: string;
} {
  const baseMotion =
    shot.videoPrompt || `${shot.cameraMovement || '中速稳健运镜'}, 保持既定风格与主体状态，动作连贯`;
  const hasLast = Boolean(shot.lastFrameImageUrl || (shot as any).lastFrameUrl);
  const videoPrompt = formatVideoMotionPrompt(baseMotion, hasLast);
  const audioPrompt = shot.audioPrompt || shot.ambience || '电影级写实环境声与质感氛围，无多余杂音';
  return { videoPrompt, audioPrompt };
}
