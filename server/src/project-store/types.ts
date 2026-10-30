/**
 * project-store/types.ts
 * 项目状态快照与黑板数据契约 (Project State SSOT)
 */

import type { WorkflowSession } from '../contracts/index.js';

export interface ProjectStateSnapshot {
  project: WorkflowSession;
  projectDir: string;
  updatedAt: string;
}
