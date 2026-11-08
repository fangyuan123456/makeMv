/**
 * project-store/critic-report.ts
 * 审查报告读取边界 (Critic Report Access SSOT)
 *
 * ── 单一真相 ──
 * `critic_review_${stage}` 是**阶段门禁报告**，也是唯一允许参与门禁判定的产物。
 * `criticReports` 是审查工序额外写的一份「最近一次总报告」归档，不区分阶段、
 * 会被 register.ts 在阶段回退时删除；它只供历史查看，**绝不参与判定**。
 *
 * ── 为什么要收口 ──
 * 过去 chat.ts / context-assembler.ts / projects.ts 各写一遍读取，优先级还不一致：
 * 有的读 3 个 key、有的读 2 个，字段上还认 gateDecision / 顶层 overallScore /
 * suggestions / blockingIssues 等别名——而这些别名全仓没有任何写入方。结果是
 * 门禁拦截、导演态势黑板、前端卡片可以就同一个项目给出三个不同结论：当前阶段
 * 报告缺失时静默拿总报告（可能是别的阶段的 PASS）顶替，刚性 FAIL 阻断形同虚设。
 *
 * ── 铁律 ──
 * 1. 不回落：阶段报告不存在就是不存在，返回 null / 'UNKNOWN'，不猜、不借别处的；
 * 2. 不伪装：字段非法/缺失时明确返回 null 并告警，绝不把损坏报告伪装成 'WARN'；
 * 3. 字段契约以 generator/steps/critic-review/schema.ts 为准，这里只做读取侧投影，
 *    刻意不 import 它，避免 project-store 反向依赖生成轨。
 */

import { ProjectStore } from './ProjectStore.js';

/** 审查归档总报告键（写入侧保留，读取侧不用于判定） */
export const CRITIC_ARCHIVE_KEY = 'criticReports';

/** 阶段门禁报告键 */
export function stageCriticReportKey(stage: string): string {
  return `critic_review_${stage}`;
}

/** 质检报告类键位：既不参与门禁判定，也不应进入任务产物清单 */
export function isCriticReportKey(key: string): boolean {
  return (
    key.startsWith('critic_review_') ||
    key === 'critic_review' ||
    key === CRITIC_ARCHIVE_KEY
  );
}

export type GateStatus = 'PASS' | 'WARN' | 'FAIL';
/** UNKNOWN = 该阶段没有有效审查报告，不是「已审查但通过」 */
export type StageGate = GateStatus | 'UNKNOWN';

export interface StageCriticFlaw {
  severity?: string;
  location?: string;
  dimension?: string;
  description?: string;
}

/** 读取侧投影：只暴露 schema 里真实存在的字段 */
export interface StageCriticReport {
  gateStatus: GateStatus;
  overallScore?: number;
  criticalFlaws: StageCriticFlaw[];
  polishSuggestions: string[];
  verdict?: string;
}

const VALID_GATES: GateStatus[] = ['PASS', 'WARN', 'FAIL'];

/**
 * 读取指定阶段的门禁报告。
 * 只读 `critic_review_${stage}`；不存在或不合法一律返回 null，绝不回落到总报告。
 */
export function readStageCriticReport(projectId: string, stage: string): StageCriticReport | null {
  const raw = ProjectStore.getInstance().getArtifact<any>(projectId, stageCriticReportKey(stage));
  if (!raw || typeof raw !== 'object') return null;

  if (!VALID_GATES.includes(raw.gateStatus)) {
    console.warn(
      `[CriticReport] 项目 [${projectId}] 阶段 [${stage}] 的审查报告 gateStatus 缺失或非法 ` +
        `(${String(raw.gateStatus)})，按「无有效审查」处理，绝不伪装成 WARN`
    );
    return null;
  }

  const score = raw.scores?.overallScore;
  return {
    gateStatus: raw.gateStatus,
    overallScore: typeof score === 'number' && Number.isFinite(score) ? score : undefined,
    criticalFlaws: Array.isArray(raw.criticalFlaws) ? raw.criticalFlaws : [],
    polishSuggestions: Array.isArray(raw.polishSuggestions) ? raw.polishSuggestions : [],
    verdict: typeof raw.verdict === 'string' ? raw.verdict : undefined,
  };
}

/** 门禁判定唯一入口：无报告返回 'UNKNOWN'，调用方只在 'FAIL' 时阻断 */
export function readStageGate(projectId: string, stage: string): StageGate {
  return readStageCriticReport(projectId, stage)?.gateStatus ?? 'UNKNOWN';
}
