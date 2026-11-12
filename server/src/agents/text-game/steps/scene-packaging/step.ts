/**
 * agents/text-game/steps/scene-packaging/step.ts
 * 分幕自包含切片打包工序 (scenePackagingStep) - 基于 Mastra 官方微内核原生 Step
 */

import { createStep } from '@mastra/core/workflows';
import { Agent } from '@mastra/core/agent';
import { LLMProvider } from '../../../../llm/index.js';
import { runTaskRecordedStep } from '../../../../workflow-engine/TaskStore.js';
import type {
  SingleSceneJson,
  SceneChoiceItem,
} from '../../schema.js';
import type {
  UniversalPrdSpec,
  PrdInteractionNode,
  PrdWiringEdge,
  PrdEndingNode,
} from '../../../planner/steps/prd-synthesis/schema.js';
import {
  ScenePackagingInputSchema,
  ScenePackagingOutputSchema,
  type ScenePackagingInput,
  type ScenePackagingOutput,
} from './schema.js';
import {
  buildScenePackagingSystemPrompt,
  buildScenePackagingUserPrompt,
} from './prompt.js';

export function createScenePackagingAgent(): Agent {
  return new Agent({
    name: 'scene-packaging-agent',
    instructions: buildScenePackagingSystemPrompt(),
    model: LLMProvider.getModel(),
  });
}

/**
 * 刚性指针闭环校验器 (Pointer Continuity & Zero Broken Link Validator)
 * 验证起始场景、所有 choices.nextSceneJson、wiring[].to 以及 rewindTargetScene 在当前产物中全部闭环
 */
