/**
 * agents/director/catalog.ts
 * 影视工序目录 (Skill Catalog SSOT) —— 中立元数据层
 *
 * 定位：只描述「有哪些工序、属于哪个阶段、什么位序、叫什么名字」，
 * 不持有任何执行体（生成轨的 Mastra Step、修改轨的 Modifier）。
 *
 * 依赖方向：
 *   generator ──┐
 *               ├──→ constants.ts（中立别名出口）──→ catalog（本文件，零业务依赖）
 *   modifier  ──┘
 *   api / 脚本 ─┘
 * 两条路线各自向自己的注册表登记执行体，彼此之间不存在横向 import；
 * 编排层单独放在 orchestration/，它才可以同时依赖两轨。
 */

import { WorkflowStage, STAGE_SEQUENCE } from '../../types/index.js';

export interface SkillMeta {
  /** 唯一工序标识符（如 'story-bible'） */
  key: string;
  /** 所属业务阶段 */
  stage: WorkflowStage;
  /** 标准工序名称 */
  title: string;
  /** 流水线位序（0..N，负数表示非顺向流水线如独立切面审查） */
  order: number;
  /** 是否属于 0 到 1 顺向批量生产流水线 */
  isPipelineStep: boolean;
  /** 是否需要人工审批授权 */
  requireConfirmation?: boolean;
  /** 导演标准作业程序指引 (SOP Guide) */
  sopGuide?: string;
  /** 该工序核心审查与打磨关注点 */
  reviewFocus?: string;
}

/**
 * 全流程标准工序目录（权威 SSOT）
 */
export const SKILL_CATALOG: SkillMeta[] = [
  {
    key: 'story-bible',
    stage: WorkflowStage.NARRATIVE_DESIGN,
    title: '叙事架构 (Story Bible)',
    order: 0,
    isPipelineStep: true,
    requireConfirmation: false,
    sopGuide:
      '导演工作重心：从电影视角提炼故事核心主线与大致剧情走向，确立核心冲突、主角动机与视听影调基调；为后续工序确立清晰的故事主干（切勿过早锁定具体分支抉择与结局细节，分支由后续工序顺向推演），引导创作者开启叙事架构制作。',
    reviewFocus: '故事主干走向、核心冲突与视听基调',
  },
  {
    key: 'character-portrait',
    stage: WorkflowStage.CHARACTER_DESIGN,
    title: '角色定妆 (Character Portrait)',
    order: 1,
    isPipelineStep: true,
    requireConfirmation: false,
    sopGuide:
      '核心任务：敲定核心角色的电影级视觉定妆，包含面部特写、服饰质感、道具细节与光影基调；确保角色形象具有高辨识度与后续分镜一致性。',
    reviewFocus: '核心角色面容定妆、服饰质感与银幕气质',
  },
  {
    key: 'scene-script',
    stage: WorkflowStage.SCENE_SCRIPT,
    title: '分场文学剧本 (Scene Script)',
    order: 2,
    isPipelineStep: true,
    requireConfirmation: false,
    sopGuide:
      '核心任务：将世界观细化为场次文学剧本，精确描写环境光影、动作节拍、潜台词与观众互动抉择选项（Choices）；明确每个选项导致的情感波动与分支流向。',
    reviewFocus: '分场剧情节拍、台词潜台词与互动抉择走向',
  },
  {
    key: 'storyboard',
    stage: WorkflowStage.STORYBOARD,
    title: '视听镜头分镜 (Storyboard)',
    order: 3,
    isPipelineStep: true,
    requireConfirmation: false,
    sopGuide:
      '核心任务：电影工业级视听分镜解构，明确景别（远/全/中/近/特）、机位角度、运镜轨迹（推拉摇移升降）、视线匹配与动态时长节拍。',
    reviewFocus: '镜头景别构图、机位视角与运镜动势',
  },
  {
    key: 'keyframe-reference',
    stage: WorkflowStage.KEYFRAME_REFERENCE,
    title: '关键帧参考图 (Keyframe Reference)',
    order: 4,
    isPipelineStep: true,
    requireConfirmation: false,
    sopGuide:
      '核心任务：生成每个镜头的电影级高保真起始关键帧参考图，统一色彩科学、光影基调与角色视觉锚点，为动态视频生成提供绝对稳定的基准画面。',
    reviewFocus: '起始关键帧构图、光影基准与色彩基调',
  },
  {
    key: 'video-production',
    stage: WorkflowStage.VIDEO_PRODUCTION,
    title: '动态视频切片 (Video Production)',
    order: 5,
    isPipelineStep: true,
    requireConfirmation: false,
    sopGuide:
      '核心任务：基于分镜首帧与运镜提示词，调度物理视频算力生成高一致性动态视频切片，把控运动幅度与连贯性，消除角色形变与物理幻觉。',
    reviewFocus: '切片动态幅度、运镜轨迹与物理连贯性',
  },
  {
    key: 'critic-review',
    stage: WorkflowStage.NARRATIVE_DESIGN, // 切面审计贯穿全生命周期，默认关联
    title: '独立审查质检 (Critic Review)',
    order: -1, // 切面审查，不参与顺向 0 到 1 批量生产流水线
    isPipelineStep: false,
    requireConfirmation: false,
    reviewFocus: '各工序资产完整度、多维评分与门禁裁决',
  },
  {
    key: 'fmv-packaging',
    stage: WorkflowStage.FMV_PACKAGING,
    title: '互动母带打包 (FMV Packaging)',
    order: 6,
    isPipelineStep: true,
    requireConfirmation: false,
    sopGuide:
      '核心任务：装配所有视听切片与互动抉择节点，生成完整的互动影游母带（FMV Packaging）并核验可交互图谱的连通性。',
    reviewFocus: '全片互动拓扑连通性、母带封装与沉浸体验',
  },
];

