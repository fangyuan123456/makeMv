/**
 * server/src/project-store/story-source.ts
 * 下游影视与游戏工坊统一故事源读取助手 (Story Source SSOT)
 * 唯一读取策划阶段落盘的结构化剧本 JSON (screenplay_json / screenplay.json)，
 * 并统一补全 clips / interactions / wiring / startNodeId 视图。
 */

import fs from 'node:fs';
import path from 'node:path';
import { ProjectStore } from './ProjectStore.js';

function formatOutcomeLabelPrefix(key: string): string {
  return String(key || '').toUpperCase() === 'TIMEOUT' ? '超时' : `选项 ${key}`;
}

function formatHookRoutePrefix(key: string): string {
  return String(key || '').toUpperCase() === 'TIMEOUT' ? '超时' : `选项${key}`;
}

/**
 * 根据结构化剧本 JSON（clips / endings / interactions）在内存中按需渲染完整剧本文本，
 * 避免将冗余的 scriptMarkdown 持久化到 screenplay.json。
 */
export function renderScreenplayMarkdownFromDocument(doc: Record<string, any> | undefined | null): string {
  if (!doc || typeof doc !== 'object') return '';

  const clips: any[] = Array.isArray(doc.clips) ? doc.clips : [];
  if (clips.length === 0) {
    return typeof doc.scriptMarkdown === 'string' ? doc.scriptMarkdown : '';
  }

  const endings: any[] = Array.isArray(doc.endings) ? doc.endings : [];
  const rawInteractions: any[] = Array.isArray(doc.interactions) ? doc.interactions : [];
  const actBlocks: string[] = [];

  for (let i = 0; i < clips.length; i++) {
    const clip = clips[i];
    const actNumber = typeof clip.actNumber === 'number'
      ? clip.actNumber
      : Number(String(clip.id || '').replace(/^c/i, '')) || i + 1;
    const title = clip.title || `第 ${actNumber} 幕`;
    const narrativeText = String(clip.narrativeText || '').trim();
    const sections: string[] = [`## 第 ${actNumber} 幕《${title}》`];
    if (narrativeText) {
      sections.push(narrativeText);
    }

    const inter = clip.interaction || rawInteractions.find((it) => it.actNumber === actNumber);
    if (inter && Array.isArray(inter.outcomes)) {
      const parts: string[] = [];
      const pointIndex = inter.pointIndex ?? i + 1;

      if (inter.isBranching) {
        const choiceLines = inter.outcomes.map((o: any) => {
          const isEnding = o.targetType === 'ENDING' || Boolean(o.targetEndingId);
          const matchedEnding = isEnding
            ? endings.find(
                (e) =>
                  (o.targetEndingId && e.id === o.targetEndingId) ||
                  (e.actNumber === actNumber &&
                    String(e.outcomeKey || '').trim().toUpperCase() === String(o.key || '').trim().toUpperCase())
              )
            : undefined;
          const dest = isEnding
            ? `【终局：${matchedEnding?.title || o.endingTitle || '终局'}（${matchedEnding?.endingType || o.endingType || 'BE'}）】`
            : '【走向：推进主线】';
          return `- ${formatOutcomeLabelPrefix(o.key)}：${o.label} ➔ ${dest}`;
        });
        parts.push(`【互动抉择点 ${pointIndex}】\n${choiceLines.join('\n')}`);
      }

      const endingOutcomes = inter.outcomes.filter((o: any) => o.targetType === 'ENDING' || Boolean(o.targetEndingId));
      const seenKeys = new Set<string>();
      for (const outcome of endingOutcomes) {
        const normKey = String(outcome.key || '').trim().toUpperCase();
        if (seenKeys.has(normKey)) continue;
        seenKeys.add(normKey);

        const matched = endings.find(
          (e) =>
            (outcome.targetEndingId && e.id === outcome.targetEndingId) ||
            (e.actNumber === actNumber && String(e.outcomeKey || '').trim().toUpperCase() === normKey)
        );
        const endingTitle = matched?.title || matched?.endingTitle || outcome.endingTitle || '专有终局';
        const endingType = matched?.endingType || outcome.endingType || 'BE';
        const endingText = String(matched?.summary || matched?.narrativeText || outcome.approachAndCost || '').trim();
        if (endingText) {
          parts.push(`【终局：${endingTitle}（${endingType}）】\n${endingText}`);
        }
      }

      const nextAct = actNumber + 1;
      if (inter.isBranching) {
        const timeoutPart = inter.timeoutSec ? ` | 限时${inter.timeoutSec}s` : '';
        const routeSummary = inter.outcomes
          .map((o: any) => {
            const isEnding = o.targetType === 'ENDING' || Boolean(o.targetEndingId);
            const matched = isEnding
              ? endings.find(
                  (e) =>
                    (o.targetEndingId && e.id === o.targetEndingId) ||
                    (e.actNumber === actNumber &&
                      String(e.outcomeKey || '').trim().toUpperCase() === String(o.key || '').trim().toUpperCase())
                )
              : undefined;
            const dest = isEnding
              ? `终局${matched?.title || o.endingTitle || ''}`
              : `第${nextAct}幕`;
            return `${formatHookRoutePrefix(o.key)}→${dest}`;
          })
          .join('；');
        parts.push(`### 【互动钩子：分支 ${inter.kind}${timeoutPart} | ${routeSummary}】`);
      } else {
        const targets = inter.config?.targets;
        const decoys = inter.config?.decoys;
        const targetStr =
          Array.isArray(targets) && targets.length > 0
            ? ` | 目标：${targets.map((t: any) => `${t.name}${t.stateTag ? `(${t.stateTag})` : ''}`).join('、')}`
            : '';
        const decoyStr =
          Array.isArray(decoys) && decoys.length > 0
            ? ` | 干扰：${decoys.map((d: any) => d.name).join('、')}`
            : '';
        const tags = inter.outcomes
          .map((o: any) => o.stateTag)
          .filter((t: any): t is string => Boolean(t && String(t).trim()));
        const tagStr = tags.length > 0 && !targetStr ? ` | 状态：${tags.join('、')}` : '';
        const timeoutPart = inter.timeoutSec ? ` | 限时${inter.timeoutSec}s` : '';
        parts.push(
          `### 【互动钩子：单线 ${inter.kind}${timeoutPart} | ${inter.prompt}${targetStr}${decoyStr}${tagStr} | 完成后推进第${nextAct}幕】`
        );
      }

      if (parts.length > 0) {
        sections.push(parts.join('\n\n'));
      }
    }

    actBlocks.push(sections.filter(Boolean).join('\n\n'));
  }

  return actBlocks.join('\n\n');
}

