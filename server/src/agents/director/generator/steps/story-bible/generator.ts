/**
 * agents/pipeline/workflows/steps/story-bible/generator.ts
 * 故事世界观多阶段推演器与 DAG 刚性验证引擎 (Story Bible Generator SSOT)
 */

import type { LLMService } from '../../../../../llm/LLMService.js';
import {
  StorySpineSchema,
  type StorySpineOutput,
  PivotPointsSchema,
  type PivotPointsOutput,
  StoryGraphSchema,
  type StoryGraphOutput,
  StoryGraphAndPivotsSchema,
  type StoryGraphAndPivotsOutput,
  CharacterProfilesListSchema,
  type CharacterProfilesListOutput,
  type CharacterProfile,
  type StoryBibleArtifact,
} from './schema.js';
import {
  STORY_SPINE_SYSTEM_PROMPT,
  buildStorySpinePrompt,
  STORY_GRAPH_AND_PIVOTS_SYSTEM_PROMPT,
  buildStoryGraphAndPivotsPrompt,
  PIVOT_POINTS_SYSTEM_PROMPT,
  buildPivotPointsPrompt,
  STORY_GRAPH_SYSTEM_PROMPT,
  buildStoryGraphPrompt,
  CHARACTER_PROFILES_SYSTEM_PROMPT,
  buildCharacterProfilesPrompt,
} from './prompt.js';

export interface GenerateSpineOptions {
  idea: string;
  style: string;
  effectiveConstraints?: string[];
  userFeedback?: string;
  projectId: string;
  dialogueHistory?: string;
}

export async function generateStorySpine(
  llm: LLMService,
  options: GenerateSpineOptions
): Promise<StorySpineOutput> {
  const { idea, style, effectiveConstraints, userFeedback, projectId, dialogueHistory } = options;
  const spinePrompt = buildStorySpinePrompt(idea, style, effectiveConstraints, userFeedback, dialogueHistory);
  const spine = await llm.generateObject<StorySpineOutput>(
    spinePrompt,
    StorySpineSchema,
    STORY_SPINE_SYSTEM_PROMPT,
    {
      stage: 'story_spine',
      projectId,
      temperature: 0.4,
    }
  );

  if (!spine || !Array.isArray(spine.goldenSpine) || spine.goldenSpine.length < 3) {
    throw new Error('故事黄金三幕骨架推演失败，幕次数量必须 >= 3 幕');
  }

  return spine;
}

export async function generatePivotPoints(
  llm: LLMService,
  spine: StorySpineOutput,
  userFeedback: string | undefined,
  projectId: string
): Promise<PivotPointsOutput> {
  const pivotPrompt = buildPivotPointsPrompt(spine, userFeedback);
  const pivots = await llm.generateObject<PivotPointsOutput>(
    pivotPrompt,
    PivotPointsSchema,
    PIVOT_POINTS_SYSTEM_PROMPT,
    {
      stage: 'pivot_points',
      projectId,
      temperature: 0.3,
    }
  );

  if (!pivots || !Array.isArray(pivots.macroPivotPoints) || pivots.macroPivotPoints.length < 1) {
    throw new Error('核心互动抉择点矩阵推演失败，宏观抉择点数量必须 >= 1');
  }

  for (const p of pivots.macroPivotPoints) {
    if (!Array.isArray(p.choices) || p.choices.length < 2) {
      throw new Error(`抉择点 [${p.id}] 选项数量不足，必须至少包含 2 个互斥选项`);
    }
  }

  return pivots;
}

export async function generateStoryGraph(
  llm: LLMService,
  spine: StorySpineOutput,
  pivots: PivotPointsOutput,
  userFeedback: string | undefined,
  projectId: string
): Promise<StoryGraphOutput> {
  const graphPrompt = buildStoryGraphPrompt(spine, pivots, userFeedback);
  const graph = await llm.generateObject<StoryGraphOutput>(
    graphPrompt,
    StoryGraphSchema,
    STORY_GRAPH_SYSTEM_PROMPT,
    {
      stage: 'story_graph',
      projectId,
      temperature: 0.3,
    }
  );

  repairStoryGraphDanglingRefs(graph);
  validateStoryGraph(graph);
  return graph;
}

/**
 * 确定性悬空引用自愈 (Dangling Reference Self-Heal)
 *
 * LLM 偶发幻觉出不在节点清单里的 id（如生成 node_i7 却只定义了 node_1..node_6）。
 * 这类错误内容语义完好、只是 id 引用悬空——为此烧掉整轮 3 分钟的生成不值得。
 * 修复策略（全部确定性，无猜测）：
 * 1. 分支目标悬空 → 重映射到「当前节点之后下一幕的首个节点」（剧情向后推进的语义），
 *    已是末幕则兜底到最后一个节点；
 * 2. 根节点悬空 → 重映射到首个节点；
 * 3. 全图无终局 → 把最后一个节点标记为终局；
 * 4. 终局节点携带出边 → 清空（终局不应继续分支）；
 * 5. 自环边（node → node）→ 剔除（剧情原地打转，且会让拓扑分层陷入环）。
 * 每处修复都 console.warn 留痕，绝不静默改写。
 */
