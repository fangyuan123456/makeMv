/** Shared visual continuity constraints for every shot in one project. */
export const VISUAL_CONTINUITY_LOCK =
  '保持全剧视觉连续性：严格沿用角色与场景定妆参考图、构图关系、背景与材质；锁定同一套色彩分级、主色调、色温、曝光、白平衡、光照方向、阴影密度与对比度。不要自行换背景色、改色调、改变光源或重新设计美术风格；只有创作者明确要求改变时才改变对应属性。';

export function withVisualContinuity(prompt: string): string {
  return `${prompt.trim()}\n\n【视觉连续性锁定】${VISUAL_CONTINUITY_LOCK}`;
}
