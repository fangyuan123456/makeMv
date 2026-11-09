/**
 * agents/planner/schema.ts
 * 互动文游策划案强类型契约 (Interactive Narrative GDD Schema SSOT)
 *
 * 设计依据（对标市面成熟互动叙事策划案的结构）：
 * 《隐形守护者》《极乐迪斯科》《底特律：变人》《晚班》一类作品的策划案，真正被工程消费的只有五块：
 *   1. 体验契约：一句话高概念、核心幻想、情感弧线（决定后面所有内容为谁服务）
 *   2. 状态系统：数值变量（带阈值效果）、布尔旗标、道具背包（决定"选择有后果"）
 *   3. 分支骨架：节点 + 选项 + 后果矩阵（不是小说，是带代价的决策点）
 *   4. 结局矩阵：HE/BE/TE/NE 各自的达成条件与情感落点（决定"能通关、值得重玩"）
 *   5. 验收路径：策划自己写清至少三条通关路线（决定"这份策划能不能被实现"）
 *
 * 铁律：
 * - 结构化字段是唯一真相，markdown 由 renderGddMarkdown() 渲染，绝不让模型写两遍；
 * - 每个选项必须产生真实状态变更或受门禁约束，纯翻页选项一律校验不通过；
 * - 结局、规则、引用（sceneId/characterId）全部可被 validateGdd() 静态校验。
 */

import { z } from 'zod';

// ============================================================
// 1. 体验契约与文风规范
// ============================================================

export const NarrativeVoiceSchema = z.object({
  pov: z.enum(['第一人称', '第二人称', '第三人称限制']).describe('叙事人称，互动文游默认第一人称以强化代入'),
  tense: z.enum(['现在时', '过去时']).describe('叙事时态，现在时可强化临场压迫感'),
  tone: z.string().describe('整体语气基调，如：冷峻克制、暗流涌动'),
  sentenceStyle: z.string().describe('句式节奏要求，如：短句为主，动作与对白交替，忌大段抒情'),
  tabooWords: z.array(z.string()).optional().default([]).describe('禁用词与禁用写法清单（如"仿佛""命运的齿轮"）'),
  styleRefs: z.array(z.string()).optional().default([]).describe('风格参照作品，用于对齐文学质感'),
  sampleLine: z.string().describe('一句示范正文，作为下游逐节点扩写的文风锚点'),
});

// ============================================================
// 2. 状态系统（数值 / 旗标 / 背包）
// ============================================================

export const ThresholdSchema = z.object({
  op: z.enum(['>=', '<=', '==']).describe('比较运算符'),
  value: z.number().describe('触发阈值'),
  effect: z.string().describe('达到阈值后发生的具体后果（如：就地拔枪处决，跳转 BE）'),
});

export const VariableSpecSchema = z.object({
  name: z.string().describe('变量中文名，如：维克托的怀疑度'),
  initial: z.number().describe('初始值'),
  min: z.number().default(0).describe('下限'),
  max: z.number().default(100).describe('上限'),
  description: z.string().describe('该数值对玩家意味着什么、升高/降低的代价'),
  thresholds: z.array(ThresholdSchema).optional().default([]).describe('阈值效果表，必须可被规则引擎执行'),
});

export const FlagSpecSchema = z.object({
  name: z.string().describe('旗标中文说明，如：掌握走私黑账'),
  initial: z.boolean().default(false).describe('初始值'),
  description: z.string().describe('点亮/熄灭该旗标对后续剧情的影响'),
});

export const GlobalStateMachineSchema = z.object({
  variables: z.record(VariableSpecSchema).describe('数值变量字典（2~3 个，必须每个都影响门禁或结局）'),
  flags: z.record(FlagSpecSchema).describe('布尔旗标字典（3~5 个，用于跨节点证据与身份门禁）'),
  inventory: z.array(z.string()).optional().default([]).describe('初始随身物品/证据卡 ID'),
});