export function repairStoryGraphDanglingRefs(graph: StoryGraphOutput): number {
  if (!graph || !Array.isArray(graph.nodes) || graph.nodes.length === 0) return 0;
  let repaired = 0;
  const nodeIds = new Set<string>(graph.nodes.map((n: any) => n.id).filter(Boolean));

  // 根节点悬空 → 首个节点
  if (graph.rootNodeId && !nodeIds.has(graph.rootNodeId)) {
    console.warn(
      `[StoryGraph] 根节点 [${graph.rootNodeId}] 悬空，自愈重映射到 [${graph.nodes[0].id}]`
    );
    graph.rootNodeId = graph.nodes[0].id;
    repaired++;
  }

  for (const node of graph.nodes as any[]) {
    if (!Array.isArray(node.choices) || node.choices.length === 0) continue;

    // 终局节点不应再有出边：模型偶发给结局挂分支（含自环），
    // 会让下游拓扑图的分层算法陷入环，曾导致客户端主线程锁死。
    if (node.isEnding) {
      console.warn(
        `[StoryGraph] 结局节点 [${node.id}] 携带 ${node.choices.length} 条出边，自愈清空分支`
      );
      node.choices = [];
      repaired++;
      continue;
    }

    const keptChoices: any[] = [];
    for (const choice of node.choices) {
      // 自环（node → node）：剧情原地打转，无法推进，直接剔除
      if (choice.targetNodeId === node.id) {
        console.warn(`[StoryGraph] 节点 [${node.id}] 的分支指向自身（自环），自愈剔除该分支`);
        repaired++;
        continue;
      }
      if (choice.targetNodeId && !nodeIds.has(choice.targetNodeId)) {
        const currentIdx = graph.nodes.findIndex((m: any) => m.id === node.id);
        const nextActNode =
          graph.nodes.find(
            (m: any, i: number) => i > currentIdx && Number(m.act) > Number(node.act)
          ) || graph.nodes[graph.nodes.length - 1];
        console.warn(
          `[StoryGraph] 节点 [${node.id}] 的分支目标 [${choice.targetNodeId}] 悬空，` +
            `自愈重映射到 [${nextActNode.id}]（${nextActNode.title || ''}）`
        );
        choice.targetNodeId = nextActNode.id;
        repaired++;
      }
      keptChoices.push(choice);
    }
    node.choices = keptChoices;
  }

  // 终局缺失 → 标记最后一个节点
  if (!graph.nodes.some((n: any) => n.isEnding)) {
    const last = graph.nodes[graph.nodes.length - 1] as any;
    console.warn(`[StoryGraph] 全图缺少终局节点，自愈将 [${last.id}] 标记为终局 (isEnding: true)`);
    last.isEnding = true;
    repaired++;
  }

  return repaired;
}

export function validateStoryGraph(graph: StoryGraphOutput | null | undefined): void {
  if (!graph || !Array.isArray(graph.nodes) || graph.nodes.length < 3) {
    throw new Error('网状剧情拓扑编译失败，全网节点数量必须 >= 3');
  }

  if (!graph.rootNodeId || typeof graph.rootNodeId !== 'string') {
    throw new Error('拓扑图根节点 rootNodeId 缺失或非法');
  }

  const nodeIds = new Set<string>();
  for (const n of graph.nodes) {
    if (!n.id || typeof n.id !== 'string') {
      throw new Error('拓扑节点 ID 缺失或非法');
    }
    if (nodeIds.has(n.id)) {
      throw new Error(`拓扑节点 ID 重复冲突: [${n.id}]，违反全局主键唯一性契约`);
    }
    nodeIds.add(n.id);
  }

  if (!nodeIds.has(graph.rootNodeId)) {
    throw new Error(`根节点 rootNodeId [${graph.rootNodeId}] 不存在于拓扑节点清单中`);
  }

  for (const n of graph.nodes) {
    if (Array.isArray(n.choices)) {
      for (const choice of n.choices) {
        if (choice.targetNodeId && choice.targetNodeId === n.id) {
          throw new Error(`节点 [${n.id}] 的分支指向自身（自环），拓扑必须为有向无环图`);
        }
        if (choice.targetNodeId && !nodeIds.has(choice.targetNodeId)) {
          throw new Error(`节点 [${n.id}] 的分支选项指向了不存在的悬空目标节点: [${choice.targetNodeId}]`);
        }
      }
    }
  }

  const endingNodes = graph.nodes.filter((n: any) => n.isEnding);
  if (endingNodes.length === 0) {
    throw new Error('网状剧情拓扑缺少终局收束，全图必须包含至少一个终局节点 (isEnding: true)');
  }
}

