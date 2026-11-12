/**
 * agents/text-game/steps/tech-plan/step.ts
 * 互动文游技术架构规划工序 (techPlanStep) - 基于 Mastra 官方微内核原生 Step
 *
 * 核心设计：
 * 1. 严格 OOP 单一职责：SceneTypes -> StateBlackboard -> SceneLoader -> InteractiveShell；
 * 2. Kahn 拓扑排序校验：刚性确保类依赖 DAG 无环。
 */

import { createStep } from '@mastra/core/workflows';
import { runTaskRecordedStep } from '../../../../workflow-engine/TaskStore.js';
import {
  TechPlanInputSchema,
  TechPlanOutputSchema,
  type TechPlanInput,
  type TechPlanOutput,
  type TechClassSpec,
} from './schema.js';

/**
 * Kahn 算法拓扑排序与有向无环校验器
 */
export function validateAndSortClassDag(classes: TechClassSpec[]): TechClassSpec[] {
  const classMap = new Map<string, TechClassSpec>();
  const inDegree = new Map<string, number>();
  const adjList = new Map<string, string[]>();

  for (const c of classes) {
    classMap.set(c.fileName, c);
    inDegree.set(c.fileName, 0);
    adjList.set(c.fileName, []);
  }

  for (const c of classes) {
    for (const dep of c.dependencies) {
      if (adjList.has(dep)) {
        adjList.get(dep)!.push(c.fileName);
        inDegree.set(c.fileName, (inDegree.get(c.fileName) || 0) + 1);
      }
    }
  }

  const queue: string[] = [];
  for (const [fileName, deg] of inDegree.entries()) {
    if (deg === 0) {
      queue.push(fileName);
    }
  }

  const sorted: TechClassSpec[] = [];
  while (queue.length > 0) {
    const curr = queue.shift()!;
    sorted.push(classMap.get(curr)!);

    for (const neighbor of adjList.get(curr) || []) {
      const newDeg = (inDegree.get(neighbor) || 0) - 1;
      inDegree.set(neighbor, newDeg);
      if (newDeg === 0) {
        queue.push(neighbor);
      }
    }
  }

  if (sorted.length !== classes.length) {
    throw new Error(`[TechPlanStep] 检测到类依赖循环或孤岛引用，无法通过 Kahn 拓扑排序`);
  }

  return sorted;
}

/**
 * 标准互动短剧微内核类规范清单
 */
export function getStandardTechPlan(): TechPlanOutput {
  const classes: TechClassSpec[] = [
    {
      className: 'SceneTypes',
      fileName: 'SceneTypes.ts',
      responsibility: '单一契约源：定义 SingleSceneJson, SceneChoiceItem, SceneDialogueLine, GlobalEntities 纯数据类型',
      dependencies: [],
      methods: [],
    },
    {
      className: 'StateBlackboard',
      fileName: 'StateBlackboard.ts',
      responsibility: '全局玩家状态黑板与时间快照管理器：初始化 initialState、执行 { add, set } 变更、评估条件表达式，并支持负向结局回溯快照恢复',
      dependencies: ['SceneTypes.ts'],
      methods: [
        {
          name: 'getVariable',
          signature: '(key: string, defaultValue?: any): any',
          description: '读取流外状态值',
        },
        {
          name: 'applyStateChange',
          signature: '(change?: PrdStateChange): void',
          description: '应用 PRD { add, set } 状态增减与赋值',
        },
        {
          name: 'evaluateCondition',
          signature: '(condition?: string | null): boolean',
          description: '本地评估有序 wiring 的前置条件表达式',
        },
        {
          name: 'createSnapshot',
          signature: '(sceneFileName: string): void',
          description: '记录当前状态时间快照供回退重选',
        },
        {
          name: 'restoreSnapshot',
          signature: '(sceneFileName: string): boolean',
          description: '回滚到指定场景的历史状态快照',
        },
      ],
    },
    {
      className: 'SceneLoader',
      fileName: 'SceneLoader.ts',
      responsibility: '专属分幕切片加载器：无清单动态加载单一场景 JSON、按顺序匹配 wiring 出边并维护当前幕流转',
      dependencies: ['SceneTypes.ts', 'StateBlackboard.ts'],
      methods: [
        {
          name: 'loadScene',
          signature: '(sceneFileName: string): Promise<SingleSceneJson>',
          description: '动态加载指定场景 JSON 资产并存入内存缓存',
        },
        {
          name: 'matchWiringEdge',
          signature: '(fromId: string, outcomeKey: string, wiring: PrdWiringEdge[]): PrdWiringEdge | null',
          description: '按从上到下顺序匹配首条满足 condition 的连线边',
        },
        {
          name: 'navigateTo',
          signature: '(nextSceneFileName: string, stateChange?: PrdStateChange): Promise<SingleSceneJson>',
          description: '记录快照、应用状态变更并跳转至目标分幕切片',
        },
        {
          name: 'rewindTo',
          signature: '(targetSceneFileName: string): Promise<SingleSceneJson>',
          description: '执行回溯重选并返回目标场景切片',
        },
      ],
    },
    {
      className: 'InteractiveShell',
      fileName: 'InteractiveShell.ts',
      responsibility: '竖屏互动座舱控制器：渲染四层视听骨架 (HUD, 9:16背景, 逐句字幕, 交互区)，拦截玩家操作',
      dependencies: ['SceneTypes.ts', 'SceneLoader.ts', 'StateBlackboard.ts'],
      methods: [
        {
          name: 'mount',
          signature: '(container: HTMLElement, startSceneFileName?: string): Promise<void>',
          description: '挂载座舱 DOM 并启动首幕播放',
        },
        {
          name: 'renderCurrentScene',
          signature: '(scene: SingleSceneJson): void',
          description: '刷新视窗背景图、逐句字幕与分支按钮',
        },
      ],
    },
  ];

  const sortedClasses = validateAndSortClassDag(classes);

  return {
    architectureSummary:
      '基于无清单自驱动指针 (Zero-Manifest Self-Driven DAG) 的纯面向对象微架构，实现独立分幕加载、历史快照回溯与竖屏四层视听渲染。',
    classes: sortedClasses,
  };
}

export const techPlanStep = createStep({
  id: 'tech-plan-step',
  inputSchema: TechPlanInputSchema,
  outputSchema: TechPlanOutputSchema,
  execute: async () => {
    return await runTaskRecordedStep('tech-plan-step', async () => getStandardTechPlan());
  },
});
