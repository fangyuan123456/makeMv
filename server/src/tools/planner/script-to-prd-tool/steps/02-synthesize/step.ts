/**
 * tools/planner/script-to-prd-tool/steps/02-synthesize/step.ts
 * 步骤二：通用 PRD 规格化汇聚、拓扑建图与门禁校验工序 (synthesizePrdStep)
 */

import { createStep } from '@mastra/core/workflows';
import { validateStoryGraph } from '../../../validate-story-graph.js';
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
} from '../../../../../project-store/contracts/planner/index.js';
import {
  formatGddPrdToMarkdown,
  formatStoryScenesToMarkdown,
} from './markdown-renderer.js';

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

    const startNodeId = raw.startNodeId || clips[0].id;
    if (!clips.some(c => c.id === startNodeId)) throw new Error('故事入口必须是剧情片段');
    const nodeIds = new Set([...rawClips, ...rawEndings].map(n => n.id));

    const endings: PrdEndingNode[] = rawEndings.map(e => ({
      id: e.id, endingType: e.endingType, title: e.title,
      isVictory: e.endingType === 'HE', summary: e.summary,
      rewindTargetClipId: startNodeId,
    }));
    for (const clip of rawClips) {
      if (clip.choices?.length && clip.nextNodeId) {
        throw new Error(`节点 ${clip.id} 同时包含选项与自动后继`);
      }
      for (const choice of clip.choices || []) {
        if ((!choice.targetNodeId && !choice.targetEndingId) || (choice.targetNodeId && choice.targetEndingId)) {
          throw new Error(`选项 ${clip.id}/${choice.id} 必须指定唯一目标`);
        }
        if (choice.targetNodeId && !rawClips.some(c => c.id === choice.targetNodeId)) throw new Error(`片段目标不存在：${choice.targetNodeId}`);
        if (choice.targetEndingId && !rawEndings.some(e => e.id === choice.targetEndingId)) throw new Error(`结局目标不存在：${choice.targetEndingId}`);
      }
      if (clip.choices?.length && nodeIds.has(`I_${clip.id}`)) throw new Error(`互动节点 ID 冲突：I_${clip.id}`);
    }
    validateStoryGraph(startNodeId, [
      ...rawClips.map(c => ({ id: c.id, terminal: false, targets: c.choices?.length
        ? c.choices.flatMap(ch => ch.nextRoutes?.map(r=>r.targetNodeId) || [(ch.targetEndingId || ch.targetNodeId)!])
        : c.nextRoutes?.map(r=>r.targetNodeId) || (c.nextNodeId ? [c.nextNodeId] : []) })),
      ...endings.map(e => ({ id: e.id, terminal: true, targets: [] as string[] })),
    ]);

    // 4. 组装 interactions 节点与 wiring 连线
    const interactions: PrdInteractionNode[] = [];
    const wiring: PrdWiringEdge[] = [];

    for (let i = 0; i < rawClips.length; i++) {
      const c = rawClips[i];

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

          const targetNode = (choice.targetEndingId || choice.targetNodeId)!;

          if(choice.nextRoutes?.length) {
            for(const route of choice.nextRoutes) wiring.push({from:interactionId,onOutcome:outcomeKey,condition:JSON.stringify(route.when),transition:null,to:route.targetNodeId});
          } else wiring.push({
            from: interactionId,
            onOutcome: outcomeKey,
            condition: null,
            transition: null,
            to: targetNode,
          });

          return {
            key: outcomeKey,
            label: choice.text,
            stateChange: choice.stateChange,
          };
        });

        interactions.push({
          id: interactionId,
          kind: 'CHOICE',
          prompt: '请做出你的抉择',
          timeoutSec: null,
          outcomes,
        });
      } else if(c.nextRoutes?.length) {
        for(const route of c.nextRoutes) wiring.push({from:c.id,onOutcome:'onEnded',condition:JSON.stringify(route.when),transition:null,to:route.targetNodeId});
      } else {
        // 无选项片段严格使用明确后继，数组顺序不代表剧情流向
        wiring.push({
          from: c.id,
          onOutcome: 'onEnded',
          condition: null,
          transition: null,
          to: c.nextNodeId!,
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
      initialState: raw.initialState || {},
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
        nodeType: 'CLIP',
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
        fromNodeId: w.onOutcome === 'onEnded' ? w.from : w.from.slice(2),
        toNodeId: w.to,
        edgeType: w.onOutcome === 'onEnded' ? 'MAINLINE_PROGRESS' : 'CHOICE_BRANCH',
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
    const prdMarkdown = formatGddPrdToMarkdown(prd);
    const storyMarkdown = formatStoryScenesToMarkdown(clips, storySections);

    const output: ScriptToPrdOutput = {
      title: gameTitle,
      prd,
      prdMarkdown,
      storyMarkdown,
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
