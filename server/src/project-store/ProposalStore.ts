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
import type { ActionProposal, ActionProposalStatus, ProposalProgress } from '../types/index.js';

export class ProposalStore {
  private static instance?: ProposalStore;
  private cache = new Map<string, Map<string, ActionProposal>>();

  public static getInstance(): ProposalStore {
    if (!ProposalStore.instance) {
      ProposalStore.instance = new ProposalStore();
    }
    return ProposalStore.instance;
  }

  public static setInstance(store: ProposalStore): void {
    ProposalStore.instance = store;
  }

  private validateProjectId(projectId: string): void {
    if (!projectId || typeof projectId !== 'string' || !/^[a-zA-Z0-9_\-]+$/.test(projectId)) {
      throw new Error(`[ProposalStore] 非法的 projectId: "${projectId}"，必须仅包含字母、数字、下划线或连字符`);
    }
    if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(projectId.trim())) {
      throw new Error(`[ProposalStore] 非法的 projectId: "${projectId}"，属于操作系统保留设备名称`);
    }
  }

  private getProposalsFile(projectId: string): string {
    this.validateProjectId(projectId);
    const baseProjectsDir = path.resolve(config.paths.projects);
    const dir = path.resolve(baseProjectsDir, projectId);
    if (!dir.startsWith(baseProjectsDir + path.sep)) {
      throw new Error(`[ProposalStore] 非法项目路径穿越访问: ${projectId}`);
    }
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    return path.join(dir, 'proposals.json');
  }

  private loadProposals(projectId: string): Map<string, ActionProposal> {
    this.validateProjectId(projectId);
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

  /**
   * 滚动裁剪终态历史提案：
   * 1. 100% 绝对保留所有 pending 状态的待办提案；
   * 2. 对已处于终态 (executed / dismissed / failed) 的提案，按保留上限（默认最多 30 条）裁剪更早历史，防止 proposals.json 无限膨胀。
   */
  private pruneTerminalProposals(map: Map<string, ActionProposal>, maxTerminal: number = 30): void {
    const terminalList: Array<{ id: string; time: number }> = [];

    for (const [id, proposal] of map.entries()) {
      if (proposal.status !== 'pending') {
        let time = 0;
        const timeStr = proposal.executedAt || proposal.failedAt || proposal.createdAt;
        if (timeStr) {
          time = new Date(timeStr).getTime();
        } else {
          const match = id.match(/prop_(\d+)/);
          time = match ? parseInt(match[1], 10) : 0;
        }
        terminalList.push({ id, time });
      }
    }

    if (terminalList.length > maxTerminal) {
      terminalList.sort((a, b) => a.time - b.time);
      const toDeleteCount = terminalList.length - maxTerminal;
      for (let i = 0; i < toDeleteCount; i++) {
        map.delete(terminalList[i].id);
      }
    }
  }

  private persist(projectId: string): void {
    this.validateProjectId(projectId);
    const map = this.cache.get(projectId);
    if (!map) return;
    this.pruneTerminalProposals(map);
    const list = Array.from(map.values());
    const file = this.getProposalsFile(projectId);
    try {
      atomicWriteJsonSync(file, list);
    } catch (err) {
      console.error(`[ProposalStore] 持久化提案失败: ${file}`, err);
      throw err;
    }
  }

  /**
   * 保存或更新行动提案
   */
  public saveProposal(projectId: string, proposal: ActionProposal): void {
    this.validateProjectId(projectId);
    if (!proposal || !proposal.actionId || typeof proposal.actionId !== 'string') {
      throw new Error('[ProposalStore] saveProposal 失败: proposal.actionId 必须为非空有效字符串');
    }
    const map = this.loadProposals(projectId);
    const prev = map.get(proposal.actionId);
    map.set(proposal.actionId, proposal);
    try {
      this.persist(projectId);
    } catch (err) {
      if (prev === undefined) {
        map.delete(proposal.actionId);
      } else {
        map.set(proposal.actionId, prev);
      }
      throw err;
    }
  }

  /**
   * 获取指定提案
   */
  public getProposal(projectId: string, actionId: string): ActionProposal | undefined {
    this.validateProjectId(projectId);
    this.cache.delete(projectId);
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
    this.validateProjectId(projectId);
    // 强制穿透读取最新磁盘持久化数据
    this.cache.delete(projectId);
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
   * 原子更新提案状态 (executed | dismissed | failed)
   */
  public updateProposalStatus(
    projectId: string,
    actionId: string,
    status: ActionProposalStatus,
    extra?: {
      startedAt?: string;
      executedAt?: string;
      failedAt?: string;
      lastMessage?: string;
      progress?: ProposalProgress;
      resultSummary?: string;
      description?: string;
      error?: string;
    }
  ): ActionProposal | undefined {
    this.validateProjectId(projectId);
    const map = this.loadProposals(projectId);
    const existing = map.get(actionId);
    if (!existing) return undefined;

    existing.status = status;
    if (extra?.startedAt) existing.startedAt = extra.startedAt;
    if (extra?.executedAt) existing.executedAt = extra.executedAt;
    if (extra?.failedAt) existing.failedAt = extra.failedAt;
    if (extra?.lastMessage) existing.lastMessage = extra.lastMessage;
    if (extra?.progress) existing.progress = extra.progress;
    if (extra?.resultSummary) existing.resultSummary = extra.resultSummary;
    if (extra?.description) existing.description = extra.description;
    if (extra?.error) existing.error = extra.error;

    this.persist(projectId);
    return existing;
  }

  /**
   * 批量将指定阶段的挂起门禁提案标记为已解除 (cleared/dismissed)
   * 遵循法典：零别名冗余，单一事实来源，统一使用 proposal.payload?.stage
   */
  public dismissProposalsForStage(
    projectId: string,
    stage: string,
    reason?: string
  ): number {
    this.validateProjectId(projectId);
    const map = this.loadProposals(projectId);
    let dismissedCount = 0;
    for (const proposal of map.values()) {
      if (
        proposal.status === 'pending' &&
        (Boolean(proposal.isGateIntercept) || proposal.actionType === 'CRITIC_DEBATE' || proposal.skill === 'critic-review') &&
        proposal.payload?.stage === stage
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

  /**
   * 清除指定项目或全部缓存 (主要用于测试沙箱清理)
   */
  public clearCache(projectId?: string): void {
    if (projectId) {
      this.cache.delete(projectId);
    } else {
      this.cache.clear();
    }
  }
}
