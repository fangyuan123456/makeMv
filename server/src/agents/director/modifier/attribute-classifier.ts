/**
 * agents/director/modifier/attribute-classifier.ts
 * 属性类别补判器 (Modify Attribute Classifier)
 *
 * ── 为什么需要它 ──
 * source-resolver 用词表把自然语言映射成属性类别，这是闭集对开集：创作者说
 * 「让她别那么显老」「眼睛弄小点」，词表没收录就落 unknown，然后一路掉到
 * 「按实体所在产物」或「当前工作面」——源头悄悄判错，且没有任何报错。
 *
 * unknown 不等于「没有属性」，只等于「词表没收录」。所以这里补一次枚举选择：
 * 只回答 WHAT（六个类别之一），不参与 WHO、不选工序、不给理由长文。
 *
 * ── 刻意做小 ──
 * - 输出被限成 6 选 1 加一个置信度，约 30 token，比让模型产出整份改法快一个量级；
 * - 超时 4s 即放弃，绝不阻塞修改主流程；
 * - 任何异常（网络、解析、枚举越界、置信度不足）都返回 undefined，由调用方
 *   回落到既有的 WHO / 当前工作面兜底——补判只能加分，不能改坏原有判定。
 */

import { z } from 'zod';
import { LLMRegistry } from '../../../llm/LLMRegistry.js';
import { config } from '../../../utils/config.js';
import type { ModifyAttribute } from './source-resolver.js';

/** 可被判出的属性类别（unknown 不作为模型的输出项——它必须给一个答案） */
export const CLASSIFIABLE_ATTRIBUTES = [
  'setting',
  'appearance',
  'dialogue',
  'shot',
  'visual',
  'media',
] as const;

export interface AttributeClassification {
  attribute: ModifyAttribute;
  /** 0..1，低于阈值视为判不准 */
  confidence: number;
  reason?: string;
}

export type AttributeClassifier = (req: {
  content: string;
  target?: string;
}) => Promise<AttributeClassification | undefined>;

const CLASSIFY_SCHEMA = z.object({
  attribute: z.enum(CLASSIFIABLE_ATTRIBUTES),
  confidence: z.number(),
  reason: z.string().optional(),
});

const SYSTEM_PROMPT = `你是影视制作流程的意图归类器。创作者刚提出一条修改诉求，你只判断他改的是「哪一类信息」，不判断改哪个工序、也不判断改谁。

类别定义（必须六选一）：
- setting：角色或故事的设定事实——年龄、性别、姓名、身份、性格、动机、人物关系、世界观、剧情走向、结局。
- appearance：角色自身的客观外观——发型、发色、服装、妆容、伤疤、纹身、体型、五官、配饰。
- dialogue：台词与场次内容——对白、语气、独白、旁白、某一场戏里发生什么、走位调度。
- shot：镜头语言——景别、运镜、机位、构图、镜头时长、拆分镜。
- visual：这一版画面怎么呈现——光影、色调、质感、画风、景深、清晰度、观感（显得年轻/太老）、剪辑节奏。
- media：直接指名某份媒体资产本身（定妆照、关键帧、成片、这段视频）要重出或说有瑕疵，且没提到具体是哪类属性。

判别要点：
1. 「显得 / 看起来 / 观感」谈的是画面效果，即使提到年龄也要判 visual。
2. 「发型 / 衣服 / 妆容」判 appearance；但「这张图里头发有点糊」谈的是画面，判 visual。
3. 拿不准时，判断这句话改完之后「最先要动的是角色设定、剧本、分镜、还是画面」。
4. confidence 用 0-1：证据明确给 0.8 以上，只能猜给 0.5 以下。`;

/**
 * 补判一次属性类别。任何失败都返回 undefined（调用方回落到规则兜底）。
 */
export async function classifyModifyAttribute(req: {
  content: string;
  target?: string;
  timeoutMs?: number;
}): Promise<AttributeClassification | undefined> {
  const content = (req.content || '').trim();
  if (!content) return undefined;

  const prompt = [
    req.target ? `修改对象：${req.target}` : '修改对象：未指明',
    `创作者原话：${content}`,
  ].join('\n');

  let timer: NodeJS.Timeout | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('属性补判超时')), req.timeoutMs ?? 4000);
    });
    const task = LLMRegistry.get().generateObject<AttributeClassification>(
      prompt,
      CLASSIFY_SCHEMA,
      SYSTEM_PROMPT,
      {
        stage: 'modify_attribute_classify',
        temperature: 0,
        maxTokens: 96,
        timeoutMs: req.timeoutMs ?? 4000,
        projectId: undefined,
      }
    );
    const raw: any = await Promise.race([task, timeout]);

    const attribute = String(raw?.attribute || '').trim() as ModifyAttribute;
    if (!CLASSIFIABLE_ATTRIBUTES.includes(attribute as any)) {
      console.warn(`[Modifier] 属性补判返回了非法类别 [${raw?.attribute}]，回落规则兜底`);
      return undefined;
    }
    const confidence = Number(raw?.confidence);
    return {
      attribute,
      confidence: Number.isFinite(confidence) ? confidence : 0.6,
      reason: typeof raw?.reason === 'string' ? raw.reason.slice(0, 120) : undefined,
    };
  } catch (err: any) {
    console.warn(`[Modifier] 属性补判失败，回落规则兜底: ${err?.message || err}`);
    return undefined;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * 开关：默认开启，但单测与 Mock 环境一律关闭。
 * 单测里要验证补判行为，应通过 resolveModifySource 的 classify 参数显式注入，
 * 既不联网也不依赖 Mock 的兜底文本。
 */
export function isAttributeClassifierEnabled(): boolean {
  const flag = String(process.env.MODIFY_LLM_CLASSIFY || '').toLowerCase();
  if (['0', 'false', 'off', 'no'].includes(flag)) return false;
  if (process.env.NODE_ENV === 'test') return false;
  if (process.env.USE_MOCK_LLM === 'true' || config.mockMode) return false;
  return true;
}
