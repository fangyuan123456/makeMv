/**
 * skills/BaseSkill.ts
 * 技能抽象基类 (BaseSkill Microkernel SSOT)
 *
 * 核心机制：
 * 1. 自动执行计时与安全异常沙箱；
 * 2. 进度回调适配器 (Progress Adapter)；
 * 3. 严格遵循纯数据流进出 (Data In ➔ Data Out)；
 * 4. 🌟 基类统一模板方法托管存储副作用：
 *    - 自动将成功产物沉淀至状态黑板 (setArtifact，且严格隔离 critic_review 与业务工序，杜绝资产误覆写)；
 *    - 权威工序资产反向同步至备忘录白板 (消除白板设定漂移与滞后)；
 *    - 自动解除白板旧审查官告诫；
 *    - 阶段推进权能唯一收拢至创作者确认推进门禁 (消灭技能暗度陈仓造成的双重跳阶段)。
 */

import { ProjectStore } from '../project-store/ProjectStore.js';
import { ChatMemoryManager } from '../chat/memory/ChatMemoryManager.js';
import { CriticReviewerAgent } from '../agents/reviewer/CriticReviewerAgent.js';
import type { ISkill, SkillManifest, SkillContext, SkillResult } from './types.js';

export abstract class BaseSkill<TParams = any, TData = any> implements ISkill<TParams, TData> {
  public abstract readonly manifest: SkillManifest;

  /**
   * 业务子类必须实现的纯计算执行核心 (Pure Data In ➔ Data Out)
   */
  protected abstract run(context: SkillContext<TParams>): Promise<{ data: TData; summary: string }>;

  /**
   * 统一公共执行门面 (带自动计时、副作用统一托管与安全阻断)
   */
  public async execute(context: SkillContext<TParams>): Promise<SkillResult<TData>> {
    const startMs = Date.now();

    try {
      if (!context || !context.projectId) {
        throw new Error(`[Skill:${this.manifest.name}] 执行失败: 缺少 projectId 参数`);
      }

      // 规范化入参，防止业务子类解构空指针
      context.params = (context.params || {}) as TParams;

      if (context.abortSignal?.aborted) {
        throw new Error(`[Skill:${this.manifest.name}] 执行被提前取消`);
      }

      await this.notifyProgress(context, 0, `开始执行技能: ${this.manifest.displayName}...`);

      // 1. 执行纯业务算子
      const { data, summary } = await this.run(context);

      const projectStore = ProjectStore.getInstance();

      // 2. 🌟 统一副作用托管：自动将成功产物沉淀至状态黑板 (SSOT)
      if (data !== undefined) {
        if (this.manifest.category === 'critic') {
          // 🌟 质检资产严格隔离：存入 critic_review 专用槽位，绝对禁止覆写业务工序资产 (StoryBible等)
          projectStore.setArtifact(context.projectId, 'critic_review', data);
        } else if (this.manifest.targetStage) {
          projectStore.setArtifact(context.projectId, this.manifest.targetStage, data);

          // 3. 🌟 权威工序资产反向同步至备忘录白板 (消除白板设定漂移与滞后)
          if (context.sessionId) {
            try {
              ChatMemoryManager.getInstance().syncAuthoritativeArtifactsToScratchpad(
                context.projectId,
                context.sessionId,
                { [this.manifest.targetStage]: data }
              );
            } catch (syncErr) {
              console.warn('[BaseSkill] 权威资产反向同步白板警告:', syncErr);
            }
          }

          // 4. 🌟 产物重新生成或自愈后，自动解除旧门禁阻断卡片 (会话消息与独立库双更新 SSOT)
          try {
            CriticReviewerAgent.getInstance().dismissGateIntercepts(
              context.projectId,
              this.manifest.targetStage,
              `[🛡️ 门禁已由产物重新生成解除] 工序【${this.manifest.displayName}】产物已更新，历史质检报告已自动失效。`
            );
          } catch (propErr) {
            console.warn('[BaseSkill] 解除旧门禁提案警告:', propErr);
          }
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
        summary: `技能执行失败: ${err.message || String(err)}`,
        durationMs: Date.now() - startMs,
        error: err.message || String(err),
      };
    }
  }

  /**
   * 刚性执行门面 (Fail-Fast: 失败直接抛出异常，绝不把异常检查推诿给调用方自觉)
   */
  public async executeOrThrow(
    context: SkillContext<TParams>
  ): Promise<{ data: TData; summary: string; durationMs: number }> {
    const res = await this.execute(context);
    if (!res.success) {
      throw new Error(`[BaseSkill:${this.manifest.name}] 技能执行未收敛: ${res.error || res.summary}`);
    }
    return { data: res.data, summary: res.summary, durationMs: res.durationMs };
  }

  /**
   * 安全通知进度
   */
  protected async notifyProgress(context: SkillContext<TParams>, percent: number, message: string): Promise<void> {
    if (context.onProgress) {
      try {
        await context.onProgress(percent, message);
      } catch (err) {
        console.warn(`[BaseSkill:${this.manifest.name}] 进度通知异常:`, err);
      }
    }
  }
}
