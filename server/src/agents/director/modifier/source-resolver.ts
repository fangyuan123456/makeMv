/**
 * agents/director/modifier/source-resolver.ts
 * 修改源头裁决器 (Modify Source Resolver SSOT)
 *
 * ── 问题定义 ──
 * 一条修改请求里有两个互相独立的变量：
 *   WHO  —— 改谁（张明 / 第 3 场 / shot_1 / 这张定妆图）
 *   WHAT —— 改它的哪一类属性（年龄？台词？运镜？发型？画面？）
 *
 * 源头由 WHAT 决定，不由 WHO 决定：同一个「张明」，年龄写在故事圣经、台词写在
 * 分场剧本、发型写在定妆照。若把 WHO 当源头判据（旧版「实体最早出现的产物」），
 * 「改台词」「改发型」「调光影」会被一律拽回故事圣经——改完台词没变、图没换，
 * 而 UI 却宣称已调整。这正是 8 个真实场景里 5 个判错的根因。
 *
 * ── 裁决顺序（短路返回）──
 * 1. 视觉观感副词（显得 / 看起来 / 看上去）→ 视觉轨：谈的是画面观感，不是设定数值
 * 2. 设定事实（年龄/性别/身份/性格/人物关系/剧情走向/结局）→ story-bible
 * 3. 台词与场次内容（台词/对白/语气/第 N 场）→ scene-script
 * 4. 镜头语言（景别/运镜/构图/时长/shot_x）→ storyboard
 * 5. 角色客观外观（发型/发色/服装/妆容/伤疤/体型…）→ story-bible 的 appearance
 *    （只有带「这张/这一版」等指示词时才降为画面呈现，见 PRESENTATION_ANCHORS）
 * 6. 画面呈现（光影/色调/质感/画风…）→ 媒体轨
 * 7. 媒体对象直指（定妆照/关键帧/这段视频）+ 该资产已落盘 → 对应媒体工序
 * 8. 属性词一个都没命中（unknown）→ 交给 attribute-classifier 补判一次类别
 *    （词表是闭集、创作者表达是开集，unknown 只说明词表没收录，不说明没有属性）
 * 9. 仍未命中 → 用 WHO 在黑板的文本产物里定位条目
 * 10. 仍判不出 → 当前阶段主责工序（绝不是「最早的文本源」）
 * 11. 无任何文本产物 → no-source，由调用方降级为生成提案
 *
 * 目标工序未落盘时按显式上游链降级（台词还没写出来只能先改设定，镜头没拆只能
 * 先改台词）。任何情况下都不会把设定事实丢给只能改画面的媒体轨。
 */

import { WorkflowStage, STAGE_SEQUENCE } from '../../../types/index.js';
import { ProjectStore } from '../../../project-store/ProjectStore.js';
import { SKILL_OF_STAGE } from '../generator/constants.js';
import {
  classifyModifyAttribute,
  isAttributeClassifierEnabled,
  type AttributeClassification,
  type AttributeClassifier,
} from './attribute-classifier.js';

export type ModifySourceBasis = 'text-source' | 'media-asset' | 'no-source';

/** 诉求触及的属性类别，用于日志复盘与测试断言 */
export type ModifyAttribute =
  | 'setting'
  | 'appearance'
  | 'dialogue'
  | 'shot'
  | 'visual'
  | 'media'
  | 'unknown';


export interface ModifyPlan {
  /** 事实源头工序（text 轨三份产物共用同一个修改器实例） */
  sourceSkill: string;
  /** 源头工序所属阶段 */
  sourceStage: WorkflowStage;
  /** 判定依据，便于日志与线上复盘 */
  basis: ModifySourceBasis;
  /** 判定的属性类别 */
  attribute: ModifyAttribute;
  /**
   * 源头之后已落盘、修改成功后将过期需重推的下游阶段。
   * 仅用于事前日志预估——真实清退以修改轨上报的 changedStages 为准
   * （一次文本修改可能横跨三份产物，按单一源头推会删掉刚写好的东西）。
   */
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
  /**
   * 属性补判开关（仅测试/特殊调用方用）：
   *   不传 → 走默认实现（受 isAttributeClassifierEnabled 控制）
   *   传函数 → 用注入的分类器
   *   传 null → 本次禁用模型补判，只用规则
   */
  classify?: AttributeClassifier | null;
}

