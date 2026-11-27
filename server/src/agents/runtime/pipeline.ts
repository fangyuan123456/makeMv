/**
 * agents/runtime/pipeline.ts
 * 通用底层工序流水线 SOP 规范与推演规则装配引擎 (Pipeline SOP Engine SSOT)
 *
 * 核心架构模式：
 * 1. 声明式工序执行顺序（Declarative Stage Sequence）：
 *    各专职 Agent 仅声明所管辖工序的标准有序列表，0 代码写死计算；
 * 2. 赋予大模型推演灵魂（LLM Autonomous Deduction）：
 *    微内核向大模型输入完整工序顺序、当前事件事实与通用规则，由大模型自主推演下一步工序与参数；
 * 3. 核心通用规则（General Cognitive Rules）：
 *    - 成果自动复盘；
 *    - 紧邻单阶段顺位推演；
 *    - 严禁阶段之外的提议（彻底阻断“复盘”、“自愈”伪卡片与跨阶段越级）；
 *    - 终态自知自然收官。
 */

import type { TaskRecord } from '../../task-engine/types.js';

export interface PipelineStageSpec {
  /** 工序工具唯一标识 (如 film.shot_video, game.prd) */
  tool: string;
  /** 工序规范中文名称 (如 "段落视频直出", "SeedVR2 高清超分") */
  stageName: string;
  /** 工序职责说明与核心产出 (可选) */
  description?: string;
  /** 实体作用域类型 (可选) */
  targetKind?: 'shot' | 'character' | 'location' | 'item' | 'global';
}

/**
 * 格式化实体在中文对话中的统一可读标识
 */
export function formatPipelineEntityLabel(input: Record<string, any>): string {
  const shotId = input.shotId;
  if (shotId) {
    const rawNumber = String(shotId).replace(/^[^-]+-0?/, '').replace(/^shot-0?/, '');
    return `镜${rawNumber.padStart(2, '0')}`;
  }
  if (input.targetId) {
    const name = input.name || input.targetName;
    if (name) return String(name);
    const kindLabel =
      input.targetKind === 'character'
        ? '角色'
        : input.targetKind === 'location'
        ? '场景'
        : input.targetKind === 'item'
        ? '道具'
        : '目标';
    return `${kindLabel} [${input.targetId}]`;
  }
  return '';
}

/**
 * 组装注入给大模型的完整工序执行顺序与通用推演规则（SSOT）
 */
export function renderPipelineSopGuidance(
  stages: PipelineStageSpec[],
  task: TaskRecord,
  title: string
): string {
  const taskInput = (task.input as Record<string, any>) || {};
  const entityLabel = formatPipelineEntityLabel(taskInput);
  const targetPrefix = entityLabel ? `针对【${entityLabel}】的` : '';

  // 1. 格式化工序执行顺序清单
  const stageLines = stages.map((s, idx) => {
    const desc = s.description ? ` —— ${s.description}` : '';
    const isCurrent = s.tool === task.toolName ? ' ◀◀ (刚才已落盘)' : '';
    return `${idx + 1}. **${s.stageName}**（${s.tool}）${desc}${isCurrent}`;
  });

  return `【制片工序完成事实】：
${targetPrefix}工序【${title || task.toolName}】已顺利执行完毕并物理落盘。

【本工序导演标准执行顺序（SOP）】：
${stageLines.join('\n')}

【工序接力与推演要求】：
1. **[成果复盘]**：依据任务完成事件和当前资产记录汇报产物与状态。本轮未提供生成图片或视频，不得声称看过成片或评价实际画面质感、构图、光影、动作质量；提示词中的预期效果只能表述为设计目标，不能当作实际验收结果；
2. **[接力推演]**：对照上述 SOP 顺位，严格遵循置底【意图决策漏斗与状态机】自主推演下一步（自发仅推进紧邻单阶段；若全流程已收敛完工则终态自知，以 chat_only 自然收官）。若调用 propose 提出下一步方案，发言（reply）中必须明确声明“方案卡片已生成，请审阅授权”，严禁用“我建议/是否需要”等商量式反问句推卸卡片事实。`;
}