export const StateMutationSchema = z.object({
  variables: z.record(z.number()).optional().default({}).describe('数值增减（可正可负）'),
  flags: z.record(z.boolean()).optional().default({}).describe('旗标置位'),
  inventoryAdd: z.array(z.string()).optional().default([]).describe('获得道具'),
  inventoryRemove: z.array(z.string()).optional().default([]).describe('失去道具'),
});

// ============================================================
// 3. 角色与场景（视觉资产的唯一源头）
// ============================================================

export const CharacterSpecSchema = z.object({
  id: z.string().describe('角色唯一标识，如 char_lin_xun'),
  name: z.string().describe('角色姓名'),
  role: z.enum(['player', 'companion', 'antagonist', 'neutral_npc']).describe('叙事定位'),
  want: z.string().describe('表层欲望：他嘴上说要什么'),
  need: z.string().describe('深层需求：他真正缺什么（与 want 冲突才有戏）'),
  wound: z.string().describe('旧伤：决定其行为模式的前史创伤'),
  arc: z.string().describe('人物弧光：从什么状态走到什么状态'),
  voice: z.string().describe('说话方式与口头习惯（用于对白不串味）'),
  appearance: z.string().describe('外貌、服装、标志性细节（中文，供定妆图使用）'),
  visualDnaPromptEn: z.string().describe('英文视觉 DNA 锚点，锁定发型/脸型/服装，供定妆与后续所有出图复用'),
  relationships: z
    .array(z.object({ targetId: z.string(), relation: z.string() }))
    .optional()
    .default([])
    .describe('与其他角色的关系（供对白张力设计）'),
});

export const LocationSpecSchema = z.object({
  id: z.string().describe('场景唯一标识，如 loc_interrogation_room'),
  name: z.string().describe('场景中文名'),
  function: z.string().describe('该场景在叙事中承担的功能（试探/摊牌/逃生等）'),
  spatialLayout: z.string().describe('空间结构与陈设（长宽高感、材质、掩体分布）'),
  lightingAtmosphere: z.string().describe('光影与影调（光源方向、色温、阴影对比）'),
  audioAmbience: z.string().describe('环境音设计'),
  visualPromptEn: z.string().describe('英文场景母本 Prompt，作为该场景所有出图的基准图'),
});

// ============================================================
// 4. 可执行规则（阈值 → 结局/跳转）
// ============================================================

export const ConditionSchema = z.object({
  subject: z.enum(['variable', 'flag', 'inventory']).describe('判定对象类型'),
  key: z.string().describe('变量名 / 旗标名 / 道具 ID'),
  op: z.enum(['>=', '<=', '>', '<', '==', '!=']).describe('比较运算符'),
  value: z.union([z.number(), z.boolean(), z.string()]).describe('比较目标值'),
});

export const RuleSchema = z.object({
  id: z.string().describe('规则唯一标识，如 rule_suspicion_execute'),
  description: z.string().describe('这条规则表达的设计意图'),
  when: z.array(ConditionSchema).min(1).describe('触发条件（全部满足才触发）'),
  then: z
    .discriminatedUnion('type', [
      z.object({ type: z.literal('ending'), endingId: z.string() }),
      z.object({ type: z.literal('goto'), nodeId: z.string() }),
    ])
    .describe('触发后果：直接进入某结局，或强制跳转某节点'),
});

// ============================================================
// 5. 分支骨架（节点与选项）
// ============================================================

export const ChoiceIntentSchema = z
  .enum(['probe', 'evade', 'confront', 'evidence', 'sacrifice', 'risk', 'timeout_default'])
  .describe(
    '选项设计意图：probe 试探 | evade 回避 | confront 对抗 | evidence 出示证据 | sacrifice 付出代价 | risk 冒险 | timeout_default 倒计时默认被动项'
  );

export const PlannerChoiceSchema = z.object({
  id: z.string().describe('选项唯一标识，全局不可重复'),
  label: z.string().describe('选项展示文本（玩家看到的原话或动作）'),
  intent: ChoiceIntentSchema,
  cost: z.string().describe('这个选项让玩家付出什么（心理/资源/关系代价），禁止零成本选项'),
  requiredFlags: z.array(z.string()).optional().default([]).describe('前置门禁旗标（未点亮则该选项不可选）'),
  mutations: StateMutationSchema,
  nextNodeId: z.string().describe('选择后跳转的节点 ID'),
  consequenceNote: z.string().describe('一句话说明后果，供策划自查因果是否成立'),
});