/* ─── 属性词表：决定 WHAT，从而决定源头 ─── */

/** 视觉观感副词：命中说明创作者在谈画面观感，不是设定数值 */
const LOOK_WORDS = ['显得', '看起来', '看上去', '看着', '视觉上', '观感', '太老', '太年轻', '显老', '显年轻'];

/** 设定事实：全剧唯一，只写在故事圣经 */
const SETTING_WORDS = [
  '年龄', '岁数', '多少岁', '年纪', '性别', '姓名', '名字', '身份', '职业',
  '人设', '性格', '脾气', '动机', '背景故事', '身世', '世界观', '主线',
  '剧情走向', '结局', '分支', '人物关系', '改成反派', '改成主角', '改成配角',
];

/** 台词与场次内容：写在分场剧本 */
const DIALOGUE_WORDS = [
  '台词', '对白', '说话', '语气', '口吻', '独白', '旁白', '场次内容',
  '场面调度', '走位', '场景描述', '这场戏', '那场戏',
];
const DIALOGUE_ANCHORS = [
  /第[一二三四五六七八九十百零两\d]+场/,
  /scene[_-]?\d+/,
  /这场/,
  /那场/,
];

/** 镜头语言：写在视听分镜 */
const SHOT_WORDS = [
  '景别', '运镜', '构图', '机位', '角度', '时长', '切分', '转场',
  '特写', '近景', '中景', '远景', '全景', '推镜', '拉镜', '摇镜', '跟拍', '拆分镜',
];
const SHOT_ANCHORS = [/shot[_-]?\d+/, /第[一二三四五六七八九十百零两\d]+镜/, /这个镜头/, /那个镜头/];

/**
 * 角色客观外观：这些是角色自身的属性，写在故事圣经的 characters[].appearance 里，
 * 定妆 visualPrompt 只是它的派生。只改 visualPrompt 会在下次重新生成时被打回原样
 * ——这正是「改了等于没改」的来源，所以外观改动必须落到事实源头。
 * 唯一例外：带「这张 / 这一版」等指示词时，创作者明确只要这一版画面不同。
 */
const APPEARANCE_WORDS = [
  '发型', '头发', '发色', '短发', '长发', '寸头', '辫子', '刘海', '平头', '卷发',
  '胡须', '胡子', '服装', '衣服', '外套', '旗袍', '西装', '造型', '形象', '长相',
  '五官', '脸型', '妆容', '化妆', '妆造', '伤疤', '疤痕', '纹身', '体型', '身材',
  '胖瘦', '眼镜', '配饰', '穿着', '打扮',
];

/** 指示词：明确指向「当前这一版画面」，此时外观类诉求降为呈现诉求 */
const PRESENTATION_ANCHORS = [/这张/, /这一版/, /这套图/, /这个图/, /当前这/, /这版/];

/** 画面呈现：属于「这一张怎么拍/怎么渲染」，不是角色属性，媒体轨的合法入口 */
const STYLE_WORDS = [
  '色调', '配色', '颜色', '光影', '打光', '布光', '质感', '材质', '画风', '风格',
  '背景色', '更亮', '更暗', '更冷', '更暖', '更精致', '更粗糙', '景深', '虚化', '氛围感',
  // 画面瑕疵：说「糊 / 不清晰」谈的是这一版画面质量，不是角色外观
  '模糊', '发虚', '不清晰', '清晰度', '有点糊',
  // 成片节奏：剪辑与节奏只存在于视频轨，不是镜头语言（镜头语言是景别/运镜）
  '节奏', '剪辑', '成片节奏', '剪辑节奏',
];

