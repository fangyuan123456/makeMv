/**
 * agents/planner/schema.ts
 * 互动游戏系统策划案强类型 Zod 契约 (GDD Schema SSOT)
 *
 * 规范：遵循 articy:draft 工业级叙事设计标准，确立全局状态机与关卡流程树。
 */

import { z } from 'zod';

// 1. 全局状态机数值变量定义
export const StateVariableSpecSchema = z.object({
  name: z.string().describe('变量中文名，如：怀疑度 / 好感度 / 理智值'),
  initial: z.number().describe('初始默认值'),
  min: z.number().default(0).describe('最小值下限'),
  max: z.number().default(100).describe('最大值上限'),
  description: z.string().optional().describe('数值含义与对游戏的影响'),
});

// 2. 逻辑门禁布尔旗标
export const StateFlagSpecSchema = z.object({
  name: z.string().describe('旗标中文说明，如：是否掌握义眼维修记录'),
  initial: z.boolean().default(false).describe('初始值'),
  description: z.string().optional().describe('触发后对后续剧情或门禁的影响'),
});

// 3. 全局状态机总纲
export const GlobalStateMachineSchema = z.object({
  variables: z.record(StateVariableSpecSchema).describe('数值型变量字典'),
  flags: z.record(StateFlagSpecSchema).describe('布尔型旗标字典'),
  inventory: z.array(z.string()).default([]).describe('初始随身物品或证据卡 ID'),
});

// 4. 出场角色人设与视觉锚点
export const CharacterSpecSchema = z.object({
  characterId: z.string().describe('角色唯一标识，如 char_lin_xun'),
  name: z.string().describe('角色姓名'),
  role: z.enum(['player', 'companion', 'antagonist', 'neutral_npc']).describe('角色定位'),
  appearance: z.string().describe('核心外貌、发型、标志性服装细节'),
  personality: z.string().describe('性格特质与致命弱点/核心欲望'),
  visualDnaPromptEn: z.string().optional().describe('用于 ComfyUI 生图的英文视觉 DNA 锚点'),
});

// 4.1 全品类实体资产规范 (涵盖角色、动物生物、机体、载具、关键道具)
export const EntitySpecSchema = z.object({
  id: z.string().describe('实体唯一标识，如 char_lin_xun, entity_hound_k9, prop_blood_list'),
  name: z.string().describe('实体中文名，如：林巡、军规机械犬-K9、带血的联络员名单'),
  category: z
    .enum(['character', 'animal_creature', 'mechanical_entity', 'key_prop', 'vehicle'])
    .describe('实体类别：角色 | 动物生物 | 机械实体 | 关键道具 | 载具'),
  role: z.enum(['player', 'companion', 'antagonist', 'neutral_npc', 'ambient', 'item']).optional().describe('叙事角色定位'),
  visualDescription: z.string().describe('细致中文外观描写：外貌、材质、尺寸、服饰穿戴、毛发/涂装、微动作'),
  visualDnaPromptEn: z.string().describe('用于 ComfyUI 锁貌/形态精准生成的英文 Prompt 视觉锚点'),
  attributes: z.record(z.string()).optional().default({}).describe('扩展属性：性格、动机、机械型号、携带状态等'),
});

// 4.2 场景空间与光影氛围资产规范
export const LocationSpecSchema = z.object({
  id: z.string().describe('场景唯一标识，如 loc_interrogation_room'),
  name: z.string().describe('场景中文名，如：雨夜安保审讯室'),
  spatialLayout: z.string().describe('空间结构与物理陈设（长宽高感、材质、家具与掩体分布）'),
  lightingAtmosphere: z.string().describe('光影与影调（光源方向、主辅光色温、阴影对比、频闪/霓虹）'),
  audioAmbience: z.string().describe('声音与听觉氛围（背景音效、天气声、音乐情绪）'),
  visualPromptEn: z.string().describe('用于 ComfyUI 生图的标准英文场景环境 Prompt'),
});

