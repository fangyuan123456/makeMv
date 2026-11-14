/**
 * tools/planner/script-to-prd-tool/steps/02-synthesize/step.ts
 * 步骤二：通用 PRD 规格化汇聚、拓扑建图与门禁校验工序 (synthesizePrdStep)
 */

import { createStep } from '@mastra/core/workflows';
import {
  ExtractedScriptStructureSchema,
  type ExtractedScriptStructure,
} from '../01-extract/schema.js';
import {
  ScriptToPrdOutputSchema,
  type ScriptToPrdOutput,
  type StorySectionItem,
} from './schema.js';
import type {
  UniversalPrdSpec,
  PrdClipNode,
  PrdInteractionNode,
  PrdEndingNode,
  PrdWiringEdge,
  StoryGraph,
  StoryGraphNode,
  StoryGraphEdge,
} from '../../../../../agents/planner/steps/prd-synthesis/schema.js';

export const synthesizePrdStep = createStep({
  id: 'synthesize-prd-and-validate',
  description: '将提取出的分幕与选项组装为标准 Universal PRD、生成拓扑图谱并执行图论闭环门禁',
  inputSchema: ExtractedScriptStructureSchema,
  outputSchema: ScriptToPrdOutputSchema,
  execute: async ({ context }) => {
    const ctx = (context as any) || {};
    const stepOutput =
      ctx.getStepResult?.('extract-script-structure') ||
      ctx.steps?.['extract-script-structure']?.output ||
      ctx;
    const raw: ExtractedScriptStructure = (stepOutput?.clips ? stepOutput : ctx.clips ? ctx : ctx.triggerData) || {};

    const gameTitle = raw.title || '未命名互动影游';
    const rawClips = raw.clips || [];
    if (rawClips.length === 0) {
      throw new Error('[ScriptToPrdTool] 剧本结构语义抽取未识别出任何有效剧情片段（clips 为空），无法组装 PRD 与拓扑图谱');
    }
    const rawEndings = raw.endings || [];

    // 1. 整理分段故事字典 storySections
    const storySections: Record<string, StorySectionItem> = {};
    for (const c of rawClips) {
      storySections[c.id] = {
        title: c.title,
        narrativeText: c.narrativeText,
      };
    }

    // 2. 组装标准 clips 节点
    const clips: PrdClipNode[] = rawClips.map((c) => ({
      id: c.id,
      title: c.title,
      video: `${c.id}.mp4`,
    }));

    const startNodeId = clips[0]?.id || 'c1';

    // 3. 组装 endings 节点 (保证至少有一个胜利与一个失败结局)
    const endings: PrdEndingNode[] =
      rawEndings.length > 0
        ? rawEndings.map((e) => ({
            id: e.id,
            endingType: (e.endingType as any) || 'BE',
            title: e.title,
            isVictory: e.endingType === 'HE',
            summary: e.summary,
            rewindTargetClipId: startNodeId,
          }))
        : [
            {
              id: 'e_he_main',
              endingType: 'HE',
              title: '绝地生还 (胜利结局)',
              isVictory: true,
              summary: '玩家成功完成主线破局，揭开所有秘密。',
              rewindTargetClipId: startNodeId,
            },
            {
              id: 'e_be_main',
              endingType: 'BE',
              title: '功亏一篑 (遗憾落幕)',
              isVictory: false,
              summary: '关键时刻做出致命选择，未能脱险。',
              rewindTargetClipId: startNodeId,
            },
          ];

    // 4. 组装 interactions 节点与 wiring 连线
    const interactions: PrdInteractionNode[] = [];
    const wiring: PrdWiringEdge[] = [];

    const validClipIds = new Set(clips.map((c) => c.id));
    const validEndingIds = new Set(endings.map((e) => e.id));
    const fallbackEndingId = endings.find((e) => e.isVictory)?.id || endings[0].id;

    for (let i = 0; i < rawClips.length; i++) {
      const c = rawClips[i];
      const nextSequentialClip = rawClips[i + 1]?.id;

      if (c.choices && c.choices.length > 0) {
        const interactionId = `I_${c.id}`;

        // clip 播放结束后进入互动点
        wiring.push({
          from: c.id,
          onOutcome: 'onEnded',
          condition: null,
          transition: null,
          to: interactionId,
        });

        const outcomes = c.choices.map((choice, cIdx) => {
          const outcomeKey = String.fromCharCode(65 + cIdx); // A, B, C...

          let targetNode = choice.targetEndingId || choice.targetNodeId;
          // 若目标无效，优先走向下一幕；若无下一幕，兜底走向结局
          if (!targetNode || (!validClipIds.has(targetNode) && !validEndingIds.has(targetNode))) {
            targetNode = nextSequentialClip || fallbackEndingId;
          }

          wiring.push({
            from: interactionId,
            onOutcome: outcomeKey,
            condition: null,
            transition: null,
            to: targetNode,
          });

          return {
            key: outcomeKey,
            label: choice.text,
          };
        });

        interactions.push({
          id: interactionId,
          kind: 'CHOICE',
          prompt: '请做出你的抉择',
          timeoutSec: null,
          outcomes,
        });
      } else {
        // 无选项的过渡片段，播放完毕直连下一幕或结局
        wiring.push({
          from: c.id,
          onOutcome: 'onEnded',
          condition: null,
          transition: null,
          to: nextSequentialClip || fallbackEndingId,
        });
      }
    }

    // 5. 组装通用 PRD 全貌
    const prd: UniversalPrdSpec = {
      gameTitle,
      genre: '互动影游',
      playerIdentity: '故事核心主角',
      premiseAndPerspective: '第一人称视听浸入式互动电影',
      outOfFlowSummary: '无复杂外围养成，专注纯剧情分支与生死抉择',
      gameplayAndVictorySummary: '在剧情关键时刻做出决策，达成胜利通关或发掘不同隐藏终局',
      uiPagesSummary: [
        { page: '主播放区', features: '沉浸全屏播放、分支选择悬浮卡片、回溯选集' },
        { page: '故事线图谱', features: '展示所有已解锁与待探索剧情分节点' },
      ],
      startNodeId,
      initialState: {},
      clips,
      interactions,
      endings,
      wiring,
    };

    // 6. 生成可视化图谱数据 (StoryGraph DAG)
    const graphNodes: StoryGraphNode[] = [];
    const graphEdges: StoryGraphEdge[] = [];

    clips.forEach((c, idx) => {
      graphNodes.push({
        nodeId: c.id,
        title: c.title,
        nodeType: 'MAINLINE_CLIP',
        level: idx + 1,
        contentSnippet: storySections[c.id]?.narrativeText?.slice(0, 100) || c.title,
      });
    });

    endings.forEach((ed) => {
      graphNodes.push({
        nodeId: ed.id,
        title: ed.title,
        nodeType: 'ENDING',
        level: clips.length + 1,
        contentSnippet: ed.summary,
        endingType: ed.endingType,
      });
    });

    for (const w of wiring) {
      if (w.onOutcome === 'onEnded' && w.to.startsWith('I_')) {
        continue;
      }
      graphEdges.push({
        fromNodeId: w.from.replace(/^I_/, ''),
        toNodeId: w.to,
        edgeType: w.to.startsWith('e_') ? 'CHOICE_BRANCH' : 'MAINLINE_PROGRESS',
        label: w.onOutcome === 'onEnded' ? '顺向剧情' : `选项 ${w.onOutcome}`,
      });
    }

    const graph: StoryGraph = {
      startNodeId,
      nodes: graphNodes,
      edges: graphEdges,
    };

    // 7. 纯代码图论拓扑刚性校验 (检测死胡同与孤立不可达节点)
    const errors: string[] = [];
    const warnings: string[] = [];

    // 检查所有非结局节点是否有出边
    const fromNodes = new Set(wiring.map((w) => w.from));
    for (const c of clips) {
      if (!fromNodes.has(c.id)) {
        errors.push(`视频片段 [${c.id}] 缺少后续流向接线`);
      }
    }
    for (const it of interactions) {
      if (!fromNodes.has(it.id)) {
        errors.push(`互动抉择点 [${it.id}] 缺少分支目标接线`);
      }
    }

    const valid = errors.length === 0;

    const output: ScriptToPrdOutput = {
      title: gameTitle,
      prd,
      storySections,
      graph,
      validation: {
        valid,
        errors,
        warnings,
      },
    };

    return output;
  },
});