function normalizeScreenplayJsonAsStorySource(doc: Record<string, any>): Record<string, any> {
  const clips: any[] = Array.isArray(doc.clips) ? doc.clips : [];
  const startNodeId = doc.storyGraph?.startNodeId || clips[0]?.id || 'c1';

  const normalizedInteractions: any[] = [];
  const normalizedWiring: any[] = [];

  for (let i = 0; i < clips.length; i++) {
    const clip = clips[i];
    const nextClipId = clips[i + 1]?.id;
    const inter = clip.interaction;
    if (inter) {
      const interId = inter.id || `I_${clip.id}`;
      normalizedInteractions.push({
        id: interId,
        clipId: clip.id,
        kind: inter.kind,
        isBranching: inter.isBranching,
        prompt: inter.prompt,
        timeoutSec: inter.timeoutSec ?? null,
        ...(inter.config ? { config: inter.config } : {}),
        outcomes: (inter.outcomes || []).map((o: any) => ({
          key: o.key,
          label: o.label,
          targetNodeId: o.targetNodeId || (o.targetType === 'CONTINUE_MAINLINE' ? nextClipId : undefined),
          targetEndingId: o.targetEndingId,
          stateTag: o.stateTag,
          feedback: o.feedback,
        })),
      });

      normalizedWiring.push({
        from: clip.id,
        onOutcome: 'onEnded',
        to: interId,
      });

      for (const o of inter.outcomes || []) {
        const to = o.targetEndingId || o.targetNodeId || (o.targetType === 'CONTINUE_MAINLINE' ? nextClipId : undefined);
        if (!to) continue;
        normalizedWiring.push({
          from: interId,
          onOutcome: o.key,
          to,
        });
      }
    } else if (nextClipId) {
      normalizedWiring.push({
        from: clip.id,
        onOutcome: 'onEnded',
        to: nextClipId,
      });
    }
  }

  return {
    ...doc,
    startNodeId,
    clips,
    interactions: normalizedInteractions,
    wiring: normalizedWiring,
    scriptMarkdown: renderScreenplayMarkdownFromDocument(doc),
  };
}

export function resolveProjectStorySource(projectId: string): Record<string, any> | undefined {
  const store = ProjectStore.getInstance();

  const screenplayJson = store.getArtifact<Record<string, any>>(projectId, 'screenplay_json');
  if (screenplayJson && Array.isArray(screenplayJson.clips) && screenplayJson.clips.length > 0) {
    return normalizeScreenplayJsonAsStorySource(screenplayJson);
  }

  const screenplayJsonPath = path.join(store.getProjectDir(projectId), 'screenplay.json');
  if (fs.existsSync(screenplayJsonPath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(screenplayJsonPath, 'utf-8'));
      if (parsed && Array.isArray(parsed.clips) && parsed.clips.length > 0) {
        return normalizeScreenplayJsonAsStorySource(parsed);
      }
    } catch {
      // ignore parse error
    }
  }

  return undefined;
}
