import { generateObject } from 'ai';
import { z } from 'zod';
import { LLMProvider } from '../../llm/provider.js';
import { PoseConstraintSchema, type PoseConstraint } from '../../project-store/contracts/film-production/lookdev.js';
import { CHARACTER_THREE_VIEW_LOCK_CLAUSE } from './lookdev-tool/character/prompt.js';

export interface VisualEditPrompt {
  directedPrompt: string;
  negativePrompt: string;
  poseConstraint?: PoseConstraint;
}

export async function compileVisualEditPrompt(input: {
  entityType: string;
  name: string;
  originalDescription: string;
  instruction: string;
}): Promise<VisualEditPrompt> {
  const instruction = input.instruction.trim();
  const isCharacter = input.entityType === 'character';
  const { object } = await generateObject({
      model: LLMProvider.getModel(),
      schema: z.object({
        directedPrompt: z.string().trim().min(1),
        negativePrompt: z.string(),
        poseConstraint: PoseConstraintSchema.optional(),
      }),
      system: `你是一位专业影视视觉设计师。将创作者对已有图片的修改要求编译为图生图提示词。
参考图 <image1> 是唯一视觉基准；创作者要求修改的部分必须以新要求为准，不要继承原描述中与之冲突的特征。
生成可直接用于图生图的正向提示词，先明确修改后的可见结果，再明确保留所有未指定的视觉属性，包括身份、三视图或场景构图、镜头视角、背景灰度与纹理、服装和物体颜色、曝光、白平衡、色温、光照方向、阴影及材质。用户明确要求改变的属性不在保留范围内。局部修改应与周围区域自然衔接。
${isCharacter ? `【角色三视图刚性约束】：${CHARACTER_THREE_VIEW_LOCK_CLAUSE}` : ''}
不要加入新的画风、摄影棚背景、布光、色调、分辨率或质量形容词；不要把原设定中被修改掉的旧特征写回正向提示词。
返回结构化字段 directedPrompt、negativePrompt、poseConstraint。角色要求双脚并拢、脚踝贴合时 poseConstraint 为 {"stance":"feet_together"}；明确要求自然站姿时为 {"stance":"neutral"}；未修改站姿时省略 poseConstraint。正向提示词不得保留与新站姿冲突的旧腿部描述。
负向提示词应针对本次修改所排除的旧特征及意外的背景/色调变化，不要把修改后希望保留的特征列入负向。`,
      prompt: `实体类型：${input.entityType}\n实体名称：${input.name}\n原设定：${input.originalDescription}\n创作者修改要求：${instruction}`,
    });
  if (isCharacter && /双脚并拢|两脚并拢|脚踝贴合|feet together|ankles touching/i.test(instruction)
    && object.poseConstraint?.stance !== 'feet_together') {
    throw new Error('角色姿态编译结果未保留双脚并拢约束');
  }
  return {
    directedPrompt: object.directedPrompt,
    negativePrompt: object.negativePrompt,
    ...(isCharacter && object.poseConstraint ? { poseConstraint: object.poseConstraint } : {}),
  };
}
