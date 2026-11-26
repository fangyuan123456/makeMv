/**
 * tools/review/shared/review-store.ts
 * 1:1 审核档案持久化与指纹新鲜度比对器 (Review Archive Store SSOT)
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { ProjectStore } from '../../../project-store/ProjectStore.js';
import { atomicWriteJsonSync, safeReadJsonSync } from '../../../utils/atomicFile.js';
import type {
  ReviewArchiveRecord,
  ReviewFreshnessView,
  ReviewReport,
} from './schema.js';

export function computeReviewArtifactHash(content: string): string {
  const normalized = (content || '').trim();
  if (!normalized) return '';
  return crypto.createHash('sha256').update(normalized, 'utf-8').digest('hex').slice(0, 16);
}

function getReviewArchivePath(projectId: string, reviewKey: string): string {
  const store = ProjectStore.getInstance();
  const projectDir = store.getProjectDir(projectId);
  return path.join(projectDir, 'reviews', `${reviewKey}.json`);
}

export function readReviewArchive(
  projectId: string,
  reviewKey: string
): ReviewArchiveRecord | null {
  const filePath = getReviewArchivePath(projectId, reviewKey);
  if (!fs.existsSync(filePath)) return null;
  const data = safeReadJsonSync<ReviewArchiveRecord>(filePath);
  if (!data || typeof data.artifactHash !== 'string') return null;
  return data;
}

export function markReviewRunning(
  projectId: string,
  reviewKey: string,
  artifactContent: string
): ReviewArchiveRecord {
  const hash = computeReviewArtifactHash(artifactContent);
  const record: ReviewArchiveRecord = {
    targetType: reviewKey,
    artifactHash: hash,
    artifactSnapshot: artifactContent,
    status: 'reviewing',
    reviewedAt: Date.now(),
  };
  const filePath = getReviewArchivePath(projectId, reviewKey);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  atomicWriteJsonSync(filePath, record);
  return record;
}

export function saveReviewResult(
  projectId: string,
  reviewKey: string,
  expectedHash: string,
  artifactContent: string,
  report: ReviewReport
): ReviewArchiveRecord | null {
  const existing = readReviewArchive(projectId, reviewKey);
  // 防止过时审查结果覆盖较新版本的审查状态
  if (existing && existing.artifactHash && existing.artifactHash !== expectedHash) {
    return null;
  }

  const hasErrors = Array.isArray(report.issues) && report.issues.some((issue) => issue.severity === 'error');
  const record: ReviewArchiveRecord = {
    targetType: reviewKey,
    artifactHash: expectedHash,
    artifactSnapshot: artifactContent,
    status: report.passed && !hasErrors ? 'passed' : 'issues_found',
    reviewedAt: Date.now(),
    report,
  };
  const filePath = getReviewArchivePath(projectId, reviewKey);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  atomicWriteJsonSync(filePath, record);
  return record;
}

export function markReviewFailed(
  projectId: string,
  reviewKey: string,
  expectedHash: string,
  artifactContent: string,
  errorMessage: string
): ReviewArchiveRecord | null {
  const existing = readReviewArchive(projectId, reviewKey);
  if (existing && existing.artifactHash && existing.artifactHash !== expectedHash) {
    return null;
  }

  const record: ReviewArchiveRecord = {
    targetType: reviewKey,
    artifactHash: expectedHash,
    artifactSnapshot: artifactContent,
    status: 'failed',
    reviewedAt: Date.now(),
    error: errorMessage,
  };
  const filePath = getReviewArchivePath(projectId, reviewKey);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  atomicWriteJsonSync(filePath, record);
  return record;
}

export function getReviewWithFreshness(
  projectId: string,
  reviewKey: string,
  currentContent: string
): ReviewFreshnessView {
  const currentHash = computeReviewArtifactHash(currentContent);
  const archive = readReviewArchive(projectId, reviewKey);

  if (!archive) {
    return {
      targetType: reviewKey,
      status: 'idle',
      isStale: Boolean(currentHash),
      currentHash,
    };
  }

  const isStale = Boolean(currentHash) && archive.artifactHash !== currentHash;

  return {
    targetType: reviewKey,
    status: archive.status,
    isStale,
    currentHash,
    artifactHash: archive.artifactHash,
    artifactSnapshot: archive.artifactSnapshot,
    reviewedAt: archive.reviewedAt,
    error: archive.error,
    report: archive.report,
  };
}
