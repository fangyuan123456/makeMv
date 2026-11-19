/**
 * tools/film-production/shot-keyframe-tool/steps/01-render/prompt.ts
 * 分镜关键帧生图提示词装配（多图 <imageN> 显式绑定 + 打破三视图立正站姿约束）
 */

import type { CinematicShotOrder } from '../../../../../project-store/contracts/film-production/film-spec.js';

export const KEYFRAME_IMAGE_SIZE = '1280*720';

export const KEYFRAME_NEGATIVE_PROMPT =
  '低分辨率，低画质，模糊，三视图，多视角拼贴，人物设定表，分格线，角色正侧背对比，纯灰棚拍背景，白底棚拍，立正站姿，双手垂直贴身，僵硬摆拍，证件照站姿，换脸，五官漂移，服装走样，肢体畸形，手指畸形，多手多脚，画面过饱和，色调漂移，白平衡漂移，曝光不一致，文字，水印，标签，边框，杂乱无章';

export interface KeyframeReferenceEntry {
  role: 'custom' | 'location' | 'character' | 'item' | 'first_frame';
  url: string;
  name?: string;
  identity?: string;
}

const KEYFRAME_CONTINUITY_LOCK =
  '全片统一电影实拍摄影质感，单一完整电影画幅，自然电影人物表演、肢体动态与视线交互，景深与机位透视严格匹配本镜景别；锁定全剧一致的色彩分级、主色调、色温、曝光、白平衡与光照方向，严禁出现多视角分格、人物设定表、纯灰棚拍底色或双手垂立的僵硬立正站姿。';

function buildReferenceMappingSection(references: KeyframeReferenceEntry[]): string {
  if (!references.length) return '';

  const lines = references.map((ref, idx) => {
    const tag = `<image${idx + 1}>`;
    switch (ref.role) {
      case 'custom':
        return `- ${tag} 为创作者指定的构图/风格参考图：优先参考其画面意图与氛围。`;
      case 'location': {
        const label = ref.name ? `「${ref.name}」` : '当前场景';
        return `- ${tag} 是场景${label}的环境母本图：继承其空间结构、建筑材质、光影氛围与主色调，按本镜景别与机位自然取景，不要照搬原图固定视角。`;
      }
      case 'character': {
        const label = ref.name ? `「${ref.name}」` : '出场角色';
        const desc = ref.identity ? `（${ref.identity}）` : '';
        return `- ${tag} 是角色${label}${desc}的三视图定妆设定图：仅严格锁定该角色的脸型、五官、发型发色、肤色、体型与服装配饰材质；彻底打破三视图的多视角拼排与双手垂立正对镜头的立正站姿，去除纯灰棚拍底色，让该角色以单人自然电影表演姿态、符合镜头景别与动作关系融入当前场景。`;
      }
      case 'item': {
        const label = ref.name ? `「${ref.name}」` : '关键道具';
        return `- ${tag} 是道具${label}的特写设定图：仅继承该道具的外形结构、材质与细节特征，按本镜构图与比例自然置于画面中。`;
      }
      case 'first_frame':
        return `- ${tag} 是本镜头的首帧实拍画面：保持同一场景、人物造型、光影与色彩分级连续衔接，按本镜尾帧描述自然演进动作与画面状态。`;
    }
  });

  return `【参考图严格映射与构图解绑规则】\n${lines.join('\n')}`;
}

export function buildShotKeyframePrompt(
  shot: CinematicShotOrder,
  references: KeyframeReferenceEntry[] = [],
  overrideBasePrompt?: string
): string {
  const base = (overrideBasePrompt || shot.firstFramePrompt || `${shot.shotType} ${shot.cameraMovement}`).trim();
  const mappingSection = buildReferenceMappingSection(references);

  const sections = [
    mappingSection,
    `【本镜画面要求】\n${base}，电影级实拍光影质感，构图讲究，细节丰富，专业电影摄影画幅。`,
    `【视觉与电影摄影约束】\n${KEYFRAME_CONTINUITY_LOCK}`,
  ].filter(Boolean);

  return sections.join('\n\n');
}
