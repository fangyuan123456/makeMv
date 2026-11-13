/**
 * agents/text-game/steps/tech-plan/step.ts
 * 互动文游技术架构规划工序 (techPlanStep)
 *
 * 模型读策划案 + 分幕数据后自行规划文件划分与依赖拓扑；本工序只做结构归一：
 * 补必备文件、剔无效依赖、拓扑排序、把入口钉在最后。不再有一套写死的类清单。
 */

import { createStep } from '@mastra/core/workflows';
import { Agent } from '@mastra/core/agent';
import { LLMProvider } from '../../../../llm/index.js';
import { runTaskRecordedStep } from '../../../../workflow-engine/TaskStore.js';
import {
  TechPlanInputSchema,
  TechPlanOutputSchema,
  type TechFileSpec,
  type TechPlanOutput,
} from './schema.js';
import { buildTechPlanSystemPrompt, buildTechPlanUserPrompt } from './prompt.js';
import { generateStructured } from '../../../../utils/llm-diagnostics.js';
import { STAGE, TEXT_GAME_STEP } from '../../../../project-store/artifact-fs.js';

const ENTRY_FILE = 'main.js';
const STYLE_FILE = 'style.css';

export function createTechArchitectAgent(): Agent {
  return new Agent({
    name: 'interactive-runtime-architect-agent',
    instructions: buildTechPlanSystemPrompt(),
    model: LLMProvider.getModel(),
  });
}

/**
 * 拓扑排序（Kahn）：只认规划里真实存在的依赖，环上的回边直接丢弃并告警。
 * 排序结果决定编码工序的推进顺序，也决定最终 bundle 的拼接顺序。
 */
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
    // 有环：把未排序出来的节点按原顺序追加，并记录成因，交由后续工序兜底
    for (const name of names) {
      if (!sortedNames.includes(name)) {
        droppedEdges.push(`环形依赖未能排序: ${name}`);
        sortedNames.push(name);
      }
    }
  }

  const byName = new Map(tsFiles.map((f) => [f.fileName, f]));
  const ordered = sortedNames.map((n) => ({ ...byName.get(n)!, dependencies: deps.get(n) || [] }));

  // 入口必须最后拼接：它要 init 全部模块
  const entryIdx = ordered.findIndex((f) => f.fileName === ENTRY_FILE);
  if (entryIdx >= 0 && entryIdx !== ordered.length - 1) {
    const [entry] = ordered.splice(entryIdx, 1);
    ordered.push(entry);
  }

  return { sorted: [...ordered, ...cssFiles], droppedEdges };
}

/** 模型没给全时的结构兜底：只补文件位置与职责，不写实现 */
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

/** 模型彻底失手时的最小可用规划（保证流程不空转） */
export function buildFallbackTechPlan(): TechPlanOutput {
  return {
    architectureSummary:
      '状态层（StateBlackboard）+ 数据层（SceneLoader）+ 表现层（InteractiveShell）+ 样式（style.css）+ 入口（main.js）的最小分层。',
    files: [
      {
        fileName: 'StateBlackboard.js',
        kind: 'js',
        responsibility: '持有玩家状态、套用 { add, set } 变更、求值前置条件、记录回溯快照',
        dependencies: [],
        symbols: [
          {
            name: 'StateBlackboard',
            kind: 'class',
            purpose: '全局状态黑板',
            methods: [
              { name: 'apply', signature: '(change)', description: '套用状态变更' },
              { name: 'get', signature: '(key)', description: '读取状态值' },
              { name: 'test', signature: '(condition)', description: '求值条件表达式' },
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
            methods: [
              {
                name: 'load',
                signature: '(sceneId)',
                description: '加载并缓存一幕',
              },
            ],
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
            methods: [
              {
                name: 'mount',
                signature: '(host, sceneId)',
                description: '挂载并播放起始幕',
              },
            ],
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
        symbols: [
          { name: 'bootstrap', kind: 'function', purpose: '装配并启动', methods: [] },
        ],
      },
    ],
  };
}

export function normalizeTechPlan(raw: TechPlanOutput): TechPlanOutput {
  if (!raw?.files?.length) return buildFallbackTechPlan();
  const withRequired = ensureRequiredFiles(raw.files);
  const { sorted, droppedEdges } = sortFilesByDependency(withRequired);
  if (droppedEdges.length > 0) {
    console.warn(`[TechPlanStep] 依赖拓扑存在问题：${droppedEdges.join('；')}`);
  }
  return { architectureSummary: raw.architectureSummary || '', files: sorted };
}

export async function executeTechPlanStep(
  input: Parameters<typeof buildTechPlanUserPrompt>[0],
  agent: Agent = createTechArchitectAgent()
): Promise<TechPlanOutput> {
  const object = await generateStructured({
    agent,
    prompt: buildTechPlanUserPrompt(input),
    schema: TechPlanOutputSchema,
    stage: STAGE.textGame,
    step: TEXT_GAME_STEP.techPlan,
    label: '技术方案规划',
  });
  return normalizeTechPlan((object as TechPlanOutput) || buildFallbackTechPlan());
}

export const techPlanStep = createStep({
  id: 'tech-plan-step',
  inputSchema: TechPlanInputSchema,
  outputSchema: TechPlanOutputSchema,
  execute: async ({ context }) => {
    const ctx = context as any;
    const trigger = ctx.triggerData || ctx;
    const prd = trigger.prd;
    const title = trigger.title || '互动短剧';
    const assembly = ctx.steps?.['scene-assembly-step']?.output;
    const renderOut = ctx.steps?.['lookdev-render-step']?.output;
    const extractOut = ctx.steps?.['lookdev-extract-step']?.output;
    const entities = renderOut?.entities || extractOut?.entities;
    const scenes = assembly?.scenes || [];
    const script = assembly?.script;

    return await runTaskRecordedStep(
      'tech-plan-step',
      () =>
        executeTechPlanStep({
          title,
          prd,
          scenes,
          script,
          artStyle: entities?.artStyle || '',
        }),
      {
        verifyCached: (cached) => {
          const files = (cached as TechPlanOutput)?.files;
          return Boolean(files?.length && files.some((f) => f.kind === 'js'));
        },
      }
    );
  },
});
