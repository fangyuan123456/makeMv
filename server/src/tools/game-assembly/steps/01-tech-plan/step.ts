/**
 * tools/game-assembly/steps/01-tech-plan/step.ts
 * 互动影游技术架构规划工序执行器 (techPlanStep)
 */

import { createStep } from '@mastra/core/workflows';
import { ProjectStore } from '../../../../project-store/ProjectStore.js';
import { Agent } from '@mastra/core/agent';
import { LLMProvider } from '../../../../llm/index.js';
import { generateStructured } from '../../../../utils/llm-diagnostics.js';
import {
  TechPlanStepInputSchema,
  TechPlanStepOutputSchema,
  type TechFileSpec,
  type TechPlanStepInput,
  type TechPlanStepOutput,
} from './schema.js';
import { buildTechPlanSystemPrompt, buildTechPlanUserPrompt } from './prompt.js';
import type { UniversalPrdSpec } from '../../../../project-store/contracts/planner/index.js';
import type { StoryScript, SingleSceneJson } from '../../../../project-store/contracts/game-assembly/index.js';

const ENTRY_FILE = 'main.js';
const STYLE_FILE = 'style.css';

export function sortFilesByDependency(files: TechFileSpec[]): {
  sorted: TechFileSpec[];
  droppedEdges: string[];
} {
  const tsFiles = files.filter((f) => f.kind === 'js');
  const cssFiles = files.filter((f) => f.kind !== 'js');
  const names = new Set(tsFiles.map((f) => f.fileName));

  const deps = new Map<string, string[]>();
  for (const f of tsFiles) {
    const valid = Array.from(new Set(f.dependencies.filter((d) => d !== f.fileName && names.has(d))));
    deps.set(f.fileName, valid);
  }

  const inDegree = new Map<string, number>();
  const dependents = new Map<string, string[]>();
  for (const name of names) {
    inDegree.set(name, 0);
    dependents.set(name, []);
  }
  for (const [name, list] of deps) {
    for (const dep of list) {
      dependents.get(dep)!.push(name);
      inDegree.set(name, (inDegree.get(name) || 0) + 1);
    }
  }

  const queue = Array.from(names).filter((n) => (inDegree.get(n) || 0) === 0);
  const sortedNames: string[] = [];
  while (queue.length > 0) {
    const curr = queue.shift()!;
    sortedNames.push(curr);
    for (const next of dependents.get(curr) || []) {
      const deg = (inDegree.get(next) || 0) - 1;
      inDegree.set(next, deg);
      if (deg === 0) queue.push(next);
    }
  }

  const droppedEdges: string[] = [];
  if (sortedNames.length !== names.size) {
    for (const name of names) {
      if (!sortedNames.includes(name)) {
        droppedEdges.push(`环形依赖未能排序: ${name}`);
        sortedNames.push(name);
      }
    }
  }

  const byName = new Map(tsFiles.map((f) => [f.fileName, f]));
  const ordered = sortedNames.map((n) => ({ ...byName.get(n)!, dependencies: deps.get(n) || [] }));

  const entryIdx = ordered.findIndex((f) => f.fileName === ENTRY_FILE);
  if (entryIdx >= 0 && entryIdx !== ordered.length - 1) {
    const [entry] = ordered.splice(entryIdx, 1);
    ordered.push(entry);
  }

  return { sorted: [...ordered, ...cssFiles], droppedEdges };
}

function ensureRequiredFiles(files: TechFileSpec[]): TechFileSpec[] {
  const result = [...files];
  const tsNames = result.filter((f) => f.kind === 'js').map((f) => f.fileName);

  if (!result.some((f) => f.kind === 'js' && f.fileName === ENTRY_FILE)) {
    result.push({
      fileName: ENTRY_FILE,
      kind: 'js',
      responsibility: '启动入口：初始化状态与加载器，把首幕挂载到 #app 上',
      dependencies: tsNames,
      symbols: [{ name: 'bootstrap', kind: 'function', purpose: '装配并启动整部互动影游', methods: [] }],
    });
  }

  if (!result.some((f) => f.kind === 'css')) {
    result.push({
      fileName: STYLE_FILE,
      kind: 'css',
      responsibility: '全部视觉样式：舞台背景遮罩、字幕层、选项按钮、HUD、结局与过场，纯 CSS/SVG 绘制',
      dependencies: [],
      symbols: [],
    });
  }

  return result;
}

