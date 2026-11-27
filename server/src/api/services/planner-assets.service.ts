import fs from 'node:fs';
import path from 'node:path';
import type { Request, Response } from 'express';
import { ProjectStore } from '../../project-store/ProjectStore.js';
import { recordScreenplayUpdated } from '../../project-store/freshness.js';
import {
  getReviewWithFreshness,
  markReviewRunning,
} from '../../tools/review/shared/review-store.js';
import {
  SCREENPLAY_REVIEW_KEY,
  triggerScreenplayReviewAsync,
} from '../../tools/review/screenplay-review/index.js';
import { sendError } from '../helpers.js';
import {
  buildStructuredScreenplayDocument,
  parseScreenplayMarkdownToStructured,
} from '../../tools/planner/screenplay-tool/steps/02-screenplay/renderer.js';
import { renderScreenplayMarkdownFromDocument } from '../../project-store/story-source.js';

const store = ProjectStore.getInstance();

export const saveScreenplay = (req: Request, res: Response) => {
  try {
    const projectId = req.params.id;
    const { screenplay, actUpdate, endingUpdates } = req.body || {};

    const projectDir = store.getProjectDir(projectId);
    const existingJson =
      store.getArtifact<any>(projectId, 'screenplay_json') ||
      (() => {
        const p = path.join(projectDir, 'screenplay.json');
        if (!fs.existsSync(p)) return undefined;
        try {
          return JSON.parse(fs.readFileSync(p, 'utf-8'));
        } catch {
          return undefined;
        }
      })();

    const outline =
      store.getArtifact<any>(projectId, 'outline') ||
      (() => {
        const p = path.join(projectDir, 'outline.json');
        if (!fs.existsSync(p)) return undefined;
        try {
          return JSON.parse(fs.readFileSync(p, 'utf-8'));
        } catch {
          return undefined;
        }
      })() ||
      existingJson;

    // 方式 1：前端结构化单幕 / 终局卡片保存（直接更新 screenplay.json）
    if (actUpdate && typeof actUpdate.actNumber === 'number' && outline && Array.isArray(outline.actOutlines)) {
      const baseMarkdown =
        (existingJson ? renderScreenplayMarkdownFromDocument(existingJson) : '') ||
        store.getArtifact<string>(projectId, 'screenplay') ||
        '';
      const baseStructured =
        existingJson && Array.isArray(existingJson.acts)
          ? {
              acts: existingJson.acts,
              endings: (existingJson.endings || []).map((e: any) => ({
                actNumber: e.actNumber,
                outcomeKey: e.outcomeKey,
                endingTitle: e.title || e.endingTitle,
                endingType: e.endingType,
                narrativeText: e.summary || e.narrativeText || '',
              })),
            }
          : parseScreenplayMarkdownToStructured(baseMarkdown, outline);

      const updatedActs = baseStructured.acts.map((a: any) =>
        a.actNumber === actUpdate.actNumber
          ? {
              ...a,
              sceneHeader: typeof actUpdate.sceneHeader === 'string' && actUpdate.sceneHeader.trim()
                ? actUpdate.sceneHeader.trim()
                : a.sceneHeader,
              narrativeBody: typeof actUpdate.narrativeBody === 'string'
                ? actUpdate.narrativeBody.trim()
                : a.narrativeBody,
            }
          : a
      );

      const endingPatchList: any[] = Array.isArray(endingUpdates) ? endingUpdates : [];
      const updatedEndings = baseStructured.endings.map((e: any) => {
        const match = endingPatchList.find(
          (u) =>
            u.actNumber === e.actNumber &&
            String(u.outcomeKey || '').trim().toUpperCase() === String(e.outcomeKey || '').trim().toUpperCase()
        );
        return match && typeof match.narrativeText === 'string'
          ? { ...e, narrativeText: match.narrativeText.trim() }
          : e;
      });

      const screenplayDocument = buildStructuredScreenplayDocument(outline, {
        acts: updatedActs,
        endings: updatedEndings,
      });
      const { scriptMarkdown: renderedMarkdown, ...persistedScreenplayJson } = screenplayDocument;

      store.setArtifact(projectId, 'screenplay_json', persistedScreenplayJson);
      fs.writeFileSync(path.join(projectDir, 'screenplay.json'), JSON.stringify(persistedScreenplayJson, null, 2), 'utf-8');
      store.setArtifact(projectId, 'screenplay', renderedMarkdown);
      recordScreenplayUpdated(projectId);

      const screenplayReview = getReviewWithFreshness(projectId, SCREENPLAY_REVIEW_KEY, renderedMarkdown);
      return res.json({
        success: true,
        screenplay: renderedMarkdown,
        screenplayJson: persistedScreenplayJson,
        storyGraph: persistedScreenplayJson.storyGraph,
        screenplayReview,
      });
    }

    // 方式 2：全文 Markdown 兜底保存（有 outline 时自动解析重建 screenplay.json）
    if (typeof screenplay !== 'string' || !screenplay.trim()) {
      return sendError(res, 400, '剧本正文不能为空');
    }

    let finalMarkdown = screenplay;
    let savedJson = existingJson;
    if (outline && Array.isArray(outline.actOutlines) && Array.isArray(outline.interactions)) {
      const parsed = parseScreenplayMarkdownToStructured(screenplay, outline);
      const screenplayDocument = buildStructuredScreenplayDocument(outline, parsed);
      const { scriptMarkdown: renderedMarkdown, ...persistedScreenplayJson } = screenplayDocument;
      finalMarkdown = renderedMarkdown;
      savedJson = persistedScreenplayJson;
      store.setArtifact(projectId, 'screenplay_json', persistedScreenplayJson);
      fs.writeFileSync(path.join(projectDir, 'screenplay.json'), JSON.stringify(persistedScreenplayJson, null, 2), 'utf-8');
    }

    store.setArtifact(projectId, 'screenplay', finalMarkdown);
    recordScreenplayUpdated(projectId);

    const screenplayReview = getReviewWithFreshness(projectId, SCREENPLAY_REVIEW_KEY, finalMarkdown);

    res.json({
      success: true,
      screenplay: finalMarkdown,
      screenplayJson: savedJson,
      storyGraph: savedJson?.storyGraph,
      screenplayReview,
    });
  } catch (err: any) {
    sendError(res, 500, err.message);
  }
};

export const triggerScreenplayReview = (req: Request, res: Response) => {
  try {
    const projectId = req.params.id;
    const bodyScreenplay = typeof req.body?.screenplay === 'string' ? req.body.screenplay : undefined;
    const content = (
      bodyScreenplay ??
      store.getArtifact<string>(projectId, 'screenplay') ??
      ''
    ).trim();

    if (!content) {
      return sendError(res, 400, '当前项目暂无剧本正文，无法发起审查');
    }

    markReviewRunning(projectId, SCREENPLAY_REVIEW_KEY, content);
    triggerScreenplayReviewAsync(projectId, content);

    const screenplayReview = getReviewWithFreshness(projectId, SCREENPLAY_REVIEW_KEY, content);
    res.json({
      success: true,
      screenplayReview,
    });
  } catch (err: any) {
    sendError(res, 500, err.message);
  }
};
