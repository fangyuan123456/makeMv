/**
 * agents/director/modifier/source-resolver.ts
 * 修改源头裁决器 (Modify Source Resolver SSOT)
 *
 * ── 为什么需要它 ──
 * 修改请求进来时只有一个真问题：「这个事实最早由哪份产物定义？」
 * 定义了它的那份产物就是源头，改源头、下游自然失效重推。
 *
 * 旧实现把这个问题拆散在三处各猜一遍（意图 prompt 的工序表、entity-resolver 的
 * 阶段启发式、chat.ts 的降级 if），任一处猜错就靠下一层兜底打补丁，典型症状：
 * 「男一太老了吧」被判成角色定妆（图像轨）→ 图像轨只能重画图、改不了年龄设定
 * → 重画出来的角色依旧偏老，而 UI 话术宣称「已调整年龄」。
 *
 * ── 裁决原则（自顶向下，短路返回）──
 * 1. 事实源头优先：实体能在文本产物里定位到 → 交给文本轨。文本轨一次可同步
 *    故事圣经 / 剧本 / 分镜三份产物，且成功后引擎会自动失效其下游媒体资产，
 *    「改源头 + 下游重推」一次闭环。
 * 2. 图像/视频永远不是事实源：媒体轨只负责「这张图/这段片子本身的样式」，
 *    任何涉及年龄、身份、性格、剧情的诉求都不能从媒体轨改起。
 * 3. 判不出来时默认走文本源（宁可上游改宽一点，也不要把事实改动丢在图像轨）。
 * 4. 文本源都没有产物（项目刚建）→ no-source，由调用方降级为生成提案。
 */

import { WorkflowStage, STAGE_SEQUENCE } from '../../../types/index.js';
import { ProjectStore } from '../../../project-store/ProjectStore.js';
import { SKILL_OF_STAGE, STAGE_OF_SKILL } from '../generator/constants.js';

export type ModifySourceBasis = 'text-source' | 'media-asset' | 'no-source';

export interface ModifyPlan {
  /** 事实源头工序（text 轨三份产物共用同一个修改器实例） */
  sourceSkill: string;
  /** 源头工序所属阶段 */
  sourceStage: WorkflowStage;
  /** 判定依据，便于日志与线上复盘 */
  basis: ModifySourceBasis;
  /** 源头之后已落盘、修改成功后将失效并需重推的下游阶段 */
  cascadeStages: WorkflowStage[];
  /** 人类可读的判定说明 */
  reason: string;
}

export interface ModifySourceInput {
  /** 微调目标实体（角色名 / 场次号 / 镜号，可为空） */
  target?: string;
  /** 具体诉求文本 */
  content?: string;
  /** 项目当前阶段 */
  currentStage: WorkflowStage;
  /** 大模型给出的工序建议，仅作参考，不具裁决权 */
  skillHint?: string;
}

/* ─── 文本产物 = 事实定义处（按事实演进顺序：故事圣经 → 剧本 → 分镜） ─── */

interface TextSource {
  skill: string;
  stage: WorkflowStage;
  matches: (artifact: any, target: string) => boolean;
}

function looseEq(a: string, b: string): boolean {
  if (!a || !b) return false;
  return a === b || a.includes(b) || b.includes(a);
}

