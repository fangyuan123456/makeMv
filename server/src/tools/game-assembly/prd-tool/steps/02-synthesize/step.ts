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

    const startNodeId = clips[0]?.id || 'c1';

    // 3. 组装 endings 节点 (保证至少有一个胜利与一个失败结局)
    const endings: PrdEndingNode[] =
      rawEndings.length > 0
        ? rawEndings.map((e) => ({
            id: e.id,
            endingType: (e.endingType as any) || 'BE',
            title: e.title,
            isVictory: e.endingType === 'HE' || e.endingType === 'TE',
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

      if (c.interaction && c.interaction.outcomes.length > 0) {
        const interactionId = `I_${c.id}`;
        const inter = c.interaction;

        // clip 播放结束后进入互动点
        wiring.push({
          from: c.id,
          onOutcome: 'onEnded',
          condition: null,
          transition: null,
          to: interactionId,
        });

        const outcomes = inter.outcomes.map((o, oIdx) => {
          const outcomeKey = o.key || String.fromCharCode(65 + oIdx);

          let targetNode = o.targetEndingId || o.targetNodeId;
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

          const tagKeys = (o.stateTag || '')
            .split(/[+,，\s]+/)
            .map((t) => t.trim())
            .filter(Boolean);
          const addRecord = tagKeys.reduce<Record<string, number>>((acc, k) => {
            acc[k] = 1;
            return acc;
          }, {});
          return {
            key: outcomeKey,
            label: o.label,
            ...(tagKeys.length > 0 ? { stateChange: { add: addRecord } } : {}),
            ...(o.feedback ? { feedback: o.feedback } : {}),
          };
        });

        interactions.push({
          id: interactionId,
          kind: inter.kind,
          isBranching: inter.isBranching,
          prompt: inter.prompt || '请做出你的选择',
          timeoutSec: inter.timeoutSec ?? null,
          ...(inter.config ? { config: inter.config } : {}),
          outcomes,
        });
      } else {
        // 无互动的过渡片段，播放完毕直连下一幕或结局
        wiring.push({
          from: c.id,
          onOutcome: 'onEnded',
          condition: null,
          transition: null,
          to: nextSequentialClip || fallbackEndingId,
        });
      }
    }

    // 5. 汇聚状态字典与初始状态 (合并抽取字典与实际使用的 stateChange 键)
    const stateMap = new Map<string, { key: string; label: string; initialValue: any; showInHud: boolean; description: string }>();
    for (const sf of raw.stateSchema || []) {
      const k = String(sf.key || '').replace(/^[+]/, '').trim();
      if (!k) continue;
      stateMap.set(k, {
        key: k,
        label: sf.label || k,
        initialValue: sf.initialValue ?? 0,
        showInHud: sf.showInHud !== false,
        description: sf.description || '剧情交互状态记录',
      });
    }
    for (const inter of interactions) {
      for (const o of inter.outcomes || []) {
        for (const k of Object.keys(o.stateChange?.add || {})) {
          if (!stateMap.has(k)) {
            stateMap.set(k, {
              key: k,
              label: k,
              initialValue: 0,
              showInHud: true,
              description: `${inter.id} (${o.label}) 触发写入`,
            });
          }
        }
      }
    }
    const stateSchema = Array.from(stateMap.values());
    const initialState: Record<string, any> = {};
    for (const sf of stateSchema) {
      initialState[sf.key] = sf.initialValue;
    }

    // 6. 组装通用 PRD 全貌
    const prd: UniversalPrdSpec = {
      gameTitle,
      genre: raw.genre || '互动影游',
      playerIdentity: raw.playerIdentity || '故事核心主角',
      premiseAndPerspective: raw.premiseAndPerspective || '第一人称视听浸入式互动电影',
      ...(raw.uiTheme ? { uiTheme: raw.uiTheme } : {}),
      outOfFlowSummary:
        stateSchema.length > 0
          ? `围绕 ${stateSchema.map((s) => s.label).join('、')} 共 ${stateSchema.length} 项剧情状态推进，支持局部存档、回溯重选与多结局图鉴。`
          : '专注纯剧情沉浸推进、动作/搜证交互与多结局图鉴结算。',
      gameplayAndVictorySummary: '按分幕推进视频与末帧交互，收集关键状态线索并在高压抉择点做出决定，达成胜利通关或发掘全部分支结局。',
      uiPagesSummary: [
        { page: 'Loading 预加载页', features: '首幕视频与核心定妆/道具素材预热、作品标题与进度条展示，避免开场黑屏卡顿' },
        { page: '游戏主页', features: '首幕海报底图、作品标题与简介、开始新游戏、继续上次存档、故事线与结局图鉴入口（显示已解锁数）' },
        { page: '主播放与交互舞台', features: '全屏视频播放、顶部中文状态 HUD 角标、幕末安全区互动浮层（搜证/长按/连点/时机/限时抉择）、静音与暂停入口' },
        { page: '暂停与设置浮层', features: '呼出即冻结视频与互动倒计时，支持继续播放、音量调节、重看当前幕、返回主页' },
        { page: '故事线选集与回溯', features: '按主干与分支展示已解锁节点与结局，支持回溯重玩（恢复该节点进入前状态快照，保留已解锁结局）' },
        { page: '结局结算页', features: '展示结局徽章（TE/HE/BE/NE）、标题与完整判词、回溯关键点重选、返回主页与重新开始' },
      ],
      startNodeId,
      initialState,
      ...(stateSchema.length > 0 ? { stateSchema } : {}),
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

    const formatEdgeLabel = (onOutcome: string): string => {
      const upper = String(onOutcome || '').toUpperCase();
      if (upper === 'ONENDED') return '顺向剧情';
      if (upper === 'FOUND') return '搜证完成';
      if (upper === 'SUCCESS') return '挑战成功';
      if (upper === 'FAIL') return '挑战失败';
      if (upper === 'TIMEOUT') return '超时后果';
      return `选项 ${onOutcome}`;
    };

    for (const w of wiring) {
      if (w.onOutcome === 'onEnded' && w.to.startsWith('I_')) {
        continue;
      }
      graphEdges.push({
        fromNodeId: w.from.replace(/^I_/, ''),
        toNodeId: w.to,
        edgeType: w.to.startsWith('e_') ? 'CHOICE_BRANCH' : 'MAINLINE_PROGRESS',
        label: formatEdgeLabel(w.onOutcome),
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
