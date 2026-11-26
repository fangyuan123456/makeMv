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

const store = ProjectStore.getInstance();

export const saveScreenplay = (req: Request, res: Response) => {
  try {
    const projectId = req.params.id;
    const { screenplay } = req.body || {};

    if (typeof screenplay !== 'string' || !screenplay.trim()) {
      return sendError(res, 400, '剧本正文不能为空');
    }

    const projectDir = store.getProjectDir(projectId);
    store.setArtifact(projectId, 'screenplay', screenplay);
    fs.writeFileSync(path.join(projectDir, 'screenplay.md'), screenplay, 'utf-8');
    recordScreenplayUpdated(projectId);

    const screenplayReview = getReviewWithFreshness(projectId, SCREENPLAY_REVIEW_KEY, screenplay);

    res.json({
      success: true,
      screenplay,
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
