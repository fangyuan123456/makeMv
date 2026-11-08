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
 *    6.5 媒体轨二次校验：媒体轨意味着重新出图/重新渲染，是这条链路上唯一花真钱
 *    的动作，所以在派发前让补判器再确认一次「这真的是画面诉求吗」。只有当规则
 *    命中的是模糊词、且创作者没有点名任何媒体资产（定妆照/关键帧/这段视频/重画…）
 *    时才问；模型以高置信度指向文本类属性（设定/外观/台词/镜头）就改判到文本源头，
 *    宁可「改了还能再改」，也不要花一次生图钱买一张要扔的图。
 * 7. 属性词一个都没命中（unknown）→ 交给 attribute-classifier 补判一次类别
 *    （词表是闭集、创作者表达是开集，unknown 只说明词表没收录，不说明没有属性；
 *     但模型同样有权弃权——「这个不行，换一个」这类无信息输入必须判 unknown，
 *     不允许它硬猜一个类别，否则一句抱怨就会变成媒体轨重新生成）
 * 8. 媒体对象直指（定妆照/关键帧/这段视频）+ 该资产已落盘 → 对应媒体工序
 * 9. 仍未命中 → 用 WHO 在黑板的文本产物里定位条目
 * 10. 仍判不出 → 当前阶段主责工序（绝不是「最早的文本源」）
 * 11. 无任何文本产物 → no-source，由调用方降级为生成提案
 *
 * 目标工序未落盘时按显式上游链降级（台词还没写出来只能先改设定，镜头没拆只能
 * 先改台词）。任何情况下都不会把设定事实丢给只能改画面的媒体轨。
 */

import { WorkflowStage, STAGE_SEQUENCE } from '../../../types/index.js';
import { ProjectStore } from '../../../project-store/ProjectStore.js';
import { SKILL_OF_STAGE } from '../constants.js';
import { getModifierSpec } from './manifest.js';
import {
  classifyModifyAttribute,
  isAttributeClassifierEnabled,
  isClassifiable,
  type AttributeClassification,
  type AttributeClassifier,
} from './attribute-classifier.js';
import { ATTRIBUTE_LABELS, type ModifyAttribute } from './modify-attributes.js';

export type ModifySourceBasis = 'text-source' | 'media-asset' | 'no-source';

/** 诉求触及的属性类别（唯一定义在 modify-attributes.ts，此处仅转出） */
export type { ModifyAttribute } from './modify-attributes.js';


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
  /**
   * 同一句话里落在其他源头的附加诉求（「台词压短，镜头换中景」）。
   * 只检测与上报，不改变本次裁决：一次派发只改一份产物，多源头执行需要先解决
   * 清退顺序（改上游会清掉下游的同批产物），因此由调用方决定是否另起一单。
   */
  additionalAsks?: AdditionalAsk[];
}

