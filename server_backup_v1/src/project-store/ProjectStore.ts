/**
 * project-store/ProjectStore.ts
 * 全局唯一状态黑板单例门面 (ProjectStore Singleton SSOT)
 *
 * 核心机制：
 * 1. 唯一单例入口 ProjectStore.getInstance()；
 * 2. 任何模块均可凭唯一单例 + projectId 访问完整项目数据状态；
 * 3. 彻底消灭 Agent、Stage、Tool 与编排层之间的对象层层传递。
 */

import type { IProjectStateStore } from './IProjectStateStore.js';
import { FileProjectStateStore } from './FileProjectStateStore.js';

export class ProjectStore {
  private static instance: IProjectStateStore;

  /**
   * 获取全局唯一项目状态黑板实例
   */
  public static getInstance(): IProjectStateStore {
    if (!ProjectStore.instance) {
      ProjectStore.instance = new FileProjectStateStore();
    }
    return ProjectStore.instance;
  }

  /**
   * 替换全局单例实现 (如在测试环境无缝注入 MemoryProjectStateStore)
   */
  public static setInstance(store: IProjectStateStore): void {
    ProjectStore.instance = store;
  }
}
