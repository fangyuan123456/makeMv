/**
 * skills/SkillRegistry.ts
 * 全局技能注册与发现中心 (Skill Registry SSOT)
 *
 * 核心机制：
 * 1. 单例维护所有就绪技能插件；
 * 2. 支持按技能名称、所属工序与分类查询；
 * 3. 动态生成可供 AI 导演感知的 Skills Manifest 提示词段落。
 */

import type { ISkill, SkillManifest } from './types.js';

export class SkillRegistry {
  private static instance?: SkillRegistry;
  private skills = new Map<string, ISkill>();

  public static getInstance(): SkillRegistry {
    if (!SkillRegistry.instance) {
      SkillRegistry.instance = new SkillRegistry();
    }
    return SkillRegistry.instance;
  }

  /**
   * 注册技能插件
   */
  public register(skill: ISkill): void {
    const name = skill.manifest.name;
    if (this.skills.has(name)) {
      console.warn(`[SkillRegistry] 覆盖已存在的技能: ${name}`);
    }
    this.skills.set(name, skill);
    console.log(`[SkillRegistry] 🛠️ 成功加载技能: [${name}] - ${skill.manifest.displayName}`);
  }

  /**
   * 获取指定技能
   */
  public get<TParams = any, TData = any>(name: string): ISkill<TParams, TData> | undefined {
    return this.skills.get(name);
  }

  /**
   * 获取所有技能清单
   */
  public list(): SkillManifest[] {
    return Array.from(this.skills.values()).map((s) => s.manifest);
  }

  /**
   * 获取指定工序关联的技能 (独立审查官属于全局通用门禁技能，在所有阶段均可见)
   */
  public listForStage(stage: string): SkillManifest[] {
    return this.list().filter((m) => m.targetStage === stage || m.category === 'critic');
  }

  /**
   * 格式化生成注入给 Director 提示词的可用技能清单
   */
  public formatSkillsForPrompt(): string {
    const list = this.list();
    if (list.length === 0) return '';

    const lines = list.map(
      (s) => `* **${s.name}** (${s.displayName}) [工序: ${s.targetStage}]: ${s.description}`
    );

    return `\n\n════════════════════════════════════════════════════════════════\n` +
      `🧰【AI 导演当前已挂载的外挂影视技能包清单 (Skills Available)】\n` +
      `当你与创作者推敲成熟、需要进入重型生产时，可根据以下清单向创作者提出对应的行动提案 (ActionProposal)：\n` +
      lines.join('\n') +
      `\n════════════════════════════════════════════════════════════════\n`;
  }
}
