/**
 * agents/director/constants.ts
 * 工序常量中立出口 (Neutral Constants Re-export)
 *
 * 为什么要有这一层：catalog.ts 是中立的工序目录 SSOT，但它的派生量叫
 * DERIVED_STAGE_OF_SKILL 这类内部名。业务侧（修改轨、导演提示词、API 路由）
 * 只需要 STAGE_OF_SKILL 这种稳定别名，不该为了拿别名而去 import
 * generator/constants.js —— 那会让「修改轨运行时依赖生成轨目录」。
 *
 * 依赖方向：
 *   generator ──┐
 *   modifier  ──┼──→ constants（本文件）──→ catalog（中立 SSOT）
 *   api / 脚本 ─┘
 *
 * 本文件零业务依赖、零执行体，任何一条轨都可以安全引用。
 */

export {
  SKILL_CATALOG,
  getSkillMeta,
  getSkillMetaByStage,
  buildLegalStepsPromptText,
  DERIVED_STAGE_SEQUENCE as STAGE_SEQUENCE,
  DERIVED_STAGE_TRANSITION_MAP as STAGE_TRANSITION_MAP,
  DERIVED_STAGE_OF_SKILL as STAGE_OF_SKILL,
  DERIVED_SKILL_OF_STAGE as SKILL_OF_STAGE,
  DERIVED_SKILL_TITLES as SKILL_TITLES,
  type SkillMeta,
} from './catalog.js';