export function validateScenePointers(
  scenes: SingleSceneJson[],
  expectedStartSceneId?: string
): { valid: boolean; errors: string[] } {
  const sceneFileNames = new Set(scenes.map((s) => `${s.sceneId}.json`));
  const sceneIds = new Set(scenes.map((s) => s.sceneId));
  const errors: string[] = [];

  if (scenes.length === 0) {
    errors.push('场景清单为空，至少需要 1 个切片场景');
    return { valid: false, errors };
  }

  const startId = expectedStartSceneId || scenes[0].sceneId;
  if (!sceneFileNames.has(`${startId}.json`)) {
    errors.push(`缺少首幕入口文件 ${startId}.json（须与 PRD startNodeId 一致）`);
  }

  for (const scene of scenes) {
    const fileName = `${scene.sceneId}.json`;
    const localStepIds = new Set((scene.interaction.steps || []).map((s) => s.id));
    const localEndingIds = new Set((scene.interaction.endings || []).map((e) => e.id));

    // 1. 检查选项指针
    if (!scene.interaction.isEnding && scene.interaction.choices.length > 0) {
      for (const choice of scene.interaction.choices) {
        if (!choice.nextSceneJson) {
          errors.push(`场景 [${fileName}] 选项 [${choice.choiceId}] 缺少 nextSceneJson 指针`);
        } else if (!sceneFileNames.has(choice.nextSceneJson)) {
          errors.push(
            `场景 [${fileName}] 选项 [${choice.choiceId}] 指向未知的目标场景文件: "${choice.nextSceneJson}"`
          );
        }
      }
    }

    // 2. 检查有序 wiring 出边指针
    for (const edge of scene.interaction.wiring || []) {
      const validTarget =
        sceneIds.has(edge.to) || localStepIds.has(edge.to) || localEndingIds.has(edge.to);
      if (!validTarget) {
        errors.push(
          `场景 [${fileName}] wiring 连线 [${edge.from} -> ${edge.to}] 指向未知目标`
        );
      }
    }

    // 3. 检查负向/BE 回溯指针
    if (scene.interaction.isEnding && scene.interaction.endingType === 'BE') {
      const rewindTarget = scene.interaction.rewindTargetScene;
      if (rewindTarget && !sceneFileNames.has(rewindTarget)) {
        errors.push(
          `BE 场景 [${fileName}] 的回溯目标文件不存在: "${rewindTarget}"`
        );
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

export interface ParsedStorySection {
  title: string;
  narrativeText: string;
}

/**
 * 纯函数解析 Step 4 交付的 `story.md`（按 `## <clipId>｜<title>` 提取每幕剧本正文与标题）
 */
export function parseStorySections(storyMarkdown: string): Map<string, ParsedStorySection> {
  const sections = new Map<string, ParsedStorySection>();
  if (!storyMarkdown || !storyMarkdown.trim()) {
    return sections;
  }

  let currentId: string | null = null;
  let currentTitle = '';
  let bodyLines: string[] = [];

  const flushSection = () => {
    if (!currentId) return;
    while (bodyLines.length > 0 && !bodyLines[0].trim()) bodyLines.shift();
    while (
      bodyLines.length > 0 &&
      (!bodyLines[bodyLines.length - 1].trim() || bodyLines[bodyLines.length - 1].trim() === '---')
    ) {
      bodyLines.pop();
    }
    sections.set(currentId, {
      title: currentTitle,
      narrativeText: bodyLines.join('\n').trim(),
    });
  };

  for (const line of storyMarkdown.split(/\r?\n/)) {
    const heading = line.match(/^##\s+([^\s｜|]+)(?:[｜|](.*))?$/);
    if (heading) {
      flushSection();
      currentId = heading[1].trim();
      currentTitle = (heading[2] || '').trim();
      bodyLines = [];
      continue;
    }
    if (currentId) {
      bodyLines.push(line);
    }
  }
  flushSection();

  return sections;
}

function isBranchClipId(clipId: string, prd: UniversalPrdSpec): boolean {
  if (/\.\d+$/.test(clipId)) return true;
  return prd.wiring.some((w) => w.to === clipId && w.onOutcome === 'B');
}

function deriveRewindClipFromWiring(prd: UniversalPrdSpec, clipId: string): string | undefined {
  const clipIdSet = new Set(prd.clips.map((c) => c.id));
  const incomingClipEdge = prd.wiring.find((w) => w.to === clipId && clipIdSet.has(w.from));
  if (incomingClipEdge) return incomingClipEdge.from;

  const incomingInterEdge = prd.wiring.find((w) => w.to === clipId);
  if (incomingInterEdge) {
    const ownerClipEdge = prd.wiring.find(
      (w) => w.to === incomingInterEdge.from && clipIdSet.has(w.from)
    );
    if (ownerClipEdge) return ownerClipEdge.from;
  }

  const prefix = clipId.match(/^(.+)\.\d+$/)?.[1];
  return prefix && clipIdSet.has(prefix) ? prefix : undefined;
}

function computeClipLevelMap(prd: UniversalPrdSpec): Map<string, number> {
  const levelMap = new Map<string, number>();
  const clipIdSet = new Set(prd.clips.map((c) => c.id));
  const interMap = new Map(prd.interactions.map((i) => [i.id, i]));
  const startId = prd.startNodeId || prd.clips[0]?.id;
  if (startId) {
    const queue: Array<{ nodeId: string; clipDepth: number }> = [{ nodeId: startId, clipDepth: 1 }];
    const visited = new Set<string>();
    while (queue.length > 0) {
      const { nodeId, clipDepth } = queue.shift()!;
      if (visited.has(nodeId)) continue;
      visited.add(nodeId);
      if (clipIdSet.has(nodeId) && !levelMap.has(nodeId)) {
        levelMap.set(nodeId, clipDepth);
      }
      for (const edge of prd.wiring) {
        if (edge.from !== nodeId) continue;
        if (interMap.has(edge.to)) {
          queue.push({ nodeId: edge.to, clipDepth });
        } else if (clipIdSet.has(edge.to)) {
          queue.push({ nodeId: edge.to, clipDepth: clipDepth + 1 });
        }
      }
    }
  }

  prd.clips.forEach((c, idx) => {
    const match = c.id.match(/(\d+)(?:\.\d+)?$/);
    if (match) {
      levelMap.set(c.id, Number(match[1]));
    } else if (!levelMap.has(c.id)) {
      levelMap.set(c.id, idx + 1);
    }
  });
  return levelMap;
}

const ENDING_TYPE_RANK: Record<PrdEndingNode['endingType'], number> = {
  TE: 0,
  HE: 1,
  SE: 2,
  NE: 3,
  BE: 4,
};

/**
 * 从 UniversalPrdSpec 确定性抽取指定片段在 onEnded 后关联的本地互动步、有序接线与结局切片
 */
export function buildSceneInteractionFromPrd(
  clipId: string,
  prd: UniversalPrdSpec
): SingleSceneJson['interaction'] {
  const clipIdSet = new Set(prd.clips.map((c) => c.id));
  const interMap = new Map(prd.interactions.map((i) => [i.id, i]));
  const endingMap = new Map(prd.endings.map((e) => [e.id, e]));

  const steps: PrdInteractionNode[] = [];
  const wiring: PrdWiringEdge[] = [];
  const endings: PrdEndingNode[] = [];
  const seenSteps = new Set<string>();
  const seenEndings = new Set<string>();
  const queue: string[] = [clipId];
  const visitedFrom = new Set<string>();

  while (queue.length > 0) {
    const fromId = queue.shift()!;
    if (visitedFrom.has(fromId)) continue;
    visitedFrom.add(fromId);

    for (const edge of prd.wiring) {
      if (edge.from !== fromId) continue;
      wiring.push(edge);
      if (interMap.has(edge.to) && !seenSteps.has(edge.to)) {
        seenSteps.add(edge.to);
        steps.push(interMap.get(edge.to)!);
        queue.push(edge.to);
      } else if (endingMap.has(edge.to) && !seenEndings.has(edge.to)) {
        seenEndings.add(edge.to);
        endings.push(endingMap.get(edge.to)!);
      }
    }
  }

  const choices: SceneChoiceItem[] = [];
  const choiceSteps = steps.filter((s) => s.kind.toUpperCase() === 'CHOICE');

  if (choiceSteps.length > 0) {
    for (const ch of choiceSteps) {
      for (const outcome of ch.outcomes) {
        if (outcome.key === 'TIMEOUT') continue;
        const matchedEdges = wiring.filter(
          (w) =>
            w.from === ch.id &&
            (w.onOutcome === outcome.key || w.onOutcome === '*') &&
            clipIdSet.has(w.to)
        );
        for (const edge of matchedEdges) {
          choices.push({
            choiceId: `${ch.id}_${outcome.key}`,
            text: outcome.label,
            nextSceneJson: `${edge.to}.json`,
            ...(outcome.stateChange ? { stateChange: outcome.stateChange } : {}),
            ...(edge.condition ? { condition: edge.condition } : {}),
          });
        }
      }
    }
  } else {
    // 非抉择片段：直接从 wiring 的 transition 或默认文案装配下一跳（如线性推进或 REJOIN 支线）
    const outgoingClipEdges = wiring.filter((w) => clipIdSet.has(w.to));
    const singleImmersiveOutcome =
      steps.length === 1 && steps[0].outcomes.length > 0 ? steps[0].outcomes[0] : undefined;
    for (const edge of outgoingClipEdges) {
      choices.push({
        choiceId: `c_${clipId}_to_${edge.to}`,
        text: edge.transition?.text || '继续推进',
        nextSceneJson: `${edge.to}.json`,
        ...(singleImmersiveOutcome?.stateChange
          ? { stateChange: singleImmersiveOutcome.stateChange }
          : {}),
        ...(edge.condition ? { condition: edge.condition } : {}),
      });
    }
  }

  const targetsAnotherClip = wiring.some((w) => clipIdSet.has(w.to));
  const isEnding = !targetsAnotherClip && endings.length > 0;

  let endingType: SingleSceneJson['interaction']['endingType'];
  let endingTitle: string | undefined;
  let verdict: string | undefined;
  let rewindTargetScene: string | undefined;

  if (isEnding && endings.length > 0) {
    // 元数据展示优先体现高阶胜局（TE > HE > SE > NE > BE），运行时仍按 wiring 顺序动态结算
    const ranked = [...endings].sort(
      (a, b) =>
        (a.isVictory ? 0 : 10) +
        (ENDING_TYPE_RANK[a.endingType] ?? 5) -
        ((b.isVictory ? 0 : 10) + (ENDING_TYPE_RANK[b.endingType] ?? 5))
    );
    const primaryEnding = ranked[0];
    endingType = primaryEnding.endingType;
    endingTitle = primaryEnding.title;
    verdict = primaryEnding.summary;

    const branchClip = isBranchClipId(clipId, prd);
    const rewindCandidate = endings.find((e) => !e.isVictory && (e.rewindTargetClipId || branchClip));
    if (rewindCandidate) {
      const targetClipId =
        rewindCandidate.rewindTargetClipId || deriveRewindClipFromWiring(prd, clipId);
      if (targetClipId && clipIdSet.has(targetClipId)) {
        rewindTargetScene = `${targetClipId}.json`;
      }
    }
  }

  return {
    steps,
    wiring,
    endings,
    choices,
    isEnding,
    ...(endingType ? { endingType } : {}),
    ...(endingTitle ? { endingTitle } : {}),
    ...(verdict ? { verdict } : {}),
    ...(rewindTargetScene ? { rewindTargetScene } : {}),
  };
}

/**
 * 根据单幕正文、尾帧互动描述及 PRD 交互匹配该幕尾帧所需的角色与道具 ID（角色在前，道具在后）
 */
function matchSceneEntityIds(
  textCorpus: string,
  entities: ScenePackagingInput['entities']
): string[] {
  const matchedChars = entities.characters
    .filter((c) => c.name && textCorpus.includes(c.name))
    .map((c) => c.characterId);
  const matchedItems = entities.items
    .filter((i) => i.name && textCorpus.includes(i.name))
    .map((i) => i.itemId);

  const combined = [...matchedChars, ...matchedItems];
  if (combined.length > 0) return combined;

  return [
    ...entities.characters.slice(0, 1).map((c) => c.characterId),
    ...entities.items.slice(0, 1).map((i) => i.itemId),
  ];
}

/**
 * 确定性结构化构建器（严格保留 PRD 节点 ID `S1`/`S1.1` 与状态机切片，锚定每段尾帧）
 */
export function buildDeterministicScenesFromPlanner(input: ScenePackagingInput): SingleSceneJson[] {
  const { storyMarkdown, entities, prd } = input;
  const storyMap = parseStorySections(storyMarkdown);
  const levelMap = computeClipLevelMap(prd);

  const scenes: SingleSceneJson[] = [];

  for (const prdClip of prd.clips) {
    const id = prdClip.id;
    const sec = storyMap.get(id);
    const level = levelMap.get(id) ?? 1;
    const title = sec?.title || prdClip.title || id;
    const narrativeText = sec?.narrativeText || prdClip.title || '';
    const interaction = buildSceneInteractionFromPrd(id, prd);
    const nonChoiceSteps = interaction.steps.filter((s) => s.kind.toUpperCase() !== 'CHOICE');
    const interactionCorpus = interaction.steps
      .map((s) => `${s.prompt} ${s.outcomes.map((o) => o.feedback || '').join(' ')} ${JSON.stringify(s.config || {})}`)
      .join(' ');
    const sceneEntityIds = matchSceneEntityIds(`${title} ${narrativeText} ${interactionCorpus}`, entities);

    const tailExcerpt = narrativeText.replace(/\s+/g, ' ').trim().slice(-140);
    const endFrameMoment = tailExcerpt
      ? `本幕尾帧定格：${tailExcerpt}${nonChoiceSteps[0]?.prompt ? `（衔接幕尾交互：${nonChoiceSteps[0].prompt}）` : ''}`
      : `${title} 尾帧定格画面`;

    const branchClip = isBranchClipId(id, prd);
    const isNegativeEnding = interaction.isEnding && interaction.endingType === 'BE';
    const charNames = entities.characters
      .filter((c) => sceneEntityIds.includes(c.characterId))
      .map((c) => `${c.name}（${c.appearanceSummary}）`);
    const itemNames = entities.items
      .filter((i) => sceneEntityIds.includes(i.itemId))
      .map((i) => `${i.name}（${i.appearanceSummary}）`);
    const subjectClause = [...charNames, ...itemNames].join('、');

    scenes.push({
      sceneId: id,
      level,
      title,
      targetVideoClipName: prdClip?.video || `${id}.mp4`,
      estimatedDurationSeconds: 8,
      entityIds: sceneEntityIds,
      visualAnchor: {
        endFrameMoment,
        cameraAngle: branchClip ? '近景情绪特写，动态焦点切换' : '中景视点推镜，贴合尾帧互动焦点',
        lighting: isNegativeEnding ? '强戏剧反差氛围光影' : '契合当前剧目基调的自然叙事光影',
        promptZh: `单幅完整电影尾帧画面，${title}。${endFrameMoment}${subjectClause ? `。画面中包含：${subjectClause}` : ''}。${entities.artStyle}`,
        promptEn: `${prd.genre ? `${prd.genre} style, ` : ''}${title}, cohesive single cinematic end-frame freeze shot, ${isNegativeEnding ? 'dramatic high-contrast lighting' : 'natural atmospheric scene lighting'}, high detail`,
      },
      screenplay: {
        storyContext: narrativeText,
        videoActionDescription: `镜头稳健推近尾帧定格主体，捕捉人物微表情与关键道具所处状态。`,
        dialogues: [
          {
            speaker: '旁白',
            line: narrativeText.slice(0, 60) || title,
            emotion: isNegativeEnding ? '紧绷触动' : '贴合当下情境',
          },
        ],
      },
      interaction,
    });
  }

  return scenes;
}

/**
 * 将 LLM 创作的视听/对白结果与 PRD 强类型交互接线 SSOT 对齐合流
 */
export function hydrateScenesWithPrd(
  llmScenes: SingleSceneJson[],
  input: ScenePackagingInput
): SingleSceneJson[] {
  const deterministic = buildDeterministicScenesFromPlanner(input);
  const detMap = new Map(deterministic.map((s) => [s.sceneId, s]));
  const llmMap = new Map(llmScenes.map((s) => [s.sceneId, s]));

  // 若 LLM 返回的 ID 与 PRD clips 全无交集（如幻觉生成了 legacy scene_01），直接启用确定性切片
  const overlapCount = deterministic.filter((d) => llmMap.has(d.sceneId)).length;
  if (overlapCount === 0) {
    return deterministic;
  }

  const validEntitySet = new Set([
    ...input.entities.characters.map((c) => c.characterId),
    ...input.entities.items.map((i) => i.itemId),
  ]);

  return deterministic.map((base) => {
    const llm = llmMap.get(base.sceneId);
    if (!llm) return base;

    const filteredEntities = Array.from(
      new Set((llm.entityIds || []).filter((id) => validEntitySet.has(id)))
    );
    const va = llm.visualAnchor || ({} as Partial<SingleSceneJson['visualAnchor']>);
    return {
      ...base,
      title: llm.title || base.title,
      estimatedDurationSeconds: llm.estimatedDurationSeconds || base.estimatedDurationSeconds,
      entityIds: llm.entityIds !== undefined ? filteredEntities : base.entityIds,
      visualAnchor: {
        endFrameMoment: va.endFrameMoment?.trim() || base.visualAnchor.endFrameMoment,
        cameraAngle: va.cameraAngle?.trim() || base.visualAnchor.cameraAngle,
        lighting: va.lighting?.trim() || base.visualAnchor.lighting,
        promptZh: va.promptZh?.trim() || base.visualAnchor.promptZh,
        promptEn: va.promptEn?.trim() || base.visualAnchor.promptEn,
      },
      screenplay:
        llm.screenplay?.dialogues && llm.screenplay.dialogues.length > 0
          ? llm.screenplay
          : base.screenplay,
      // 交互结构、状态变更、条件连线与终局全部以 Stage 1 PRD 为单一事实来源
      interaction: detMap.get(base.sceneId)!.interaction,
    };
  });
}

export async function executeScenePackagingStep(
  input: ScenePackagingInput,
  agent: Agent = createScenePackagingAgent()
): Promise<ScenePackagingOutput> {
  const prompt = buildScenePackagingUserPrompt(input);

  try {
    const response = await agent.generate(prompt, {
      output: ScenePackagingOutputSchema,
    });

    if (response.object && response.object.scenes && response.object.scenes.length > 0) {
      const hydrated = hydrateScenesWithPrd(response.object.scenes, input);
      const validation = validateScenePointers(hydrated, input.prd.startNodeId);
      if (validation.valid) {
        return {
          scenes: hydrated,
          summary: response.object.summary || `成功打包全剧 ${hydrated.length} 幕独立切片 JSON`,
        };
      }
      console.warn(`[ScenePackaging] 指针校验未通过: ${validation.errors.join('; ')}，执行确定性构建`);
    }
  } catch (err) {
    console.warn(`[ScenePackaging] LLM 推演异常，执行确定性构建:`, err);
  }

  // 确定性构建
  const scenes = buildDeterministicScenesFromPlanner(input);
  return {
    scenes,
    summary: `成功打包全剧 ${scenes.length} 幕独立切片 JSON（1:1 对齐 PRD 节点 ID 与状态机接线）。`,
  };
}

export const scenePackagingStep = createStep({
  id: 'scene-packaging-step',
  inputSchema: ScenePackagingInputSchema,
  outputSchema: ScenePackagingOutputSchema,
  execute: async ({ context }) => {
    return await runTaskRecordedStep('scene-packaging-step', async () => {
      const ctx = context as any;
      const trigger = ctx.triggerData || ctx;
      const entities = ctx.steps?.['entity-extract-step']?.output || ctx.entities;
      return await executeScenePackagingStep({
        title: trigger.title,
        prd: trigger.prd,
        storyMarkdown: trigger.storyMarkdown,
        entities,
      });
    });
  },
});