/** 附加诉求：本次不执行，但绝不静默丢弃 */
export interface AdditionalAsk {
  /** 命中的分句原文 */
  clause: string;
  attribute: ModifyAttribute;
  sourceSkill: string;
  sourceStage: WorkflowStage;
  /**
   * 与主单的关系，决定要不要接第二单：
   * - merged：同一文本轨。文本修改器一次读三份、产出一份跨文件补丁，
   *   第二个文本源头在主单里就会一起被改到，不需要另起任务。
   * - downstream：目标阶段在主单之后。可以追加，但必须等主单落地后再决定
   *   「改现有产物」还是「按这条指令重新生成」（见 follow-up.ts）。
   * - upstream：目标阶段在主单之前。追加会把主单刚产出的东西清退，只能记录。
   */
  relation: 'merged' | 'downstream' | 'upstream';
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
   * 最近几条用户诉求（时间正序，末条最近，不含本轮）。
   * 创作者大量使用省略句——「再短一点」「太老了」——只靠本轮文本无法知道
   * 短的是什么、老的是谁；这些恰恰是最容易落 unknown、最需要补判的输入，
   * 也恰恰是最缺信息的输入。所以把上一轮原话一并给出。
   */
  history?: string[];
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

/** 媒体名词与动作的合集：出现即说明创作者已明确点名要动媒体资产，无需二次校验 */
const EXPLICIT_MEDIA_ANCHORS = [...MEDIA_OBJECTS.flatMap((m) => m.words), ...MEDIA_VERBS];

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

/* ─── 多源头附加诉求：检测但不执行 ─── */

/** 分句符：一条消息里出现两个独立诉求时，几乎一定用这些词/标点隔开 */
const CLAUSE_SEPARATORS = /[，,；;。!！?？\n]+|同时|另外|顺便|并且|然后/;

/** 否定从句不是诉求（「整体调暗，别改设定」里的后半句） */
const NEGATED_CLAUSE = /^(别|不要|不用|无需|不必|保持|不改|别改|维持)/;

/** 属性 → 可编辑文本源头（画面类不在其列：媒体轨落点取决于资产是否已落盘） */
const TEXT_SOURCE_OF_ATTRIBUTE: Partial<
  Record<ModifyAttribute, { skill: string; stage: WorkflowStage }>
> = {
  setting: { skill: 'story-bible', stage: WorkflowStage.NARRATIVE_DESIGN },
  appearance: { skill: 'story-bible', stage: WorkflowStage.NARRATIVE_DESIGN },
  dialogue: { skill: 'scene-script', stage: WorkflowStage.SCENE_SCRIPT },
  shot: { skill: 'storyboard', stage: WorkflowStage.STORYBOARD },
};

/**
 * 找出同一句话里落在**其他**源头的诉求。
 *
 * 为什么按分句而不是整句判：整句只有一个裁决结果（短路返回第一类命中），
 * 于是「台词压短，镜头换中景」永远只改台词，后半句静默消失。按分句拆开分别
 * 判定，才能知道还有第二个源头。这里只做检测与上报——同批改两个源头会互相
 * 清退（改上游必然让下游产物过期），执行顺序得由调用方决定。
 */
function findAdditionalAsks(
  input: ModifySourceInput,
  content: string,
  artifacts: Record<string, any>,
  primarySkill: string,
  primaryStage: WorkflowStage
): AdditionalAsk[] {
  if (!CLAUSE_SEPARATORS.test(content)) return [];
  const clauses = content
    .split(CLAUSE_SEPARATORS)
    .map((c) => c.trim())
    .filter((c) => c.length >= 2);
  if (clauses.length < 2) return [];

  const primaryKind = getModifierSpec(primarySkill)?.kind;
  const primaryOrder = STAGE_SEQUENCE.indexOf(primaryStage);

  const asks: AdditionalAsk[] = [];
  for (const clause of clauses) {
    if (NEGATED_CLAUSE.test(clause)) continue;
    const attribute = detectAttribute(clause).attribute;
    // 画面类没有固定的文本落点，能不能落媒体轨取决于资产是否已落盘
    const source = TEXT_SOURCE_OF_ATTRIBUTE[attribute];
    const mediaSkill =
      attribute === 'visual' || attribute === 'media'
        ? pickMediaSkill(input.skillHint, clause, artifacts, (input.target || '').trim().toLowerCase())
        : undefined;
    const stage = source?.stage ?? (mediaSkill ? MEDIA_STAGE[mediaSkill] : undefined);
    const skill = source?.skill ?? mediaSkill;
    if (!stage || !skill) continue;
    if (stage === primaryStage) continue;
    if (!artifacts[stage]) continue;
    if (asks.some((a) => a.sourceStage === stage)) continue;

    const kind = getModifierSpec(skill)?.kind;
    const order = STAGE_SEQUENCE.indexOf(stage);
    // 文本轨一次跨文件打补丁 → 同一主单已覆盖；图像/视频各工序各有独立规格，不能合并
    const relation: AdditionalAsk['relation'] =
      kind === 'text' && primaryKind === 'text'
        ? 'merged'
        : order > primaryOrder
          ? 'downstream'
          : 'upstream';

    asks.push({ clause, attribute, sourceSkill: skill, sourceStage: stage, relation });
  }
  return asks;
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
    // 附加源头只在这里统一挂上：所有正常裁决都走 plan()，漏一处就等于静默丢诉求
    additionalAsks: findAdditionalAsks(input, content, artifacts, skill, stage),
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
    via: 'rule' | 'llm' | 'llm-check'
  ): ModifyPlan | undefined => {
    const label =
      via === 'llm'
        ? `${hit || attribute}（模型补判）`
        : via === 'llm-check'
          ? `媒体轨复核改判：${hit}`
          : hit;

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

  /**
   * 媒体轨二次校验：规则命中画面词就要重新出图，这是整条链路上唯一花真钱的动作。
   * 只在「模糊词驱动 + 没有点名任何媒体资产」时复核一次；模型以高置信度指向文本类
   * 属性时改判到文本源头（那才是可回退、可再改的一侧）。
   */
  const mediaSecondOpinion = async (
    rulePlan: ModifyPlan,
    verdict: AttributeVerdict
  ): Promise<ModifyPlan | undefined> => {
    if (rulePlan.basis !== 'media-asset') return undefined;
    if (!MEDIA_TRACK_ATTRIBUTES.has(rulePlan.attribute)) return undefined;
    if (!isMediaGuardEnabled()) return undefined;
    // 复核器不可用（显式禁用 / 没人注入且总开关关着）时直接放过，不为一次「没发生的事」留日志
    if (input.classify === null) return undefined;
    if (input.classify === undefined && !isAttributeClassifierEnabled()) return undefined;
    // 创作者已明确点名资产或动作（「重出定妆照」「重新出图」），二次校验只会添延迟
    if (containsAny(content, EXPLICIT_MEDIA_ANCHORS)) return undefined;

    const ask = await askClassifier(input, content, 'media-guard');
    if (ask.failure) {
      logClassifyTrace('media-guard', input, content, ask, ask.failure);
      return undefined;
    }
    const res = ask.res!;
    if (TEXT_TRACK_ATTRIBUTES.has(res.attribute)) {
      // 指向文本但把握不足：宁可按画面走（可再改），也不擅自把画面诉求改成设定改写
      if (Number.isFinite(res.confidence) && res.confidence > MEDIA_OVERRIDE_CONFIDENCE) {
        const overridden = applyAttribute(
          res.attribute,
          `${verdict.hit || verdict.attribute} → ${ATTRIBUTE_LABELS[res.attribute]}`,
          'llm-check'
        );
        if (overridden) {
          logClassifyTrace('media-guard', input, content, ask, 'overridden');
          return overridden;
        }
      }
      logClassifyTrace('media-guard', input, content, ask, 'low-confidence');
      return undefined;
    }
    logClassifyTrace('media-guard', input, content, ask, 'agreed');
    return undefined;
  };

  // 1-5. 按属性类别定位源头（属性优先于实体）
  const verdict = detectAttribute(content);
  const rulePlan = applyAttribute(verdict.attribute, verdict.hit, 'rule');
  if (rulePlan) {
    // 6.5 落到媒体轨时复核一次：判错的代价是一次真金白银的重新生成
    const overridden = await mediaSecondOpinion(rulePlan, verdict);
    return overridden ?? rulePlan;
  }

  // 7. unknown 补判：词表是闭集、创作者表达是开集，unknown 只说明词表没收录，
  // 不说明这条诉求没有属性。让模型只回答「六类里哪一类」，回来走同一条 applyAttribute，
  // 裁决规则本身没有任何放权（WHO 与阶段定位依旧由本地逻辑决定）。
  if (verdict.attribute === 'unknown') {
    const guessed = await classifyByModel(input, content);
    if (guessed && guessed !== 'unknown') {
      const llmPlan = applyAttribute(guessed, guessed, 'llm');
      if (llmPlan) return llmPlan;
    }
  }

  // 8. 媒体对象直指 + 已落盘（无属性词时也能精确命中）
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

  // 9. WHO 定位：属性实在说不清时，用实体在文本产物里的条目位置判源头
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

  // 10. 兜底：当前阶段的主责工序（工作面在哪儿就从哪儿改，而不是最老的文本源）
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

  // 11. 连文本产物都没有（项目刚创建）
  return noSource(input, artifacts);
}

/* ─── 属性补判（unknown 补类别 / 媒体轨二次校验） ─── */

/** 默认分类器：受开关控制，模型不可用/超时/解析失败一律返回 undefined */
const defaultClassifier: AttributeClassifier = async (req) => {
  if (!isAttributeClassifierEnabled()) return undefined;
  return classifyModifyAttribute(req);
};

/** 低于等于该置信度视为「模型自己在猜」，一律不采纳（0.5 恰好等于猜，不能放行） */
const MIN_ADOPT_CONFIDENCE = 0.5;

/**
 * 覆盖媒体轨所需的置信度，比补判 unknown 的 0.5 高一档。
 * 两个方向的错误代价并不对称：漏了一次该改图的图，创作者再说一句就行；
 * 把明确的「让这张年轻点」误拽去改年龄设定，则是「改了但画面没变」——
 * 正是这条链路最初要消灭的那类失败。所以只在模型很有把握时才改判。
 */
const MEDIA_OVERRIDE_CONFIDENCE = 0.7;

/** 媒体轨：命中即以重新生成媒体资产收尾 */
const MEDIA_TRACK_ATTRIBUTES = new Set<ModifyAttribute>(['visual', 'media']);

/** 文本轨：能落到某份可编辑文本产物上的属性 */
const TEXT_TRACK_ATTRIBUTES = new Set<ModifyAttribute>(['setting', 'appearance', 'dialogue', 'shot']);

/**
 * 媒体轨复核的逃生开关（`MODIFY_MEDIA_GUARD=0` 关闭）。
 * 复核是「多花 1.4s 换少一次白出图」的取舍，偶发慢请求或成本敏感时可以整体关掉，
 * 关掉后行为等价于复核永远同意。
 */
function isMediaGuardEnabled(): boolean {
  const flag = String(process.env.MODIFY_MEDIA_GUARD || '').toLowerCase();
  return !['0', 'false', 'off', 'no'].includes(flag);
}

/** 补判发生的环节：unknown 补类别 / 派发媒体轨前的复核 */
type ClassifyPhase = 'unknown-fallback' | 'media-guard';

type ClassifyOutcome =
  | 'adopted'
  | 'abstained'
  | 'low-confidence'
  | 'empty'
  | 'error'
  | 'disabled'
  | 'agreed'
  | 'overridden';

/** 补判的结构化留痕：线上复盘「补判到底帮了多少、误判多少」的唯一依据 */
interface ClassifyTrace {
  evt: string;
  phase: ClassifyPhase;
  content: string;
  target?: string;
  historySize: number;
  attribute?: ModifyAttribute;
  confidence?: number;
  reason?: string;
  latencyMs: number;
  outcome: ClassifyOutcome;
  error?: string;
}

function logClassifyTrace(
  phase: ClassifyPhase,
  input: ModifySourceInput,
  content: string,
  ask: AskResult,
  outcome: ClassifyOutcome
): void {
  const payload: ClassifyTrace = {
    evt: 'modify.attribute_classify',
    phase,
    content: content.slice(0, 80),
    target: input.target,
    historySize: (input.history || []).length,
    attribute: ask.res?.attribute,
    confidence: ask.res?.confidence,
    reason: ask.res?.reason,
    latencyMs: ask.latencyMs,
    outcome,
    error: ask.error,
  };
  // 单行 JSON：便于 grep 与后续接日志采集，不需要改动任何日志基础设施
  console.log(
    `[Modifier] ${JSON.stringify({
      ...payload,
      attributeLabel: payload.attribute ? ATTRIBUTE_LABELS[payload.attribute] : undefined,
    })}`
  );
}

interface AskResult {
  res?: AttributeClassification;
  latencyMs: number;
  /** 没拿到可用判断的原因（拿到可用判断时为 undefined） */
  failure?: 'disabled' | 'empty' | 'error' | 'abstained';
  error?: string;
}

/**
 * 问一次模型，只负责「拿到结果」，不决定是否采纳——两类调用方的采纳门槛不同
 * （unknown 补类别 0.5，媒体轨复核 0.7）。任何异常都吞掉，补判只能加分，
 * 不允许因为它挂了就把原本能走通的修改卡死。
 */
async function askClassifier(
  input: ModifySourceInput,
  content: string,
  phase: ClassifyPhase
): Promise<AskResult> {
  // 调用方显式禁用；或没人注入分类器且全局开关关着——两种情形都不必惊动模型
  if (input.classify === null) return { latencyMs: 0, failure: 'disabled' };
  if (input.classify === undefined && !isAttributeClassifierEnabled()) {
    return { latencyMs: 0, failure: 'disabled' };
  }

  const classifier = input.classify ?? defaultClassifier;
  const startedAt = Date.now();
  try {
    const res = await classifier({
      content: input.content || content,
      target: input.target,
      history: input.history,
    });
    const latencyMs = Date.now() - startedAt;
    if (!res) return { latencyMs, failure: 'empty' };
    if (!isClassifiable(res.attribute)) return { res, latencyMs, failure: 'abstained' };
    return { res, latencyMs };
  } catch (err: any) {
    return {
      latencyMs: Date.now() - startedAt,
      failure: 'error',
      error: err?.message || String(err),
    };
  }
}

/**
 * unknown 补判：返回可采纳的类别。
 *
 * 采纳条件缺一不可：模型给出可落地类别（不是弃权）、置信度高于「猜」的水位。
 * 两者都不满足时必须回落规则兜底，交给 WHO / 当前工作面定位——静默按错的方向
 * 改一份产物，比明确不动更糟。
 */
async function classifyByModel(
  input: ModifySourceInput,
  content: string
): Promise<ModifyAttribute | undefined> {
  const ask = await askClassifier(input, content, 'unknown-fallback');
  if (ask.failure) {
    logClassifyTrace('unknown-fallback', input, content, ask, ask.failure);
    return undefined;
  }
  const res = ask.res!;
  if (!Number.isFinite(res.confidence) || res.confidence <= MIN_ADOPT_CONFIDENCE) {
    logClassifyTrace('unknown-fallback', input, content, ask, 'low-confidence');
    return undefined;
  }
  logClassifyTrace('unknown-fallback', input, content, ask, 'adopted');
  return res.attribute;
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