/** 媒体对象：直接指名某张图 / 某段片子 */
const MEDIA_OBJECTS: Array<{ skill: string; words: string[] }> = [
  { skill: 'character-portrait', words: ['定妆', '定妆照', '形象照', '角色图', '人物图', '人像'] },
  { skill: 'keyframe-reference', words: ['关键帧', '参考图', '概念图', '画面稿', '分镜图', '首帧'] },
  { skill: 'video-production', words: ['视频', '成片', '片子', '片段', '短片', '镜头语言'] },
];

/**
 * 媒体名词遮蔽：判外观与画面之前，先把「定妆照 / 形象照 / 关键帧」这类指代资产
 * 本身的名词抹掉。
 *
 * 不遮蔽就会踩这个坑：「形象照有点糊」里「形象」命中外观词表 → 判成 appearance
 * → 回故事圣经改角色外观，而创作者说的是这一张图有瑕疵（该重出图）。
 * 遮蔽后归属交给真正携带属性的那个词：「定妆发型换寸头」靠「发型」落到外观，
 * 「定妆照的光影」靠「光影」落到画面，「形象照有点糊」靠「糊」落到画面。
 */
const MEDIA_NOUNS = MEDIA_OBJECTS.flatMap((m) => m.words).sort((a, b) => b.length - a.length);

function maskMediaNouns(text: string): string {
  let masked = text;
  for (const noun of MEDIA_NOUNS) masked = masked.split(noun).join('□');
  return masked;
}

/** 画面呈现的落点细分：同一张图 / 某一帧 / 成片节奏 */
const VISUAL_SUBJECT: Array<{ skill: string; words: string[] }> = [
  {
    skill: 'character-portrait',
    words: ['定妆', '人像', '角色图', '人物图'],
  },
  {
    skill: 'keyframe-reference',
    words: ['光影', '打光', '布光', '色调', '配色', '颜色', '质感', '材质', '画风', '风格', '背景色', '更亮', '更暗', '更冷', '更暖', '景深', '虚化'],
  },
  {
    skill: 'video-production',
    words: ['运镜节奏', '剪辑', '转场', '节奏', '镜头语言'],
  },
];

/** 媒体动作：重出图 / 重渲染，本身不携带属性信息 */
const MEDIA_VERBS = ['重画', '重绘', '重新出图', '重新生成图', '重渲染', '换一张', '再出一版', '重新出片', '重拍'];

const MEDIA_STAGE: Record<string, WorkflowStage> = {
  'character-portrait': WorkflowStage.CHARACTER_DESIGN,
  'keyframe-reference': WorkflowStage.KEYFRAME_REFERENCE,
  'video-production': WorkflowStage.VIDEO_PRODUCTION,
};

/**
 * 目标工序未落盘时的显式上游降级链。
 * 刻意不用「沿 STAGE_SEQUENCE 往前找」——CHARACTER_DESIGN 排在 SCENE_SCRIPT 之前，
 * 线性回退会让「改台词」在剧本未落盘时误降级到角色定妆。
 */
const UPSTREAM_CHAIN: Record<string, WorkflowStage[]> = {
  'scene-script': [WorkflowStage.NARRATIVE_DESIGN],
  storyboard: [WorkflowStage.SCENE_SCRIPT, WorkflowStage.NARRATIVE_DESIGN],
  'character-portrait': [WorkflowStage.NARRATIVE_DESIGN],
  'keyframe-reference': [WorkflowStage.STORYBOARD, WorkflowStage.SCENE_SCRIPT, WorkflowStage.NARRATIVE_DESIGN],
  'video-production': [WorkflowStage.STORYBOARD, WorkflowStage.SCENE_SCRIPT, WorkflowStage.NARRATIVE_DESIGN],
};

