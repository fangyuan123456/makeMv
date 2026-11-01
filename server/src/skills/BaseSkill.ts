/**
 * skills/BaseSkill.ts
 * 技能抽象基类 (BaseSkill SSOT)
 *
 * 核心机制：
 * 1. 自动执行计时与安全异常沙箱；
 * 2. 进度回调适配器 (Progress Adapter)；
 * 3. 严格遵循纯数据流进出 (Data In ➔ Data Out)。
 */

import type { ISkill, SkillManifest, SkillContext, SkillResult } from './types.js';

export abstract class BaseSkill<TParams = any, TData = any> implements ISkill<TParams, TData> {
  public abstract readonly manifest: SkillManifest;

  /**
   * 业务子类必须实现的执行核心
   */
  protected abstract run(context: SkillContext<TParams>): Promise<{ data: TData; summary: string }>;

  /**
   * 统一公共执行门面 (带自动计时与安全阻断)
   */
  public async execute(context: SkillContext<TParams>): Promise<SkillResult<TData>> {
    const startMs = Date.now();

    try {
      if (context.abortSignal?.aborted) {
        throw new Error(`[Skill:${this.manifest.name}] 执行被提前取消`);
      }

      await this.notifyProgress(context, 0, `开始执行技能: ${this.manifest.displayName}...`);

      const { data, summary } = await this.run(context);

      // 🌟 工序重新生成自愈：成功产出新资产后，自动解除会话白板中的旧审查官历史告诫 (隐患七治理)
      if (this.manifest.name !== 'critic-review' && context.sessionId) {
        try {
          const { SessionStore } = await import('../chat/session/SessionStore.js');
          const session = SessionStore.getInstance().getSession(context.projectId, context.sessionId);
          if (session && session.scratchpad.userConstraints) {
            session.scratchpad.userConstraints = session.scratchpad.userConstraints.filter(
              (c) => !c.startsWith('[审查官告诫]')
            );
            SessionStore.getInstance().saveSession(session);
          }
        } catch {
          // 静默降级
        }
      }

      await this.notifyProgress(context, 100, `技能 ${this.manifest.displayName} 执行完毕`);

      return {
        success: true,
        data,
        summary,
        durationMs: Date.now() - startMs,
      };
    } catch (err: any) {
      console.error(`[BaseSkill:${this.manifest.name}] 执行失败:`, err);
      return {
        success: false,
        data: undefined as any,
        summary: `技能执行失败: ${err.message || '未知错误'}`,
        error: err.message || '未知错误',
        durationMs: Date.now() - startMs,
      };
    }
  }

  /**
   * 安全通知执行进度
   */
  protected async notifyProgress(
    context: SkillContext<TParams>,
    percent: number,
    message: string
  ): Promise<void> {
    if (context.onProgress) {
      try {
        await context.onProgress(percent, message);
      } catch (err) {
        console.warn(`[BaseSkill:${this.manifest.name}] 进度通知回调异常:`, err);
      }
    }
  }
}
