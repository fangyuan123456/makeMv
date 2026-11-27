/**
 * tools/planner/screenplay-tool/steps/02-screenplay/renderer.ts
 * 确定性互动剧本 Markdown 拼装器 (Deterministic Screenplay Renderer)
 * 职责：将模型生成的纯戏剧分幕正文与结局文案，严格按照大纲 interactions 拓扑拼装为标准 Markdown。
 * 彻底杜绝模型手写错乱导致的假合流、重复终局与钩子格式错误。
 */

import type { PremiseInteraction, PremiseOutput } from '../01-premise/schema.js';
import type { StructuredScreenplayContent } from './schema.js';

function sanitizeNarrativeBody(body: string): string {
  const cleaned = body
    .replace(/\n*【互动抉择点[\s\S]*$/m, '')
    .replace(/\n*###\s*【互动钩子[\s\S]*$/m, '')
    .replace(/\n*【终局[：:][\s\S]*$/m, '')
    .trim();
  return cleaned;
}

function formatOutcomeLabelPrefix(key: string): string {
  return key.toUpperCase() === 'TIMEOUT' ? '超时' : `选项 ${key}`;
}

function formatHookRoutePrefix(key: string): string {
  return key.toUpperCase() === 'TIMEOUT' ? '超时' : `选项${key}`;
}

function renderInteractionSection(
  actNumber: number,
  interaction: PremiseInteraction,
  content: StructuredScreenplayContent
): string {
  const parts: string[] = [];

  if (interaction.isBranching) {
    const choiceLines = interaction.outcomes.map((o) => {
      const dest =
        o.targetType === 'ENDING'
          ? `【终局：${o.endingTitle || '终局'}（${o.endingType || 'BE'}）】`
          : '【走向：推进主线】';
      return `- ${formatOutcomeLabelPrefix(o.key)}：${o.label} ➔ ${dest}`;
    });
    parts.push(`【互动抉择点 ${interaction.pointIndex}】\n${choiceLines.join('\n')}`);
  }

  // 渲染本幕所有走向 ENDING 的专有终局结算（严格去重，确保每个终局只输出一次）
  const endingOutcomes = interaction.outcomes.filter((o) => o.targetType === 'ENDING');
  const seenKeys = new Set<string>();

  for (const outcome of endingOutcomes) {
    const normKey = outcome.key.trim().toUpperCase();
    if (seenKeys.has(normKey)) continue;
    seenKeys.add(normKey);

    const matched =
      content.endings.find(
        (e) =>
          e.actNumber === actNumber &&
          e.outcomeKey.trim().toUpperCase() === normKey
      ) ||
      content.endings.find(
        (e) =>
          e.actNumber === actNumber &&
          outcome.endingTitle &&
          e.endingTitle.trim() === outcome.endingTitle.trim()
      );

    const endingTitle = matched?.endingTitle || outcome.endingTitle || '专有终局';
    const endingType = matched?.endingType || outcome.endingType || 'BE';
    const endingText = (matched?.narrativeText || outcome.approachAndCost || '').trim();

    if (endingText) {
      parts.push(`【终局：${endingTitle}（${endingType}）】\n${endingText}`);
    }
  }

  // 渲染标准化互动钩子区块
  const nextAct = actNumber + 1;
  if (interaction.isBranching) {
    const timeoutPart = interaction.timeoutSec ? ` | 限时${interaction.timeoutSec}s` : '';
    const routeSummary = interaction.outcomes
      .map((o) => {
        const dest =
          o.targetType === 'ENDING'
            ? `终局${o.endingTitle || ''}`
            : `第${nextAct}幕`;
        return `${formatHookRoutePrefix(o.key)}→${dest}`;
      })
      .join('；');
    parts.push(`### 【互动钩子：分支 ${interaction.kind}${timeoutPart} | ${routeSummary}】`);
  } else {
    const targets = interaction.config?.targets;
    const decoys = interaction.config?.decoys;
    const targetStr =
      Array.isArray(targets) && targets.length > 0
        ? ` | 目标：${targets.map((t) => `${t.name}${t.stateTag ? `(${t.stateTag})` : ''}`).join('、')}`
        : '';
    const decoyStr =
      Array.isArray(decoys) && decoys.length > 0
        ? ` | 干扰：${decoys.map((d) => d.name).join('、')}`
        : '';
    const tags = interaction.outcomes
      .map((o) => o.stateTag)
      .filter((t): t is string => Boolean(t && t.trim()));
    const tagStr = tags.length > 0 && !targetStr ? ` | 状态：${tags.join('、')}` : '';
    const timeoutPart = interaction.timeoutSec ? ` | 限时${interaction.timeoutSec}s` : '';
    parts.push(
      `### 【互动钩子：单线 ${interaction.kind}${timeoutPart} | ${interaction.prompt}${targetStr}${decoyStr}${tagStr} | 完成后推进第${nextAct}幕】`
    );
  }

  return parts.join('\n\n');
}

export function renderScreenplayMarkdown(
  premise: PremiseOutput,
  content: StructuredScreenplayContent
): string {
  const sortedOutlines = [...premise.actOutlines].sort((a, b) => a.actNumber - b.actNumber);
  const interactions = Array.isArray(premise.interactions) ? premise.interactions : [];

  const actBlocks: string[] = [];

  for (const outline of sortedOutlines) {
    const actScript = content.acts.find((a) => a.actNumber === outline.actNumber);
    const rawScene =
      actScript?.sceneHeader?.trim() ||
      (Array.isArray(outline.scenes) && outline.scenes.length > 0 ? outline.scenes[0] : '核心场景');
    const cleanScene = rawScene.replace(/^【场景[：:]\s*|】$/g, '').trim();

    const body = sanitizeNarrativeBody(actScript?.narrativeBody || outline.plotSummary || '');
    const interaction = interactions.find((it) => it.actNumber === outline.actNumber);

    const sections: string[] = [
      `## 第 ${outline.actNumber} 幕《${outline.title}》`,
      `【场景：${cleanScene}】`,
      body,
    ];

    if (interaction) {
      const interactionBlock = renderInteractionSection(outline.actNumber, interaction, content);
      if (interactionBlock) {
        sections.push(interactionBlock);
      }
    }

    actBlocks.push(sections.filter(Boolean).join('\n\n'));
  }

  return actBlocks.join('\n\n');
}

/**
 * 从现有 screenplay.md 逆向解析出结构化的分幕与终局数据，供结构化局部修改使用
 */
export function parseScreenplayMarkdownToStructured(
  markdown: string,
  premise: PremiseOutput
): StructuredScreenplayContent {
  const interactions = Array.isArray(premise.interactions) ? premise.interactions : [];
  const sortedOutlines = [...premise.actOutlines].sort((a, b) => a.actNumber - b.actNumber);

  const actBlockMap = new Map<number, string>();
  const blockMatches = markdown.split(/(?=^##\s*第\s*\d+\s*幕)/m);
  for (const rawBlock of blockMatches) {
    const headerMatch = rawBlock.match(/^##\s*第\s*(\d+)\s*幕/);
    if (headerMatch) {
      actBlockMap.set(Number(headerMatch[1]), rawBlock);
    }
  }

  const acts: StructuredScreenplayContent['acts'] = [];
  const endings: StructuredScreenplayContent['endings'] = [];

  for (const outline of sortedOutlines) {
    const block = actBlockMap.get(outline.actNumber) || '';
    const sceneMatch = block.match(/【场景[：:]\s*([^\n】]+)】/);
    const fallbackScene =
      Array.isArray(outline.scenes) && outline.scenes.length > 0 ? outline.scenes[0] : '核心场景';
    const sceneHeader = (sceneMatch?.[1] || fallbackScene).trim();

    // 提取纯净戏剧正文（去掉标题行、场景行、以及互动/终局段落）
    let body = block
      .replace(/^##\s*第\s*\d+\s*幕[^\n]*\n?/, '')
      .replace(/【场景[：:][^\n】]+】\n?/, '');
    body = sanitizeNarrativeBody(body);

    acts.push({
      actNumber: outline.actNumber,
      sceneHeader,
      narrativeBody: body || outline.plotSummary || '',
    });

    // 解析本幕中的终局段落，并与大纲中 targetType === 'ENDING' 的 outcomes 对齐
    const interaction = interactions.find((it) => it.actNumber === outline.actNumber);
    const endingOutcomes = (interaction?.outcomes || []).filter((o) => o.targetType === 'ENDING');

    const extractedEndings: Array<{ title: string; type?: string; text: string }> = [];
    const endingRegex =
      /【终局[：:]\s*([^（(】\n]+?)(?:[（(](TE|HE|BE|NE|SE)[）)])?\s*】\s*([\s\S]*?)(?=【终局[：:]|###\s*【互动钩子|$)/g;
    let em: RegExpExecArray | null;
    while ((em = endingRegex.exec(block)) !== null) {
      extractedEndings.push({
        title: em[1].trim(),
        type: em[2]?.trim(),
        text: em[3].trim(),
      });
    }

    for (let i = 0; i < endingOutcomes.length; i++) {
      const outcome = endingOutcomes[i];
      const expectedTitle = (outcome.endingTitle || '').trim();
      const matched =
        extractedEndings.find((e) => expectedTitle && e.title === expectedTitle) ||
        extractedEndings[i];

      endings.push({
        actNumber: outline.actNumber,
        outcomeKey: outcome.key,
        endingTitle: expectedTitle || matched?.title || '专有终局',
        endingType: (outcome.endingType || matched?.type || 'BE') as 'TE' | 'HE' | 'BE' | 'NE' | 'SE',
        narrativeText: (matched?.text || outcome.approachAndCost || '').trim(),
      });
    }
  }

  return { acts, endings };
}

export interface ScreenplayClipNode {
  id: string;
  title: string;
  narrativeText: string;
  location: string;
  characters: string[];
  interaction: {
    id: string;
    kind: string;
    isBranching: boolean;
    prompt: string;
    timeoutSec: number | null;
    config?: any;
    outcomes: Array<{
      key: string;
      label: string;
      targetType: 'CONTINUE_MAINLINE' | 'ENDING';
      targetNodeId?: string;
      targetEndingId?: string;
      stateTag?: string;
      feedback?: string;
    }>;
  } | null;
}

export interface ScreenplayEndingNode {
  id: string;
  actNumber: number;
  outcomeKey: string;
  title: string;
  endingType: 'TE' | 'HE' | 'BE' | 'NE' | 'SE';
  summary: string;
}

export interface ScreenplayStoryGraph {
  startNodeId: string;
  nodes: Array<{
    nodeId: string;
    title: string;
    nodeType: 'MAINLINE_CLIP' | 'ENDING';
    level: number;
    contentSnippet: string;
    endingType?: string;
  }>;
  edges: Array<{
    fromNodeId: string;
    toNodeId: string;
    edgeType: 'MAINLINE_PROGRESS' | 'CHOICE_BRANCH';
    label: string;
  }>;
}

export interface StructuredScreenplayDocument extends PremiseOutput {
  acts: StructuredScreenplayContent['acts'];
  clips: ScreenplayClipNode[];
  endings: ScreenplayEndingNode[];
  storyGraph: ScreenplayStoryGraph;
  scriptMarkdown: string;
}

function formatGraphEdgeLabel(outcomeKey: string): string {
  const upper = String(outcomeKey || '').toUpperCase();
  if (upper === 'ONENDED') return '顺向剧情';
  if (upper === 'FOUND') return '搜证完成';
  if (upper === 'SUCCESS') return '挑战成功';
  if (upper === 'FAIL') return '挑战失败';
  if (upper === 'TIMEOUT') return '超时后果';
  return `选项 ${outcomeKey}`;
}

/**
 * 基于大纲与结构化分幕/终局内容，确定性构建完整的结构化剧本 JSON 文档（含 clips 与 storyGraph）
 */
export function buildStructuredScreenplayDocument(
  premise: PremiseOutput,
  content: StructuredScreenplayContent
): StructuredScreenplayDocument {
  const sortedOutlines = [...premise.actOutlines].sort((a, b) => a.actNumber - b.actNumber);
  const interactions = Array.isArray(premise.interactions) ? premise.interactions : [];
  const scriptMarkdown = renderScreenplayMarkdown(premise, content);

  const endings: ScreenplayEndingNode[] = [];
  const endingIdMap = new Map<string, string>();

  for (const inter of interactions) {
    for (const o of inter.outcomes || []) {
      if (o.targetType !== 'ENDING') continue;
      const mapKey = `${inter.actNumber}:${o.key.trim().toUpperCase()}`;
      if (endingIdMap.has(mapKey)) continue;
      const endingId = `e_${inter.actNumber}_${o.key.trim().toLowerCase()}`;
      endingIdMap.set(mapKey, endingId);

      const matched = content.endings.find(
        (e) =>
          e.actNumber === inter.actNumber &&
          e.outcomeKey.trim().toUpperCase() === o.key.trim().toUpperCase()
      );
      endings.push({
        id: endingId,
        actNumber: inter.actNumber,
        outcomeKey: o.key,
        title: matched?.endingTitle || o.endingTitle || '专有终局',
        endingType: (matched?.endingType || o.endingType || 'BE') as ScreenplayEndingNode['endingType'],
        summary: (matched?.narrativeText || o.approachAndCost || '').trim(),
      });
    }
  }

  const allCharNames = (premise.characters || []).map((c) => c.name).filter(Boolean);
  const clips: ScreenplayClipNode[] = sortedOutlines.map((act, idx) => {
    const clipId = `c${act.actNumber}`;
    const nextAct = sortedOutlines[idx + 1];
    const nextClipId = nextAct ? `c${nextAct.actNumber}` : undefined;
    const actScript = content.acts.find((a) => a.actNumber === act.actNumber);
    const location = actScript?.sceneHeader?.trim() || act.scenes?.[0] || '核心场景';
    const body = sanitizeNarrativeBody(actScript?.narrativeBody || act.plotSummary || '');
    const narrativeText = `【场景：${location}】\n\n${body}`;

    const inter = interactions.find((it) => it.actNumber === act.actNumber);
    const mentionedChars = allCharNames.filter((name) => body.includes(name));

    return {
      id: clipId,
      title: act.title,
      narrativeText,
      location,
      characters: mentionedChars.length > 0 ? mentionedChars : allCharNames,
      interaction: inter
        ? {
            id: `I_${clipId}`,
            kind: inter.kind,
            isBranching: inter.isBranching,
            prompt: inter.prompt,
            timeoutSec: inter.timeoutSec ?? null,
            ...(inter.config ? { config: inter.config } : {}),
            outcomes: inter.outcomes.map((o) => {
              const mapKey = `${act.actNumber}:${o.key.trim().toUpperCase()}`;
              return {
                key: o.key,
                label: o.label,
                targetType: o.targetType,
                targetNodeId: o.targetType === 'CONTINUE_MAINLINE' ? nextClipId : undefined,
                targetEndingId: o.targetType === 'ENDING' ? endingIdMap.get(mapKey) : undefined,
                stateTag: o.stateTag,
                feedback: o.feedback,
              };
            }),
          }
        : null,
    };
  });

  const startNodeId = clips[0]?.id || 'c1';
  const nodes: ScreenplayStoryGraph['nodes'] = [
    ...clips.map((c, idx) => ({
      nodeId: c.id,
      title: c.title,
      nodeType: 'MAINLINE_CLIP' as const,
      level: idx + 1,
      contentSnippet: c.narrativeText.slice(0, 120),
    })),
    ...endings.map((ed) => ({
      nodeId: ed.id,
      title: ed.title,
      nodeType: 'ENDING' as const,
      level: clips.length + 1,
      contentSnippet: ed.summary,
      endingType: ed.endingType,
    })),
  ];

  const edges: ScreenplayStoryGraph['edges'] = [];
  for (let i = 0; i < clips.length; i++) {
    const c = clips[i];
    if (c.interaction) {
      for (const o of c.interaction.outcomes) {
        const toNodeId = o.targetEndingId || o.targetNodeId;
        if (!toNodeId) continue;
        edges.push({
          fromNodeId: c.id,
          toNodeId,
          edgeType: o.targetEndingId ? 'CHOICE_BRANCH' : 'MAINLINE_PROGRESS',
          label: formatGraphEdgeLabel(o.key),
        });
      }
    } else if (clips[i + 1]) {
      edges.push({
        fromNodeId: c.id,
        toNodeId: clips[i + 1].id,
        edgeType: 'MAINLINE_PROGRESS',
        label: '顺向剧情',
      });
    }
  }

  return {
    ...premise,
    acts: sortedOutlines.map((act) => {
      const a = content.acts.find((item) => item.actNumber === act.actNumber);
      return {
        actNumber: act.actNumber,
        sceneHeader: a?.sceneHeader?.trim() || act.scenes?.[0] || '核心场景',
        narrativeBody: sanitizeNarrativeBody(a?.narrativeBody || act.plotSummary || ''),
      };
    }),
    clips,
    endings,
    storyGraph: {
      startNodeId,
      nodes,
      edges,
    },
    scriptMarkdown,
  };
}
