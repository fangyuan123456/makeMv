/**
 * tools/film-production/shot-video-tool/steps/01-render/prompt.ts
 * 镜头视频动作表演与音效提示词装配 (遵循行业标准与多角色空间锚定语法)
 *
 * 核心设计：
 * 彻底实现图生视频 (I2V) 与文生图 (T2I) 提示词契约正交分离。
 * 首帧参考图为视觉连续性提供参考，不能保证完全锁定外貌、服装、道具与冷暖光照，严禁在 I2V 文本中混入“【视觉连续性锁定】禁止改变”等
 * 负向抑制性文字，确保大模型交叉注意力动能充沛，以电影标准自然物理速率驱动动作与机位。
 */

import type { CinematicShotOrder } from '../../../../../project-store/contracts/film-production/film-spec.js';

/**
 * 影视工业级图生视频（I2V）纯净动词流装配 (High-Dynamics Clean Motion SSOT)
 * 首帧参考图（及尾帧）为视觉连续性提供参考，不能保证完全锁定外貌、服装、道具与冷暖光照。
 * 文本 100% 聚焦于机位与纯净动词链，彻底消灭八股文、元指令与否定句，释放扩散模型最大动能。
 */
export function formatVideoMotionPrompt(rawMotion: string, hasLastFrame = false): string {
  const cleanMotion = (rawMotion || '').trim();
  if (hasLastFrame) {
    return `镜头平稳过渡演进。从首帧姿态连贯演进至尾帧：${cleanMotion}。保持指定风格与动作速率，光影自然流转。`;
  }
  return `以首帧定格为物理起点，动作自然连贯演进：${cleanMotion}。保持指定风格与动作速率，光影与动作自然连贯。`;
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