const TEXT_SOURCES: TextSource[] = [
  {
    skill: 'story-bible',
    stage: WorkflowStage.NARRATIVE_DESIGN,
    // 角色（姓名/身份）、幕结构、剧情节点标题 —— 全剧设定的事实定义处
    matches: (art, t) => {
      const chars: any[] = Array.isArray(art?.characters) ? art.characters : [];
      if (chars.some((c) => looseEq(String(c?.name || '').toLowerCase(), t) || looseEq(String(c?.role || '').toLowerCase(), t))) {
        return true;
      }
      const acts: any[] = Array.isArray(art?.goldenSpine) ? art.goldenSpine : [];
      if (acts.some((a) => looseEq(String(a?.name || '').toLowerCase(), t))) return true;
      const nodes: any[] = Array.isArray(art?.storyGraph?.nodes) ? art.storyGraph.nodes : [];
      return nodes.some((n) => looseEq(String(n?.title || '').toLowerCase(), t) || looseEq(String(n?.id || '').toLowerCase(), t));
    },
  },
  {
    skill: 'scene-script',
    stage: WorkflowStage.SCENE_SCRIPT,
    matches: (art, t) => {
      const scenes: any[] = Array.isArray(art?.scenes) ? art.scenes : [];
      return scenes.some(
        (s) => looseEq(String(s?.sceneId || '').toLowerCase(), t) || looseEq(String(s?.title || '').toLowerCase(), t)
      );
    },
  },
  {
    skill: 'storyboard',
    stage: WorkflowStage.STORYBOARD,
    matches: (art, t) => {
      const shots: any[] = Array.isArray(art?.shots) ? art.shots : [];
      return shots.some((s) => looseEq(String(s?.shotId || '').toLowerCase(), t));
    },
  },
];

/* ─── 关键词兜底（仅在黑板实体定位失败时使用） ─── */

/** 设定事实诉求：命中即必须从文本源改，禁止落到媒体轨 */
const FACT_HINTS = [
  '年龄', '岁数', '太老', '太年轻', '更年轻', '年纪', '性别', '姓名', '名字', '身份', '职业',
  '性格', '动机', '人设', '关系', '背景故事', '前世', '剧情', '情节', '结局', '分支', '世界观', '设定',
];

/** 纯视觉样式诉求：媒体轨的合法入口 */
const STYLE_HINTS = [
  '配色', '色调', '颜色', '服装', '衣服', '外套', '发型', '妆容', '化妆', '背景', '构图',
  '光影', '质感', '材质', '风格', '重画', '重绘', '重新出图', '换一张', '更亮', '更暗', '更冷', '更暖',
];

/** 明确指向媒体资产的词 → 对应工序 */
const MEDIA_KEYWORDS: Array<{ skill: string; words: string[] }> = [
  { skill: 'video-production', words: ['视频', '成片', '片子', '片段', '运镜节奏', '镜头语言'] },
  { skill: 'keyframe-reference', words: ['关键帧', '参考图', '概念图', '画面稿'] },
  { skill: 'character-portrait', words: ['定妆', '定妆照', '形象照', '角色图', '人像'] },
];

const MEDIA_STAGE: Record<string, WorkflowStage> = {
  'character-portrait': WorkflowStage.CHARACTER_DESIGN,
  'keyframe-reference': WorkflowStage.KEYFRAME_REFERENCE,
  'video-production': WorkflowStage.VIDEO_PRODUCTION,
};

function containsAny(haystack: string, needles: string[]): boolean {
  return needles.some((n) => haystack.includes(n));
}

/** 源头之后的已落盘阶段：这些资产在源头变更后必然过期，需要按序重推 */
function computeCascade(artifacts: Record<string, any>, sourceStage: WorkflowStage): WorkflowStage[] {
  const from = STAGE_SEQUENCE.indexOf(sourceStage);
  if (from < 0) return [];
  return STAGE_SEQUENCE.slice(from + 1).filter((stage) => Boolean(artifacts[stage]));
}

function buildPlan(
  artifacts: Record<string, any>,
  sourceSkill: string,
  sourceStage: WorkflowStage,
  basis: ModifySourceBasis,
  reason: string
): ModifyPlan {
  return {
    sourceSkill,
    sourceStage,
    basis,
    cascadeStages: basis === 'no-source' ? [] : computeCascade(artifacts, sourceStage),
    reason,
  };
}

/**
 * 唯一裁决入口：给定修改诉求，回答「从哪份产物改起」。
 */