export const PlannerNodeSchema = z
  .object({
    id: z.string().describe('节点唯一标识，全局不可重复'),
    act: z.number().int().min(1).max(3).describe('所属幕次：1 建立 / 2 升级 / 3 摊牌'),
    title: z.string().describe('场景节点标题'),
    purpose: z.string().describe('该节点在结构上的功能（试探、逼供、反杀、逃生等）'),
    sceneId: z.string().describe('所属场景 ID，必须存在于 locations'),
    characterIds: z.array(z.string()).min(1).describe('出场角色 ID，必须存在于 characters'),
    summary: z.string().describe('情境与核心冲突摘要（60~120 字，不写正文，供下游扩写）'),
    timeLimitSec: z.number().int().min(3).optional().describe('倒计时秒数，缺省表示无时限'),
    defaultChoiceId: z.string().optional().describe('倒计时耗尽时自动滑入的被动选项 ID'),
    choices: z.array(PlannerChoiceSchema).optional().default([]).describe('抉择分支；结局节点必须为空'),
    endingId: z.string().optional().describe('结局节点必须声明它所呈现的结局 ID'),
  })
  .superRefine((node, ctx) => {
    if (node.endingId) {
      if (node.choices.length > 0) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `结局节点 [${node.id}] 不得包含选项` });
      }
      return;
    }
    if (node.choices.length < 2) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `非结局节点 [${node.id}] 至少需要 2 个选项，否则玩家无决策可做`,
      });
    }
    if (node.defaultChoiceId && !node.choices.some((c) => c.id === node.defaultChoiceId)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `节点 [${node.id}] 的默认选项 [${node.defaultChoiceId}] 不在其选项列表中`,
      });
    }
  });

// ============================================================
// 6. 结局矩阵与失败态
// ============================================================

export const EndingSchema = z.object({
  id: z.string().describe('结局唯一标识'),
  type: z.enum(['HE', 'BE', 'TE', 'NE']).describe('HE 圆满 / BE 失败死局 / TE 隐藏反转 / NE 平淡收束'),
  title: z.string().describe('结局标题'),
  nodeId: z.string().describe('承载该结局的节点 ID'),
  condition: z.array(ConditionSchema).min(1).describe('达成该结局所需的状态条件（写清"为什么是这个结局"）'),
  summary: z.string().describe('结局内容与情感落点（不写正文）'),
});

export const FailStateSchema = z.object({
  id: z.string(),
  trigger: z.string().describe('触发失败的机制描述'),
  summary: z.string().describe('失败时的呈现与提示'),
  retryNodeId: z.string().describe('重试回到的节点 ID'),
});

// ============================================================
// 7. 内容量级与验收路径
// ============================================================

export const ContentBudgetSchema = z.object({
  targetPlaytimeMin: z.number().int().min(10).describe('单周目目标时长（分钟）'),
  wordsPerNode: z
    .object({ min: z.number().int(), max: z.number().int() })
    .describe('单节点正文目标字数区间，供下游扩写对齐节奏'),
  maxChoicesPerNode: z.number().int().min(2).max(5).describe('单节点最大选项数，防止分支爆炸'),
});

export const TestPathSchema = z.object({
  id: z.string(),
  name: z.string().describe('路线说明，如：稳健掉包达成 HE'),
  choicePath: z.array(z.string()).min(1).describe('按顺序选取的选项 ID 序列'),
  expectedEndingId: z.string().describe('该路线必须抵达的结局 ID'),
});

// ============================================================
// 8. 策划案总契约
// ============================================================