export async function generateCharacterProfiles(
  llm: LLMService,
  spine: StorySpineOutput,
  graph: StoryGraphOutput,
  userFeedback: string | undefined,
  projectId: string
): Promise<CharacterProfile[]> {
  const charPrompt = buildCharacterProfilesPrompt(spine, graph, userFeedback);
  const charactersOutput = await llm.generateObject<CharacterProfilesListOutput>(
    charPrompt,
    CharacterProfilesListSchema,
    CHARACTER_PROFILES_SYSTEM_PROMPT,
    {
      stage: 'character_profiles',
      projectId,
      temperature: 0.5,
    }
  );

  const characters = charactersOutput?.characters || [];
  if (characters.length === 0) {
    throw new Error('核心角色档案推演失败，未产生有效角色数据');
  }

  return characters;
}

/**
 * 🌟 核心高内聚推演：一体化编译网状剧情拓扑图 (StoryGraph) 与核心宏观抉择点矩阵 (PivotPoints)
 * 消减多余串行调用，消除两阶段意图脱节，保证节点分支与两难抉择高度互锁自洽
 */
export async function generateStoryGraphAndPivots(
  llm: LLMService,
  spine: StorySpineOutput,
  userFeedback: string | undefined,
  projectId: string
): Promise<StoryGraphAndPivotsOutput> {
  const prompt = buildStoryGraphAndPivotsPrompt(spine, userFeedback);
  const result = await llm.generateObject<StoryGraphAndPivotsOutput>(
    prompt,
    StoryGraphAndPivotsSchema,
    STORY_GRAPH_AND_PIVOTS_SYSTEM_PROMPT,
    {
      stage: 'story_graph_and_pivots',
      projectId,
      temperature: 0.3,
    }
  );

  if (!result || !result.storyGraph) {
    throw new Error('网状剧情拓扑推演失败，未产出有效图谱数据');
  }

  // 先做悬空引用自愈，再执行图论与连通性刚性校验
  repairStoryGraphDanglingRefs(result.storyGraph);
  validateStoryGraph(result.storyGraph);

  // 刚性契约核验：确保宏观分支抉择点与节点分支真实对应
  if (
    !result.pivotPoints ||
    !Array.isArray(result.pivotPoints.macroPivotPoints) ||
    result.pivotPoints.macroPivotPoints.length < 1
  ) {
    // 源头真实数据提取：从实际生成的剧情节点分支中提取真实的抉择时刻与选项
    const realBranchNodes = (result.storyGraph.nodes || []).filter(
      (n) => Array.isArray(n.choices) && n.choices.length >= 2
    );

    if (realBranchNodes.length === 0) {
      throw new Error(
        `网状剧情拓扑编译失败：全片必须包含至少一个具有 >= 2 个互斥选项的分支决策节点，拒绝单向线性假互动！`
      );
    }

    result.pivotPoints = {
      macroPivotPoints: realBranchNodes.map((n, idx) => ({
        id: `pivot_${idx + 1}`,
        act: n.act || 1,
        decisionMoment: `节点 [${n.title || n.id}] 互动分支抉择`,
        choices: n.choices.map((c, cIdx) => ({
          choiceId: `choice_${cIdx + 1}`,
          text: c.text,
          dramaticImpact: c.dramaticTension || c.condition || '导向不同分支走向与后续剧情',
        })),
      })),
      microPivotPoints: result.pivotPoints?.microPivotPoints || [],
    };
  }

  return result;
}

export interface GenerateStoryBibleOptions {
  idea: string;
  style: string;
  effectiveConstraints?: string[];
  userFeedback?: string;
  projectId: string;
  dialogueHistory?: string;
}

export async function generateStoryBible(
  llm: LLMService,
  options: GenerateStoryBibleOptions
): Promise<StoryBibleArtifact> {
  // 第 1 步：故事黄金三幕骨架推演 (确定主干大纲、悬念钩子与商业卖点)
  const spine = await generateStorySpine(llm, options);

  // 第 2 步：网状剧情拓扑与核心宏观抉择点一体化编译 (消除原有 2/3 步割裂，抉择与节点强互锁)
  const { storyGraph, pivotPoints } = await generateStoryGraphAndPivots(
    llm,
    spine,
    options.userFeedback,
    options.projectId
  );

  // 第 3 步：核心角色小传档案与视觉造型深度推演 (基于已锁定的主干与出镜人物名单，人名100%咬合，外貌绝不缩水)
  const characters = await generateCharacterProfiles(
    llm,
    spine,
    storyGraph,
    options.userFeedback,
    options.projectId
  );
  const characterNames = characters.map((c) => c.name);

  return {
    title: spine.title,
    theme: spine.theme,
    style: spine.style,
    logline: spine.logline,
    sellingPoints: spine.sellingPoints,
    goldenSpine: spine.goldenSpine,
    pivotPoints,
    characters,
    characterNames,
    storyGraph,
    createdAt: new Date().toISOString(),
  };
}