/* ─── 工具 ─── */

function containsAny(haystack: string, needles: string[]): string | undefined {
  return needles.find((n) => haystack.includes(n));
}

function matchAny(haystack: string, patterns: RegExp[]): string | undefined {
  return patterns.find((p) => p.test(haystack))?.source;
}

/** 实体名匹配：单字目标不参与包含匹配，避免「K」匹配到「麦克」这类泛化误命中 */
function looseEq(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.length < 2 || b.length < 2) return false;
  return a.includes(b) || b.includes(a);
}

function computeCascade(artifacts: Record<string, any>, sourceStage: WorkflowStage): WorkflowStage[] {
  const from = STAGE_SEQUENCE.indexOf(sourceStage);
  if (from < 0) return [];
  return STAGE_SEQUENCE.slice(from + 1).filter((stage) => Boolean(artifacts[stage]));
}

/* ─── 属性判定 ─── */

interface AttributeVerdict {
  attribute: ModifyAttribute;
  hit?: string;
}

function detectAttribute(content: string): AttributeVerdict {
  const c = content.toLowerCase();
  // 外观与画面的判定要先抹掉媒体名词，否则「形象照」里的「形象」会把诉求拽回设定
  const factual = maskMediaNouns(c);

  const setting = containsAny(c, SETTING_WORDS);
  const look = containsAny(c, LOOK_WORDS);
  const explicitRewrite = /改成|改为|设为|调成|变成|变回|\d/.test(c);
  // 观感副词本身即一类诉求（「让她别那么显老」），单独出现就要走画面；
  // 与设定词共存时，只有明确改写动作或数值才认作设定改写（「年龄改成 30 岁」）
  if (look && (!setting || !explicitRewrite)) {
    return { attribute: 'visual', hit: look };
  }
  if (setting) return { attribute: 'setting', hit: setting };

  const dialogue = containsAny(c, DIALOGUE_WORDS) || matchAny(c, DIALOGUE_ANCHORS);
  if (dialogue) return { attribute: 'dialogue', hit: dialogue };

  const shot = containsAny(c, SHOT_WORDS) || matchAny(c, SHOT_ANCHORS);
  if (shot) return { attribute: 'shot', hit: shot };

  // 角色客观外观：默认是事实（写进故事圣经 appearance）；带「这张/这一版」时降为呈现
  const appearance = containsAny(factual, APPEARANCE_WORDS);
  if (appearance && !matchAny(c, PRESENTATION_ANCHORS)) {
    return { attribute: 'appearance', hit: appearance };
  }

  const style = containsAny(factual, STYLE_WORDS);
  if (style) return { attribute: 'visual', hit: style };

  const mediaVerb = containsAny(c, MEDIA_VERBS);
  if (mediaVerb) return { attribute: 'media', hit: mediaVerb };

  return { attribute: 'unknown' };
}

/* ─── WHO 定位：仅在第 7 步兜底时使用 ─── */

