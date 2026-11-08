/**
 * agents/director/modifier/modify-attributes.ts
 * 修改诉求的属性类别枚举（唯一真相）
 *
 * 这个枚举同时被三方消费：规则词表裁决（source-resolver.detectAttribute）、
 * 模型补判（attribute-classifier 的输出 schema）、以及链路上报的 attribute 字段。
 * 历史上它被抄成两份（source-resolver 的 ModifyAttribute、classifier 的
 * CLASSIFIABLE_ATTRIBUTES），加一类要改两处，漏一处就是静默不一致——所以收到这里。
 *
 * 两层的区别：
 * - CLASSIFIABLE_ATTRIBUTES：能被映射到某个源头工序的类别；
 * - 'unknown'：只表示「判不出来」，不是一类属性。它必须存在于枚举里，
 *   因为模型需要有权弃权（见 attribute-classifier 的弃权约定），但它永远不会
 *   出现在一份「已裁决成功」的 ModifyPlan 上。
 */

/** 可落到具体源头工序的属性类别 */
export const CLASSIFIABLE_ATTRIBUTES = [
  'setting',
  'appearance',
  'dialogue',
  'shot',
  'visual',
  'media',
] as const;

export type ClassifiableAttribute = (typeof CLASSIFIABLE_ATTRIBUTES)[number];

/** 裁决结果：要么是某一类，要么判不出来 */
export type ModifyAttribute = ClassifiableAttribute | 'unknown';

/** 模型补判的可选输出：在属性类别之外允许弃权 */
export const CLASSIFIER_OUTPUTS = [...CLASSIFIABLE_ATTRIBUTES, 'unknown'] as const;

/** 中文标签，仅用于日志与说明文案 */
export const ATTRIBUTE_LABELS: Record<ModifyAttribute, string> = {
  setting: '设定事实',
  appearance: '角色外观',
  dialogue: '台词场次',
  shot: '镜头语言',
  visual: '画面呈现',
  media: '媒体资产',
  unknown: '无法归类',
};