// 4.3 剧情对白机锋与事件模块
export const DialogueLineSchema = z.object({
  speaker: z.string().describe('说话者名称或角色 ID'),
  text: z.string().describe('台词对白文本'),
  subtext: z.string().optional().describe('潜台词与内心真实动机'),
  actionCue: z.string().optional().describe('说此句时的肢体动作、微表情或音调变化'),
});

export const DialogueModuleSchema = z.object({
  id: z.string().describe('对白模块标识，如 dlg_interrogation_clash'),
  sceneId: z.string().optional().describe('所属场景 ID'),
  characters: z.array(z.string()).default([]).describe('参与本段博弈的角色清单'),
  conflictTheme: z.string().describe('核心冲突机锋与心理试探主题'),
  lines: z.array(DialogueLineSchema).default([]).describe('对白列表'),
});

// 4.4 完整的设定与世界圣经 (World Bible SSOT)
export const WorldBibleSchema = z.object({
  schemaVersion: z.string().default('2.0.0'),
  title: z.string().describe('所属作品名称'),
  overview: z.string().optional().describe('世界观底色与美学基调总括'),
  entities: z.array(EntitySpecSchema).default([]).describe('全量实体清单（角色、动物、机体、道具）'),
  locations: z.array(LocationSpecSchema).default([]).describe('全量场景空间与光影氛围清单'),
  dialogueModules: z.array(DialogueModuleSchema).default([]).describe('经典机锋对白与博弈模块库'),
});

export type EntitySpec = z.infer<typeof EntitySpecSchema>;
export type LocationSpec = z.infer<typeof LocationSpecSchema>;
export type DialogueModule = z.infer<typeof DialogueModuleSchema>;
export type WorldBibleArtifact = z.infer<typeof WorldBibleSchema>;

// 5. 关卡流程树选项定义
export const PlannerChoiceSchema = z.object({
  choiceId: z.string().describe('选项唯一标识'),
  text: z.string().describe('选项展示文本'),
  requiredFlags: z.array(z.string()).default([]).describe('选择此选项的前置门禁旗标'),
  stateMutations: z
    .object({
      variables: z.record(z.number()).optional().default({}),
      flags: z.record(z.boolean()).optional().default({}),
      inventoryAdd: z.array(z.string()).optional().default([]),
      inventoryRemove: z.array(z.string()).optional().default([]),
    })
    .default({}),
  nextNodeId: z.string().describe('选择后跳转的目标节点 ID'),
});

// 6. 关卡流程树节点定义
export const PlannerNodeSchema = z.object({
  nodeId: z.string().describe('节点唯一标识，如 node_01_interrogation'),
  title: z.string().describe('场景节点标题'),
  summary: z.string().describe('剧情情境与核心冲突概述'),
  choices: z.array(PlannerChoiceSchema).default([]).describe('可供抉择的选项分支'),
  defaultFallbackChoiceId: z.string().optional().describe('倒计时超时未操作时的默认回退选项 ID'),
});

// 7. 完整游戏系统策划案 (GDD) 产物 Schema
// 核心法典：以高文学水准与完备机制的 Markdown 策划文档为主体 SSOT
export const GDDSchema = z.object({
  schemaVersion: z.string().default('2.0.0'),
  title: z.string().describe('作品名称'),
  genre: z.string().default('互动影游').describe('题材类型'),
  hook: z.string().optional().describe('一句话核心世界观与高概念冲突 (The Hook)'),
  playerRole: z.string().optional().describe('玩家在游戏中的身份与生死/情感核心目标'),
  markdown: z.string().describe('完整的非结构化专业游戏策划案 Markdown 文档 (GDD SSOT)'),
  globalStateMachine: GlobalStateMachineSchema.optional().describe('可选提取的全局状态机'),
  characters: z.array(CharacterSpecSchema).optional().default([]).describe('出场角色列表'),
  flowchartNodes: z.array(PlannerNodeSchema).optional().default([]).describe('主干流程树节点列表'),
});

export type GDDArtifact = z.infer<typeof GDDSchema>;
