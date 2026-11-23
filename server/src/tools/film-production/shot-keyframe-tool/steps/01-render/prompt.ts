/**
 * tools/film-production/shot-keyframe-tool/steps/01-render/prompt.ts
 * 分镜关键帧生图提示词装配（多图 <imageN> 显式绑定 + 打破三视图立正站姿约束）
 */

import type { CinematicShotOrder } from '../../../../../project-store/contracts/film-production/film-spec.js';
import {
  CINEMATIC_CONTINUITY_LOCK,
} from '../../../shared/cinematography-grammar.js';

export const KEYFRAME_IMAGE_SIZE = '1280*720';

export interface KeyframeReferenceEntry {
  role: 'custom' | 'base_frame' | 'location' | 'character' | 'item' | 'first_frame' | 'preceding_frame';
  url: string;
  name?: string;
  identity?: string;
}

function buildReferenceMappingSection(references: KeyframeReferenceEntry[]): string {
  if (!references.length) return '';

  const lines = references.map((ref, idx) => {
    const tag = `<image${idx + 1}>`;
    switch (ref.role) {
      case 'custom':
        return `- ${tag} 为参考图：参考其画面构图与光影氛围。`;
      case 'base_frame':
        return `- ${tag} 为修改基准图：保留创作者未要求修改的属性；明确要求改变的机位、构图、空间、光照或角色特征以新要求为准。`;
      case 'preceding_frame': {
        const label = ref.name ? `「${ref.name}」` : '前序镜头';
        return `- ${tag} 为${label}画面：继承其光照方向、色彩分级与时空连续性。`;
      }
      case 'location': {
        const label = ref.name ? `「${ref.name}」` : '场景';
        return `- ${tag} 为${label}环境美术母本（仅作为建筑材质与光影调色盘）：仅提取其夯土墙体、石板路、青苔与冷蓝雾气的材质肌理与光色分级，绝严禁机械套用其具体构图与现成摆放！当前镜头中的相机机位、视角高度、地标物体（如石碑、树木、桌椅）的具体空间位置与人物站位，必须 100% 遵照本镜头的文本描述执行，绝不受母本画面固定机位与构图绑架！`;
      }
      case 'character': {
        const label = ref.name ? `「${ref.name}」` : '角色';
        const desc = ref.identity ? `（${ref.identity}）` : '';
        return `- ${tag} 为${label}${desc}定妆基准（若包含三视图或站姿，仅提取单一人脸骨相五官、发型与服装材质特征）：彻底解绑定妆图中的立正站桩与三联画排版，避免复制同一角色的多个视角；入画人物数量与身份以当前镜头台本为准！本镜头的肢体动态、动作行为、视线交互与画面景别构图（特写/中景/全景），必须 100% 遵照本镜头台本执行。`;
      }
      case 'item': {
        const label = ref.name ? `「${ref.name}」` : '道具';
        return `- ${tag} 为${label}道具设定图：仅继承其外形结构与材质纹理，自然置于当前场景环境中，严禁商品展柜式的孤立悬空摆拍。`;
      }
      case 'first_frame':
        return `- ${tag} 为首帧实拍图：保持角色造型与光影连续，演进至尾帧状态。`;
    }
  });

  return `【参考资产映射】\n${lines.join('\n')}`;
}

export function buildShotKeyframePrompt(
  shot: CinematicShotOrder,
  references: KeyframeReferenceEntry[] = [],
  overrideBasePrompt?: string,
  instruction?: string
): string {
  const base = (overrideBasePrompt || shot.firstFramePrompt || `${shot.shotType} ${shot.cameraMovement}`).trim();
  const mappingSection = buildReferenceMappingSection(references);

  const editInstructionSection = instruction?.trim()
    ? `【画面微调要求】\n${instruction.trim()}\n本次明确要求修改的属性优先于旧台本、参考图和连续性默认要求；只保留未指定修改的属性。`
    : '';

  // 核心公理：画面核心叙事与主体动作必须占据 Prompt 黄金前排（Subject & Action First）
  // 杜绝参考图长篇八股文霸占黄金窗口，消灭正向提示词中的否定句
  const sections = [
    base,
    editInstructionSection,
    mappingSection,
    CINEMATIC_CONTINUITY_LOCK,
  ].filter(Boolean);

  return sections.join('\n\n');
}