export function resolveModifySource(projectId: string, input: ModifySourceInput): ModifyPlan {
  const project = ProjectStore.getInstance().getProject(projectId);
  const artifacts: Record<string, any> = project?.stageArtifacts || {};
  const target = (input.target || '').trim().toLowerCase();
  const content = (input.content || '').trim().toLowerCase();

  // 1. 事实源头定位：按事实演进顺序扫描文本产物，最早定义该实体的那份即源头
  if (target) {
    for (const src of TEXT_SOURCES) {
      const art = artifacts[src.stage];
      if (!art) continue;
      if (src.matches(art, target)) {
        return buildPlan(
          artifacts,
          src.skill,
          src.stage,
          'text-source',
          `实体「${input.target}」由 ${src.skill} 定义，改动从事实源头起`
        );
      }
    }
  }

  // 2. 诉求属设定事实 → 故事圣经（全剧设定源）。图像/视频永远不是事实源
  if (containsAny(content, FACT_HINTS)) {
    const bible = artifacts[WorkflowStage.NARRATIVE_DESIGN];
    if (bible) {
      return buildPlan(
        artifacts,
        'story-bible',
        WorkflowStage.NARRATIVE_DESIGN,
        'text-source',
        '诉求属设定事实（年龄/身份/剧情等），从设定源头故事圣经改起'
      );
    }
  }

  // 3. 纯视觉样式 + 目标媒体资产已落盘 → 媒体轨
  if (containsAny(content, STYLE_HINTS)) {
    const picked = pickMediaSkill(input.skillHint, content, artifacts);
    if (picked) {
      return buildPlan(
        artifacts,
        picked,
        MEDIA_STAGE[picked],
        'media-asset',
        `纯视觉样式诉求，且 ${picked} 已有落盘资产`
      );
    }
  }

  // 4. 兜底：仍以文本源为准（宁可上游改宽，不把事实改动丢到图像轨）
  const fallbackStage =
    (artifacts[WorkflowStage.NARRATIVE_DESIGN] && WorkflowStage.NARRATIVE_DESIGN) ||
    (artifacts[WorkflowStage.SCENE_SCRIPT] && WorkflowStage.SCENE_SCRIPT) ||
    (artifacts[WorkflowStage.STORYBOARD] && WorkflowStage.STORYBOARD) ||
    undefined;

  if (fallbackStage) {
    return buildPlan(
      artifacts,
      SKILL_OF_STAGE[fallbackStage] || 'story-bible',
      fallbackStage,
      'text-source',
      '诉求无法直接对应媒体资产，回到最近的文本事实源'
    );
  }

  // 5. 连文本产物都没有（项目刚创建）→ 无源可改
  const curSkill = SKILL_OF_STAGE[input.currentStage] || 'story-bible';
  return {
    sourceSkill: curSkill,
    sourceStage: input.currentStage,
    basis: 'no-source',
    cascadeStages: [],
    reason: '项目尚无任何已落盘文本产物，无法执行微调',
  };
}

/** 从 hint / 关键词 / 已落盘媒体资产中挑一个媒体工序 */
function pickMediaSkill(
  skillHint: string | undefined,
  content: string,
  artifacts: Record<string, any>
): string | undefined {
  const isReady = (skill: string) => Boolean(artifacts[MEDIA_STAGE[skill]]);

  if (skillHint && MEDIA_STAGE[skillHint] && isReady(skillHint)) return skillHint;

  for (const entry of MEDIA_KEYWORDS) {
    if (containsAny(content, entry.words) && isReady(entry.skill)) return entry.skill;
  }

  // 只有唯一一个已落盘媒体资产时，才能无歧义地指向它
  const ready = Object.keys(MEDIA_STAGE).filter(isReady);
  return ready.length === 1 ? ready[0] : undefined;
}

/** 供外层复用的阶段→工序反查 */
export function skillOfStage(stage: WorkflowStage): string | undefined {
  return SKILL_OF_STAGE[stage];
}

/** 供外层复用的工序→阶段反查 */
export function stageOfSkill(skill: string): WorkflowStage | undefined {
  return STAGE_OF_SKILL[skill];
}
