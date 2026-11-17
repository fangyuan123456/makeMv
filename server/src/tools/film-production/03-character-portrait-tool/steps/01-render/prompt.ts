/**
 * tools/film-production/03-character-portrait-tool/steps/01-render/prompt.ts
 * 角色立绘定妆提示词规范 (Character Portrait Prompt SSOT)
 */

import type { GlobalEntities } from '../../../../../project-store/contracts/film-production/lookdev.js';

// 严格 2:1 宽画幅尺寸（横向三等分后每个视角为标准的 512*768 黄金全身人像比例，完全对齐 ComfyUI 拓扑与潜空间）
export const CHARACTER_PORTRAIT_SIZE = '1536*768';

// 针对三视图的专业负向词
export const CHARACTER_PORTRAIT_NEGATIVE =
  '低分辨率，低画质，肢体畸形，手指畸形，多手多脚，画面过饱和，大跨步，迈步，奔跑，跳跃，剧烈动态，夸张扭曲姿态，手遮挡面部，手遮挡胸口，不同角色同框，不同的人，多位不同角色，角色外貌不一致，三张不同的脸，身高体型不一致，比例失调，半身截断，特写裁切，场景背景，杂乱背景，室外街景，建筑物，文字，水印，标签，装饰边框，杂乱分格黑线';

/**
 * 好莱坞工业级三视图后置插入规范 (Character Turnaround Suffix)
 * 在物理渲染时统一在提示词最末尾后置插入
 */
export const CHARACTER_TURNAROUND_SUFFIX =
  '好莱坞电影概念设计角色设定卡 (Character Turnaround Sheet)，横向同框三等分全身三视图排版，头顶线与脚底线严格水平对齐同一基准线：' +
  '【左格正面全身 (Front View)】角色端正直立正面站姿，头部端正，双眼水平正视镜头前方，双手自然垂放放松，全身完整入镜，展现正面清晰五官与前襟细节；' +
  '【中格正侧面全身 (Side Profile View)】角色90度正侧面站姿，双手自然下垂，展现挺拔侧颜轮廓剪影、侧身衣物版型与体态厚度；' +
  '【右格背面全身 (Back View)】角色完全背对镜头（背面全身无脸），展现发型后脑勺、后颈、后背剪裁线条与背部配饰。' +
  '三重视角中的人物必须为完全相同的同一个人 (Identical Character)，骨相体态、身高比例与服装穿戴细节在三个视角中绝对严格一致。' +
  '纯浅灰色中性无缝摄影棚背景，柔和影视中性漫射光，无杂乱背景透视，全身从头到脚完整入镜无任何截断，无多余文字标签与水印。';

/**
 * 组装角色渲染提示词：角色外貌设定在前，三视图规范在最末尾后置插入
 */
export function buildCharacterPortraitPrompt(
  character: GlobalEntities['characters'][number],
  artStyle: string,
  hasReferenceImage = false
): string {
  const base = character.promptZh || character.appearanceSummary || '';
  const refPrefix = hasReferenceImage
    ? '以 <image1> 为参考基模，精准继承图中的人物相貌、五官特征、发型肤色与气质，'
    : '';

  return `${refPrefix}${base}。${artStyle}。${CHARACTER_TURNAROUND_SUFFIX}`;
}
