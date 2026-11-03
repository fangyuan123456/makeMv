/**
 * utils/projectLock.ts
 * 基于项目 ID 的异步并发互斥锁 (Project Mutex SSOT)
 * 
 * 职责：
 * 彻底杜绝并发 approve 或重复触发导致的双重计费与写盘冲突。
 */

export class ProjectLockManager {
  private static instance?: ProjectLockManager;
  private locks: Map<string, Promise<void>> = new Map();

  public static getInstance(): ProjectLockManager {
    if (!ProjectLockManager.instance) {
      ProjectLockManager.instance = new ProjectLockManager();
    }
    return ProjectLockManager.instance;
  }

  /**
   * 在指定 projectId 的互斥锁下执行异步任务
   */
  public async withLock<T>(projectId: string, task: () => Promise<T>): Promise<T> {
    const currentLock = this.locks.get(projectId) || Promise.resolve();

    let releaseLock: () => void;
    const nextLock = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });

    // 链接队列
    this.locks.set(projectId, currentLock.then(() => nextLock));

    try {
      await currentLock;
      return await task();
    } finally {
      releaseLock!();
      // 如果当前没有后续锁在等待，清理 map
      if (this.locks.get(projectId) === nextLock) {
        this.locks.delete(projectId);
      }
    }
  }

  /**
   * 检查指定项目是否当前正处于加锁执行中
   */
  public isLocked(projectId: string): boolean {
    return this.locks.has(projectId);
  }
}