/** 按 key 获取工序目录项 */
export function getSkillMeta(key: string): SkillMeta | undefined {
  return SKILL_CATALOG.find((m) => m.key === key);
}

/** 按 stage 获取主责工序目录项 */
export function getSkillMetaByStage(stage: WorkflowStage): SkillMeta | undefined {
  return SKILL_CATALOG.find((m) => m.stage === stage && m.isPipelineStep);
}

// -------------------------------------------------------------
// 派生层：全部由 SKILL_CATALOG 动态推导，禁止手写死字典
// -------------------------------------------------------------

/** 严格按位序排序的顺向法定流水线工序 */
const pipelineSkills = SKILL_CATALOG.filter((m) => m.isPipelineStep && m.order >= 0).sort(
  (a, b) => a.order - b.order
);

/** 自动派生：标准工序阶段序列 */
export const DERIVED_STAGE_SEQUENCE: WorkflowStage[] = pipelineSkills.map((m) => m.stage);

// 一致性护栏：目录派生的阶段序列必须与领域类型层声明的序列完全一致，
// 任何一方增删工序都会在启动时立刻暴露，避免两条事实来源静默漂移。
if (DERIVED_STAGE_SEQUENCE.join(',') !== STAGE_SEQUENCE.join(',')) {
  console.warn(
    '[SkillCatalog] 阶段序列与 types.STAGE_SEQUENCE 不一致，请同步工序目录：\n' +
      `  catalog: ${DERIVED_STAGE_SEQUENCE.join(', ')}\n` +
      `  types  : ${STAGE_SEQUENCE.join(', ')}`
  );
}

/** 自动派生：工序到下一阶段的权威推进映射表 */
export const DERIVED_STAGE_TRANSITION_MAP: Record<string, WorkflowStage> = {};
for (let i = 0; i < pipelineSkills.length; i++) {
  const current = pipelineSkills[i];
  const next = pipelineSkills[i + 1];
  DERIVED_STAGE_TRANSITION_MAP[current.key] = next ? next.stage : WorkflowStage.COMPLETED;
}

/** 自动派生：各技能对应的法定工序阶段 */
export const DERIVED_STAGE_OF_SKILL: Record<string, WorkflowStage> = {};
for (const m of SKILL_CATALOG) {
  DERIVED_STAGE_OF_SKILL[m.key] = m.stage;
}

/** 自动派生：工序阶段对应的主责技能 */
export const DERIVED_SKILL_OF_STAGE: Record<string, string> = {};
for (const m of pipelineSkills) {
  DERIVED_SKILL_OF_STAGE[m.stage] = m.key;
}

/** 自动派生：各工序工业标准显示标题 */
export const DERIVED_SKILL_TITLES: Record<string, string> = {};
for (const m of SKILL_CATALOG) {
  DERIVED_SKILL_TITLES[m.key] = `生成${m.title}`;
}
if (DERIVED_SKILL_TITLES['critic-review']) {
  DERIVED_SKILL_TITLES['critic-review'] = '审查官多维质检评估 (Critic Review)';
}

/**
 * 动态渲染 Prompt 中的法定工序列表文本
 */
export function buildLegalStepsPromptText(): string {
  return SKILL_CATALOG.map((m, idx) => `${idx + 1}. ${m.key} (${m.title})`).join('\n');
}
