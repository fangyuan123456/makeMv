/**
 * project-store/ProposalStore.ts
 * 独立行动提案持久化管理仓库 (Proposal Store SSOT)
 *
 * 单一职责：
 * 将 ActionProposal 提升为项目一等公民实体，独立持久化落盘，
 * 彻底消灭在多轮消息流中倒序遍历查找回标的反模式。
 */

import fs from 'fs';
import path from 'path';
import { config } from '../utils/config.js';
import { atomicWriteJsonSync } from '../utils/index.js';
import type { ActionProposal, ActionProposalStatus } from '../chat/session/types.js';

export class ProposalStore {
  private static instance?: ProposalStore;
  private cache = new Map<string, Map<string, ActionProposal>>();

  public static getInstance(): ProposalStore {
    if (!ProposalStore.instance) {
      ProposalStore.instance = new ProposalStore();
    }
    return ProposalStore.instance;
  }

  private getProposalsFile(projectId: string): string {
    const dir = path.join(config.paths.projects, projectId);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    return path.join(dir, 'proposals.json');
  }

  private loadProposals(projectId: string): Map<string, ActionProposal> {
    if (this.cache.has(projectId)) {
      return this.cache.get(projectId)!;
    }

    const file = this.getProposalsFile(projectId);
    const map = new Map<string, ActionProposal>();
    if (fs.existsSync(file)) {
      try {
        const raw = fs.readFileSync(file, 'utf-8');
        const list = JSON.parse(raw) as ActionProposal[];
        if (Array.isArray(list)) {
          for (const item of list) {
            if (item.actionId) map.set(item.actionId, item);
          }
        }
      } catch (err) {
        console.warn(`[ProposalStore] 加载提案持久化文件失败: ${file}`, err);
      }
    }
    this.cache.set(projectId, map);
    return map;
  }

  private persist(projectId: string): void {
    const map = this.cache.get(projectId);
    if (!map) return;
    const list = Array.from(map.values());
    const file = this.getProposalsFile(projectId);
    try {
      atomicWriteJsonSync(file, list);
    } catch (err) {
      console.error(`[ProposalStore] 持久化提案失败: ${file}`, err);
    }
  }

  /**
   * 保存或更新行动提案
   */
  public saveProposal(projectId: string, proposal: ActionProposal): void {
    const map = this.loadProposals(projectId);
    map.set(proposal.actionId, proposal);
    this.persist(projectId);
  }

  /**
   * 获取指定提案
   */
  public getProposal(projectId: string, actionId: string): ActionProposal | undefined {
    const map = this.loadProposals(projectId);
    return map.get(actionId);
  }

  /**
   * 查询提案列表
   */
  public listProposals(
    projectId: string,
    filter?: { status?: ActionProposalStatus; stage?: string }
  ): ActionProposal[] {
    const map = this.loadProposals(projectId);
    let list = Array.from(map.values());
    if (filter?.status) {
      list = list.filter((p) => p.status === filter.status);
    }
    if (filter?.stage) {
      list = list.filter((p) => p.payload?.stage === filter.stage);
    }
    return list;
  }

  /**
   * 原子更新提案状态 (executed | dismissed)
   */
  public updateProposalStatus(
    projectId: string,
    actionId: string,
    status: ActionProposalStatus,
    extra?: { executedAt?: string; failedAt?: string; resultSummary?: string; description?: string; error?: string }
  ): ActionProposal | undefined {
    const map = this.loadProposals(projectId);
    const existing = map.get(actionId);
    if (!existing) return undefined;

    existing.status = status;
    if (extra?.executedAt) existing.executedAt = extra.executedAt;
    if (extra?.failedAt) existing.failedAt = extra.failedAt;
    if (extra?.resultSummary) existing.resultSummary = extra.resultSummary;
    if (extra?.description) existing.description = extra.description;
    if (extra?.error) existing.error = extra.error;

    this.persist(projectId);
    return existing;
  }

  /**
   * 批量将指定阶段的挂起门禁提案标记为已解除 (cleared/dismissed)
   */
  public dismissProposalsForStage(
    projectId: string,
    stage: string,
    reason?: string
  ): number {
    const map = this.loadProposals(projectId);
    let dismissedCount = 0;
    for (const proposal of map.values()) {
      if (
        proposal.status === 'pending' &&
        (proposal.actionId.startsWith('act_gate_intercept_') || proposal.skill === 'critic-review') &&
        (!proposal.payload?.stage || proposal.payload?.stage === stage)
      ) {
        proposal.status = 'dismissed';
        if (reason) proposal.description = reason;
        dismissedCount++;
      }
    }
    if (dismissedCount > 0) {
      this.persist(projectId);
    }
    return dismissedCount;
  }
}