export function buildFallbackTechPlan(): TechPlanStepOutput {
  return {
    architectureSummary:
      '状态层（StateBlackboard）+ 数据层（SceneLoader）+ 表现层（InteractiveShell）+ 样式（style.css）+ 入口（main.js）的最小分层。',
    files: [
      {
        fileName: 'StateBlackboard.js',
        kind: 'js',
        responsibility: '持有玩家状态、套用变更、求值前置条件、记录回溯快照',
        dependencies: [],
        symbols: [
          {
            name: 'StateBlackboard',
            kind: 'class',
            purpose: '全局状态黑板',
            methods: [
              { name: 'apply', signature: '(change)', description: '套用状态变更' },
              { name: 'get', signature: '(key)', description: '读取状态值' },
            ],
          },
        ],
      },
      {
        fileName: 'SceneLoader.js',
        kind: 'js',
        responsibility: '按 sceneId 拉取并缓存 ../scenes/*.json',
        dependencies: [],
        symbols: [
          {
            name: 'SceneLoader',
            kind: 'class',
            purpose: '分幕数据加载与缓存',
            methods: [{ name: 'load', signature: '(sceneId)', description: '加载并缓存一幕' }],
          },
        ],
      },
      {
        fileName: 'InteractiveShell.js',
        kind: 'js',
        responsibility: '渲染舞台、逐段字幕、互动点、选项、结局与过场',
        dependencies: ['StateBlackboard.js', 'SceneLoader.js'],
        symbols: [
          {
            name: 'InteractiveShell',
            kind: 'class',
            purpose: '播放与交互座舱',
            methods: [{ name: 'mount', signature: '(host, sceneId)', description: '挂载并播放起始幕' }],
          },
        ],
      },
      {
        fileName: STYLE_FILE,
        kind: 'css',
        responsibility: '舞台、字幕层、按钮、HUD、结局覆盖层的全部样式，纯 CSS/SVG',
        dependencies: [],
        symbols: [],
      },
      {
        fileName: ENTRY_FILE,
        kind: 'js',
        responsibility: '启动入口：装配状态、加载器、座舱并播放首幕',
        dependencies: ['StateBlackboard.js', 'SceneLoader.js', 'InteractiveShell.js'],
        symbols: [{ name: 'bootstrap', kind: 'function', purpose: '装配并启动', methods: [] }],
      },
    ],
  };
}

export function normalizeTechPlan(raw: TechPlanStepOutput): TechPlanStepOutput {
  if (!raw?.files?.length) return buildFallbackTechPlan();
  const withRequired = ensureRequiredFiles(raw.files);
  const { sorted, droppedEdges } = sortFilesByDependency(withRequired);
  if (droppedEdges.length > 0) {
    console.warn(`[TechPlanStep] 依赖拓扑告警：${droppedEdges.join('；')}`);
  }
  return { architectureSummary: raw.architectureSummary || '', files: sorted };
}

export const techPlanStep = createStep({
  id: 'tech-plan-step',
  description: '根据策划案 PRD 与分幕数据，自主规划前端工程文件划分与依赖拓扑',
  inputSchema: TechPlanStepInputSchema,
  outputSchema: TechPlanStepOutputSchema,
  execute: async ({ context }) => {
    const ctx = context as any;
    const input = (ctx?.triggerData || ctx?.inputData || ctx || {}) as TechPlanStepInput;
    const { projectId } = input;

    const store = ProjectStore.getInstance();
    const effectivePrd: UniversalPrdSpec = input.prd || store.getArtifact(projectId, 'universal_prd');
    if (!effectivePrd) {
      throw new Error(`[TechPlanStep] 项目 [${projectId}] 缺少前序 PRD 策划案，无法规划技术架构`);
    }

    const title = input.title || effectivePrd.gameTitle || '未命名短剧';
    const scenes: SingleSceneJson[] = input.scenes || [];
    const script: StoryScript = input.script || {
      startSceneId: effectivePrd.startNodeId || 'S1',
      initialState: effectivePrd.initialState || {},
      scenes: [],
    };
    const artStyle = input.artStyle || '';

    const agent = new Agent({
      name: 'interactive-runtime-architect-agent',
      instructions: buildTechPlanSystemPrompt(),
      model: LLMProvider.getModel(),
    });

    const userPrompt = buildTechPlanUserPrompt({
      title,
      prd: effectivePrd,
      scenes,
      script,
      artStyle,
    });

    const parsed = await generateStructured({
      agent,
      prompt: userPrompt,
      schema: TechPlanStepOutputSchema,
      stage: 'game-assembly-tool',
      step: 'tech-plan',
      label: '互动影游技术架构方案规划',
    });

    const finalPlan = normalizeTechPlan((parsed as TechPlanStepOutput) || buildFallbackTechPlan());

    if (projectId && finalPlan) {
      store.setArtifact(projectId, 'game_assembly_tech_plan', finalPlan);
    }

    return finalPlan;
  },
});