const WHO_SOURCES: Array<{
  skill: string;
  stage: WorkflowStage;
  matches: (artifact: any, target: string) => boolean;
}> = [
  {
    skill: 'story-bible',
    stage: WorkflowStage.NARRATIVE_DESIGN,
    matches: (art, t) => {
      const chars: any[] = Array.isArray(art?.characters) ? art.characters : [];
      if (chars.some((x) => looseEq(String(x?.name || '').toLowerCase(), t) || looseEq(String(x?.role || '').toLowerCase(), t))) {
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
        (s) => looseEq(String(s?.sceneId || '').toLowerCase(), t) || looseEq(String(s?.sceneTitle || s?.title || '').toLowerCase(), t)
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

/** 上游链降级：目标工序未落盘时返回最近的有产物的上游 */
function degradeToReady(
  artifacts: Record<string, any>,
  targetSkill: string
): { skill: string; stage: WorkflowStage } | undefined {
  for (const stage of UPSTREAM_CHAIN[targetSkill] || []) {
    if (artifacts[stage]) {
      return { skill: SKILL_OF_STAGE[stage] || 'story-bible', stage };
    }
  }
  return undefined;
}

/**
 * 唯一裁决入口：给定修改诉求，回答「从哪份产物改起」。
 */
export async function resolveModifySource(projectId: string, input: ModifySourceInput): Promise<ModifyPlan> {
  const project = ProjectStore.getInstance().getProject(projectId);
  const artifacts: Record<string, any> = project?.stageArtifacts || {};
  const content = (input.content || '').trim().toLowerCase();
  const target = (input.target || '').trim().toLowerCase();

  const plan = (
    skill: string,
    stage: WorkflowStage,
    basis: ModifySourceBasis,
    attribute: ModifyAttribute,
    reason: string
  ): ModifyPlan => ({
    sourceSkill: skill,
    sourceStage: stage,
    basis,
    attribute,
    cascadeStages: basis === 'no-source' ? [] : computeCascade(artifacts, stage),
    reason,
  });

  /** 目标工序没产物时降级到上游；连上游都没有则交回调用方 */
  const settle = (
    skill: string,
    stage: WorkflowStage,
    basis: ModifySourceBasis,
    attribute: ModifyAttribute,
    reason: string
  ): ModifyPlan | undefined => {
    if (artifacts[stage]) return plan(skill, stage, basis, attribute, reason);
    const up = degradeToReady(artifacts, skill);
    if (!up) return undefined;
    return plan(
      up.skill,
      up.stage,
      'text-source',
      attribute,
      `${reason}；但 ${skill} 尚无产物，先改上游 ${up.skill}`
    );
  };

  /**
   * 属性类别 → 源头工序。
   * 返回 undefined 只有两种情形：类别是 unknown（无从判断），或画面类诉求既无
   * 已落盘媒体资产、也没有可承载它的文本产物——这两种都要继续往后兜底。
   */
  const applyAttribute = (
    attribute: ModifyAttribute,
    hit: string | undefined,
    via: 'rule' | 'llm'
  ): ModifyPlan | undefined => {
    const label = via === 'llm' ? `${hit || attribute}（模型补判）` : hit;

    switch (attribute) {
      case 'setting':
        return (
          settle('story-bible', WorkflowStage.NARRATIVE_DESIGN, 'text-source', 'setting',
            `诉求属设定事实（${label}），必须从设定源头故事圣经改起`) ?? noSource(input, artifacts)
        );
      case 'appearance':
        return (
          settle('story-bible', WorkflowStage.NARRATIVE_DESIGN, 'text-source', 'appearance',
            `诉求属角色客观外观（${label}），写在故事圣经的角色档案里；定妆只是它的派生，` +
            `只改画面会在下次重新生成时被打回原样`) ?? noSource(input, artifacts)
        );
      case 'dialogue':
        return (
          settle('scene-script', WorkflowStage.SCENE_SCRIPT, 'text-source', 'dialogue',
            `诉求落在台词与场次内容（${label}），源头是分场剧本`) ?? noSource(input, artifacts)
        );
      case 'shot':
        return (
          settle('storyboard', WorkflowStage.STORYBOARD, 'text-source', 'shot',
            `诉求落在镜头语言（${label}），源头是视听分镜`) ?? noSource(input, artifacts)
        );
      case 'visual':
      case 'media': {
        const picked = pickMediaSkill(input.skillHint, content, artifacts, target);
        if (picked) {
          return plan(
            picked,
            MEDIA_STAGE[picked],
            'media-asset',
            attribute,
            `诉求属画面表现（${label}）且 ${picked} 已有落盘资产，走媒体轨`
          );
        }
        // 媒体资产还没生成：画面描述此时只存在于文本产物里，按诉求对象改最近的文本源
        // （人物外观最早写在角色设定里；画面观感最早写在分镜的画面描述里）
        const mediaHint = VISUAL_SUBJECT.find((e) => containsAny(content, e.words))?.skill;
        const textCandidates =
          mediaHint === 'character-portrait'
            ? [WorkflowStage.NARRATIVE_DESIGN]
            : [WorkflowStage.STORYBOARD, WorkflowStage.SCENE_SCRIPT, WorkflowStage.NARRATIVE_DESIGN];
        const textStage = textCandidates.find((s) => artifacts[s]);
        if (textStage) {
          return plan(
            SKILL_OF_STAGE[textStage] || 'story-bible',
            textStage,
            'text-source',
            attribute,
            `诉求属画面表现（${label}），但相关媒体资产尚未生成，改记录该描述的上游文本`
          );
        }
        return undefined;
      }
      default:
        return undefined;
    }
  };

  // 1-5. 按属性类别定位源头（属性优先于实体）
  const verdict = detectAttribute(content);
  const rulePlan = applyAttribute(verdict.attribute, verdict.hit, 'rule');
  if (rulePlan) return rulePlan;

  // 5.5 unknown 补判：词表是闭集、创作者表达是开集，unknown 只说明词表没收录，
  // 不说明这条诉求没有属性。让模型只回答「六类里哪一类」，回来走同一条 applyAttribute，
  // 裁决规则本身没有任何放权（WHO 与阶段定位依旧由本地逻辑决定）。
  if (verdict.attribute === 'unknown') {
    const guessed = await classifyByModel(input, content);
    if (guessed && guessed !== 'unknown') {
      const llmPlan = applyAttribute(guessed, guessed, 'llm');
      if (llmPlan) return llmPlan;
    }
  }

  // 6. 媒体对象直指 + 已落盘（无属性词时也能精确命中）
  const mediaByObject = pickMediaSkill(input.skillHint, content, artifacts, target);
  if (mediaByObject && containsAny(content, MEDIA_OBJECTS.flatMap((m) => m.words))) {
    return plan(
      mediaByObject,
      MEDIA_STAGE[mediaByObject],
      'media-asset',
      'media',
      `诉求直指媒体资产（${mediaByObject}），且该资产已落盘`
    );
  }

  // 7. WHO 定位：属性实在说不清时，用实体在文本产物里的条目位置判源头
  if (target) {
    for (const src of WHO_SOURCES) {
      if (artifacts[src.stage] && src.matches(artifacts[src.stage], target)) {
        return plan(
          src.skill,
          src.stage,
          'text-source',
          'unknown',
          `未能识别属性类别，按实体「${input.target}」所在的文本产物定位到 ${src.skill}`
        );
      }
    }
  }

  // 8. 兜底：当前阶段的主责工序（工作面在哪儿就从哪儿改，而不是最老的文本源）
  const curSkill = SKILL_OF_STAGE[input.currentStage];
  if (curSkill && artifacts[input.currentStage]) {
    return plan(curSkill, input.currentStage, 'text-source', 'unknown',
      '诉求无法归类，回到当前工作面所属工序');
  }
  const upFromCurrent = curSkill ? degradeToReady(artifacts, curSkill) : undefined;
  if (upFromCurrent) {
    return plan(upFromCurrent.skill, upFromCurrent.stage, 'text-source', 'unknown',
      '诉求无法归类，且当前阶段无产物，改最近的上游文本源');
  }

  // 9. 连文本产物都没有（项目刚创建）
  return noSource(input, artifacts);
}

/* ─── 属性补判（unknown 时才会走到） ─── */

/** 默认分类器：受开关控制，模型不可用/超时/解析失败一律返回 undefined */
const defaultClassifier: AttributeClassifier = async (req) => {
  if (!isAttributeClassifierEnabled()) return undefined;
  return classifyModifyAttribute(req);
};

/**
 * 取一次模型补判结果。任何异常都吞掉并返回 undefined——补判只能加分，
 * 不允许因为它挂了就把原本能走通的修改卡死。
 */
async function classifyByModel(
  input: ModifySourceInput,
  content: string
): Promise<ModifyAttribute | undefined> {
  if (input.classify === null) return undefined;
  const classifier = input.classify ?? defaultClassifier;
  try {
    const res: AttributeClassification | undefined = await classifier({
      content: input.content || content,
      target: input.target,
    });
    if (!res) return undefined;
    if (res.attribute === 'unknown') return undefined;
    if (Number.isFinite(res.confidence) && res.confidence < 0.5) {
      console.warn(`[Modifier] 属性补判置信度过低（${res.confidence}），回落规则兜底`);
      return undefined;
    }
    console.log(`[Modifier] 规则未收录该诉求，模型补判为 [${res.attribute}]：${content}`);
    return res.attribute;
  } catch (err: any) {
    console.warn(`[Modifier] 属性补判异常，回落规则兜底: ${err?.message || err}`);
    return undefined;
  }
}

/** 无源可改：交回调用方降级为生成提案 */
function noSource(input: ModifySourceInput, artifacts: Record<string, any>): ModifyPlan {
  const curSkill = SKILL_OF_STAGE[input.currentStage] || 'story-bible';
  const fallbackStage =
    [WorkflowStage.NARRATIVE_DESIGN, WorkflowStage.SCENE_SCRIPT, WorkflowStage.STORYBOARD].find(
      (s) => artifacts[s]
    ) || input.currentStage;
  return {
    sourceSkill: curSkill,
    sourceStage: fallbackStage,
    basis: 'no-source',
    attribute: 'unknown',
    cascadeStages: [],
    reason: '项目尚无任何已落盘文本产物，无法执行微调',
  };
}

/** 从 hint / 媒体对象 / 诉求对象中挑一个媒体工序 */
function pickMediaSkill(
  skillHint: string | undefined,
  content: string,
  artifacts: Record<string, any>,
  target?: string
): string | undefined {
  const isReady = (skill: string) => Boolean(artifacts[MEDIA_STAGE[skill]]);

  if (skillHint && MEDIA_STAGE[skillHint] && isReady(skillHint)) return skillHint;

  for (const entry of MEDIA_OBJECTS) {
    if (containsAny(content, entry.words) && isReady(entry.skill)) return entry.skill;
  }

  // 主观样式词细分：人物外观 → 定妆；画面观感 → 关键帧；成片节奏 → 视频
  for (const entry of VISUAL_SUBJECT) {
    if (containsAny(content, entry.words) && isReady(entry.skill)) return entry.skill;
  }

  // 没有任何画面对象词、但诉求对象是某个角色本人时（「她看起来太老了」），
  // 这一类观感只能体现在人像上——定妆就是它的载体。
  // 注意顺序：显式的画面对象词（光影 → 关键帧）永远优先，这里只是兜底。
  if (target && matchesCharacter(artifacts, target) && isReady('character-portrait')) {
    return 'character-portrait';
  }

  // 只有唯一一个已落盘媒体资产时，才能无歧义地指向它
  const ready = Object.keys(MEDIA_STAGE).filter(isReady);
  return ready.length === 1 ? ready[0] : undefined;
}

/** 诉求对象是否就是故事圣经里的某个角色（按姓名或身份） */
function matchesCharacter(artifacts: Record<string, any>, target: string): boolean {
  const chars: any[] = Array.isArray(artifacts[WorkflowStage.NARRATIVE_DESIGN]?.characters)
    ? artifacts[WorkflowStage.NARRATIVE_DESIGN].characters
    : [];
  const key = target.trim().toLowerCase();
  if (!key) return false;
  return chars.some(
    (c) =>
      looseEq(String(c?.name || '').toLowerCase(), key) || looseEq(String(c?.role || '').toLowerCase(), key)
  );
}