export const GDDSchema = z.object({
  schemaVersion: z.string().default('3.0.0'),
  title: z.string().describe('作品名称'),
  genre: z.string().describe('题材类型'),
  logline: z.string().describe('一句话高概念（谁、在什么处境、要付出什么代价）'),
  coreFantasy: z.string().describe('玩家核心幻想：玩家在这款游戏里成为什么样的人'),
  emotionalArc: z.string().describe('情感弧线：开局/中段/终局分别要把玩家推到什么情绪'),
  playerRole: z.string().describe('玩家身份与生死目标'),
  contentRating: z.enum(['全年龄', '16+', '18+']).describe('内容分级'),
  narrativeVoice: NarrativeVoiceSchema,
  contentBudget: ContentBudgetSchema,
  startNodeId: z.string().describe('起始节点 ID'),
  globalStateMachine: GlobalStateMachineSchema,
  characters: z.array(CharacterSpecSchema).min(2).describe('核心角色（含玩家）'),
  locations: z.array(LocationSpecSchema).min(2).describe('核心场景'),
  rules: z.array(RuleSchema).optional().default([]).describe('阈值与门禁规则（必须可执行）'),
  nodes: z.array(PlannerNodeSchema).min(8).describe('分支骨架节点（含结局节点）'),
  endings: z.array(EndingSchema).min(3).describe('结局矩阵（HE/BE/TE 至少各一）'),
  failStates: z.array(FailStateSchema).optional().default([]).describe('失败态与回退点'),
  testPaths: z.array(TestPathSchema).min(3).describe('策划自带的验收路线（必须能走到声明结局）'),
});

// ============================================================
// 9. 资产圣经（供下游出图/出视频消费的投影结构）
// ============================================================

export const EntitySpecSchema = z.object({
  id: z.string(),
  name: z.string(),
  category: z.enum(['character', 'animal_creature', 'mechanical_entity', 'key_prop', 'vehicle']),
  role: z.enum(['player', 'companion', 'antagonist', 'neutral_npc', 'ambient', 'item']).optional(),
  visualDescription: z.string(),
  visualDnaPromptEn: z.string(),
  attributes: z.record(z.string()).optional().default({}),
});

export const DialogueModuleSchema = z.object({
  id: z.string(),
  sceneId: z.string().optional(),
  characters: z.array(z.string()).optional().default([]),
  conflictTheme: z.string(),
  lines: z
    .array(
      z.object({
        speaker: z.string(),
        text: z.string(),
        subtext: z.string().optional(),
        actionCue: z.string().optional(),
      })
    )
    .optional()
    .default([]),
});

export const WorldBibleSchema = z.object({
  schemaVersion: z.string().default('2.0.0'),
  title: z.string(),
  overview: z.string().optional(),
  entities: z.array(EntitySpecSchema).optional().default([]),
  locations: z.array(LocationSpecSchema).optional().default([]),
  dialogueModules: z.array(DialogueModuleSchema).optional().default([]),
});

// ============================================================
// 10. 派生类型
// ============================================================

export type NarrativeVoice = z.infer<typeof NarrativeVoiceSchema>;
export type VariableSpec = z.infer<typeof VariableSpecSchema>;
export type FlagSpec = z.infer<typeof FlagSpecSchema>;
export type CharacterSpec = z.infer<typeof CharacterSpecSchema>;
export type LocationSpec = z.infer<typeof LocationSpecSchema>;
export type Condition = z.infer<typeof ConditionSchema>;
export type GameRule = z.infer<typeof RuleSchema>;
export type PlannerChoice = z.infer<typeof PlannerChoiceSchema>;
export type PlannerNode = z.infer<typeof PlannerNodeSchema>;
export type EndingSpec = z.infer<typeof EndingSchema>;
export type FailState = z.infer<typeof FailStateSchema>;
export type TestPath = z.infer<typeof TestPathSchema>;
export type EntitySpec = z.infer<typeof EntitySpecSchema>;
export type DialogueModule = z.infer<typeof DialogueModuleSchema>;
export type WorldBibleArtifact = z.infer<typeof WorldBibleSchema>;

/** 模型直出的策划案核心（不含 markdown，markdown 由 renderGddMarkdown 渲染） */
export type GDDCore = z.infer<typeof GDDSchema>;

/** 落盘态策划案：核心 + 渲染出的人类可读 markdown */
export interface GDDArtifact extends GDDCore {
  markdown: string;
  worldBible?: WorldBibleArtifact;
}
