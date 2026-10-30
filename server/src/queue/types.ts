/**
 * queue/types.ts
 */

export interface ProgressPayload {
  projectId: string;
  stage: string;
  detail: string;
  percent: number;
  timestamp: string;
}
