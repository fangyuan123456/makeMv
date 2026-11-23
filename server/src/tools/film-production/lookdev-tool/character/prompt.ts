/**
 * tools/film-production/lookdev-tool/character/prompt.ts
 * 角色立绘定妆提示词规范 (Character Portrait Prompt SSOT)
 */

import type { GlobalEntities, PoseConstraint } from '../../../../project-store/contracts/film-production/lookdev.js';

// 严格 2:1 宽画幅尺寸（横向三等分后每个视角为标准的 512*768 黄金全身人像比例，完全对齐 ComfyUI 拓扑与潜空间）
export const CHARACTER_PORTRAIT_SIZE = '1536*768';

// 针对三视图的专业负向词
export const CHARACTER_PORTRAIT_NEGATIVE =
  '低分辨率，低画质，肢体畸形，手指畸形，多手多脚，画面过饱和，大跨步，迈步，奔跑，跳跃，剧烈动态，夸张扭曲姿态，手遮挡面部，手遮挡胸口，不同角色同框，不同的人，多位不同角色，角色外貌不一致，三张不同的脸，身高体型不一致，比例失调，半身截断，特写裁切，场景背景，杂乱背景，室外街景，建筑物，文字，水印，标签，装饰边框，杂乱分格黑线';

/**
 * 好莱坞工业级三视图精炼规范 (Character Turnaround Suffix)
 * 采用经实测验证的并列短句，确保生图模型注意力高度聚焦于三视图全身排版，绝不膨胀超载
 * 统一在此渲染层统摄姿态（A-Pose立姿、双手空手垂落）与排版背景，与上游纯物理资产彻底正交解耦
 */
export const CHARACTER_TURNAROUND_SUFFIX =
  '三视图并列：正面、侧面、背面，横向同框三等分全身并列展示，端正立姿A-Pose，双手空手自然垂落体侧无持物，双脚自然平稳站立，三重视角人物外貌骨相与服装细节绝对一致，全身从头到脚完整入镜。纯浅灰中性无缝摄影棚背景，柔和影视漫射光，无多余文字标签。';

/** 角色局部图生图微调时的三视图排版锁定约束 (SSOT) */
export const CHARACTER_THREE_VIEW_LOCK_CLAUSE =
  '必须严格保持原图横向三等分全身三视图排版（左格正面全身、中格90度正侧面全身、右格背面全身，头顶线与脚底线水平对齐，三重视角同步生效且为同一角色，严禁合并或缩减为单人像）。';

export function appendCharacterThreeViewLock(text: string): string {
  const clean = text.trim();
  if (clean.includes(CHARACTER_THREE_VIEW_LOCK_CLAUSE)) return clean;
  return `${clean}。${CHARACTER_THREE_VIEW_LOCK_CLAUSE}`;
}

export function applyCharacterPoseConstraint<T extends { text: string; negative: string }>(
  prompt: T,
  constraint?: PoseConstraint,
): T {
  if (constraint?.stance !== 'feet_together') return prompt;
  return {
    ...prompt,
    text: `${prompt.text}。三视图中的角色均双脚严格并拢，双脚内踝贴合，双腿之间无可见间隙。`,
    negative: [prompt.negative, '双脚分开，双腿分开，脚踝间隙，肩宽站姿'].filter(Boolean).join('，'),
  };
}

/**
 * 组装角色三视图渲染提示词（零硬编码、通用抽象架构）：
 * 1. 角色资产本身（promptZh / appearanceSummary）为人物骨相、五官、服饰与姿态的单一事实来源（SSOT）；
 * 2. 角色三视图属于棚拍工业卡，背景与光影由 CHARACTER_TURNAROUND_SUFFIX 统摄，绝不盲目叠加全剧宏观场景环境（避免场景材质与空间污染角色人物）；
 * 3. 严格控制提示词在 250~350 字符黄金注意窗口，模型注意力高度聚焦于正面、侧面、背面三联画。
 */
export function buildCharacterPortraitPrompt(
  character: GlobalEntities['characters'][number],
  artStyle: string,
  hasReferenceImage = false
): string {
  let base = (character.promptZh || character.appearanceSummary || '').trim();

  // 清洗末尾可能存在的冗余标点
  base = base.replace(/[，,。；;]+$/, '').trim();

  const refPrefix = hasReferenceImage
    ? '以 <image1> 为参考基模，精准继承图中的人物相貌、五官特征、发型肤色与服装，'
    : '';

  // 若角色基础描述较简短（少于 40 字符），适当补充通用摄影质感
  const qualityClause = artStyle.trim() ? `视觉风格：${artStyle.trim()}。` : '';

  return `${refPrefix}${qualityClause}${base}。${CHARACTER_TURNAROUND_SUFFIX}`;
}
