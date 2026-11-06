/**
 * agents/director/generator/manifest.ts
 * 互动影游全流程工序元数据清单体系 (Step Manifest Registry SSOT)
 *
 * 核心架构特性（法典 0.3/0.4 极简开闭原则与单一事实来源）：
 * 1. 唯一工序源头：全系统所有工序的 Key、Stage、Title、Mastra Step、Modifier 与黑板摘要高内聚声明于此；
 * 2. 0 散落硬编码：自动派生 STAGE_SEQUENCE、STAGE_TRANSITION_MAP、STAGE_OF_SKILL、SKILL_TITLES；
 * 3. 插件化即插即用：新增或调整 Step 仅需在此追加或调整 order，调度底座、总导演 Prompt 与黑板全自动感知；
 * 4. 0 胶水无多余方法：杜绝下游猜谜 (matchEntity) 与黑盒级联跑 (cascadeHandler)，强类型契约直通。
 */

import { WorkflowStage } from '../../../types/index.js';
import {
  storyBibleSubWorkflow,
  characterPortraitSubWorkflow,
  sceneScriptSubWorkflow,
  storyboardSubWorkflow,
  keyframeReferenceSubWorkflow,
  videoProductionSubWorkflow,
  criticReviewStep,
  fmvPackagingStep,
} from './steps/index.js';
import {
  modifyStoryBible,
  modifyCharacterPortrait,
  modifySceneScript,
  modifyStoryboard,
  modifyKeyframeReference,
  modifyVideoProduction,
} from '../modifier/modifiers/index.js';
import type { LLMService } from '../../../llm/LLMService.js';

export interface ModifierContext {
  projectId: string;
  userFeedback: string;
  llm: LLMService;
  target?: string;
  payload?: any;
}

export interface StepManifest {
  /** 唯一工序标识符 (如 'story-bible') */
  key: string;
  /** 所属工序业务阶段 (SSOT) */
  stage: WorkflowStage;
  /** 标准工序名称 */
  title: string;
  /** 流水线位序 (0..N，用于自动推导执行序列与前后转移关系，负数表示非顺向流水线如独立切面审查) */
  order: number;
  /** Mastra 顺向生产 Step 微内核实例 */
  step: any;
  /** 是否属于 0 到 1 顺向批量生产流水线 (true 参与 filmProductionPipelineWorkflow) */
  isPipelineStep: boolean;
  /** 是否需要人工在前端审批授权 (人在回路策略源头配置：工序执行体默认 false 全自动直通到底出成果，无需中途二次确认) */
  requireConfirmation?: boolean;
  /** 定向外科手术修改器 (精修轨无胶水直调) */
  modifier?: (ctx: ModifierContext) => Promise<{ success: boolean; data?: any; summary?: string; error?: string }>;
  /** 高信噪比黑板态势摘要提取器 (供 ContextAssembler 统一消费) */
  summarizeArtifact?: (artifact: any) => string;
  /** 导演标准作业程序指引 (SOP Guide)，供 ContextAssembler 与总导演认知统一消费 */
  sopGuide?: string;
  /** 该工序核心审查与打磨关注点 (Review & Polish Focus)，供总导演通用行动指引自适应消费 (SSOT) */
  reviewFocus?: string;
}

/**
 * 互动影游全流程标准工序清单 (权威 SSOT 注册表)
 */
export const STEP_MANIFESTS: StepManifest[] = [
  {
    key: 'story-bible',
    stage: WorkflowStage.NARRATIVE_DESIGN,
    title: '叙事架构 (Story Bible)',
    order: 0,
    isPipelineStep: true,
    requireConfirmation: false,
    sopGuide: '导演工作重心：从电影视角提炼故事核心主线与大致剧情走向，确立核心冲突、主角动机与视听影调基调；为后续工序确立清晰的故事主干（切勿过早锁定具体分支抉择与结局细节，分支由后续工序顺向推演），引导创作者开启叙事架构制作。',
    reviewFocus: '故事主干走向、核心冲突与视听基调',
    step: storyBibleSubWorkflow,
    modifier: async ({ projectId, userFeedback, llm }) => {
      return await modifyStoryBible({ projectId, userFeedback, llm });
    },
    summarizeArtifact: (art) => {
      const charList = Array.isArray(art.characters)
        ? art.characters.map((c: any) => `${c.name}${c.role ? `(${c.role})` : ''}`).join('、')
        : '无';
      const endings = art.storyGraph?.endingsCount ?? '未知';
      let text = `✅ 已就绪 | 故事终局数: ${endings} 个 | 核心角色: [${charList}]`;
      if (art.logline) {
        text += `\n    * 核心一句话大纲: ${art.logline}`;
      }
      return text;
    },
  },
  {
    key: 'character-portrait',
    stage: WorkflowStage.CHARACTER_DESIGN,
    title: '角色定妆 (Character Portrait)',
    order: 1,
    isPipelineStep: true,
    requireConfirmation: false,
    sopGuide: '核心任务：敲定核心角色的电影级视觉定妆，包含面部特写、服饰质感、道具细节与光影基调；确保角色形象具有高辨识度与后续分镜一致性。',
    reviewFocus: '核心角色面容定妆、服饰质感与银幕气质',
    step: characterPortraitSubWorkflow,
    modifier: async ({ projectId, userFeedback, llm, target, payload }) => {
      const targetName = target || payload?.targetCharacterNames?.[0];
      return await modifyCharacterPortrait({
        projectId,
        targetName,
        userFeedback,
        llm,
        isMock: payload?.isMock,
      });
    },
    summarizeArtifact: (art) => {
      if (!Array.isArray(art.characters) || art.characters.length === 0) return '✅ 资产已落盘';
      const charItems = art.characters.map((c: any, idx: number) => {
        const status = c.imageUrl ? '✓已定妆' : '待渲染';
        const visual = c.appearance || c.visualPrompt || '暂无详细描述';
        const shortVisual = visual.length > 35 ? visual.slice(0, 35) + '...' : visual;
        return `    * [${idx + 1}] ${c.name} (${status}): ${shortVisual}`;
      });
      return `✅ 已就绪 (共 ${art.characters.length} 位角色)\n${charItems.join('\n')}`;
    },
  },
  {
    key: 'scene-script',
    stage: WorkflowStage.SCENE_SCRIPT,
    title: '分场文学剧本 (Scene Script)',
    order: 2,
    isPipelineStep: true,
    requireConfirmation: false,
    sopGuide: '核心任务：将世界观细化为场次文学剧本，精确描写环境光影、动作节拍、潜台词与观众互动抉择选项（Choices）；明确每个选项导致的情感波动与分支流向。',
    reviewFocus: '分场剧情节拍、台词潜台词与互动抉择走向',
    step: sceneScriptSubWorkflow,
    modifier: async ({ projectId, userFeedback, llm }) => {
      return await modifySceneScript({ projectId, userFeedback, llm });
    },
    summarizeArtifact: (art) => {
      if (!Array.isArray(art.scenes) || art.scenes.length === 0) return '✅ 资产已落盘';
      const maxDisplay = 10;
      const sceneItems = art.scenes.slice(0, maxDisplay).map((sc: any, idx: number) => {
        const id = sc.sceneId || `scene_${idx + 1}`;
        const loc = sc.location || '未知场景';
        const summary = sc.summary || sc.content || sc.atmosphere || '无摘要';
        const shortSum = summary.length > 35 ? summary.slice(0, 35) + '...' : summary;
        return `    * ${id}【${loc}】: ${shortSum}`;
      });
      if (art.scenes.length > maxDisplay) {
        sceneItems.push(`    ... (其余 ${art.scenes.length - maxDisplay} 场已折叠)`);
      }
      return `✅ 已就绪 (共 ${art.scenes.length} 场戏)\n${sceneItems.join('\n')}`;
    },
  },
  {
    key: 'storyboard',
    stage: WorkflowStage.STORYBOARD,
    title: '视听镜头分镜 (Storyboard)',
    order: 3,
    isPipelineStep: true,
    requireConfirmation: false,
    sopGuide: '核心任务：电影工业级视听分镜解构，明确景别（远/全/中/近/特）、机位角度、运镜轨迹（推拉摇移升降）、视线匹配与动态时长节拍。',
    reviewFocus: '镜头景别构图、机位视角与运镜动势',
    step: storyboardSubWorkflow,
    modifier: async ({ projectId, userFeedback, llm }) => {
      return await modifyStoryboard({ projectId, userFeedback, llm });
    },
    summarizeArtifact: (art) => {
      if (!Array.isArray(art.shots) || art.shots.length === 0) return '✅ 资产已落盘';
      const maxDisplay = 10;
      const shotItems = art.shots.slice(0, maxDisplay).map((sh: any, idx: number) => {
        const id = sh.shotId || `shot_${idx + 1}`;
        const shotSize = sh.shotSize || '中景';
        const cam = sh.cameraMovement || '固定';
        return `    * [${id}] ${shotSize}/${cam}: ${(sh.visualComposition || '无画面说明').slice(0, 30)}`;
      });
      if (art.shots.length > maxDisplay) {
        shotItems.push(`    ... (其余 ${art.shots.length - maxDisplay} 镜已折叠)`);
      }
      return `✅ 已就绪 (共 ${art.shots.length} 镜台本)\n${shotItems.join('\n')}`;
    },
  },
  {
    key: 'keyframe-reference',
    stage: WorkflowStage.KEYFRAME_REFERENCE,
    title: '关键帧参考图 (Keyframe Reference)',
    order: 4,
    isPipelineStep: true,
    requireConfirmation: false,
    sopGuide: '核心任务：生成每个镜头的电影级高保真起始关键帧参考图，统一色彩科学、光影基调与角色视觉锚点，为动态视频生成提供绝对稳定的基准画面。',
    reviewFocus: '起始关键帧构图、光影基准与色彩基调',
    step: keyframeReferenceSubWorkflow,
    modifier: async ({ projectId, userFeedback, target, payload }) => {
      const targetShotId = target || payload?.targetShotId;
      return await modifyKeyframeReference({
        projectId,
        targetShotId,
        userFeedback,
        isMock: payload?.isMock,
      });
    },
    summarizeArtifact: (art) => {
      if (!Array.isArray(art.keyframes) || art.keyframes.length === 0) return '✅ 资产已落盘';
      const renderedCount = art.keyframes.filter((k: any) => k.imageUrl).length;
      return `✅ 已就绪 (共 ${art.keyframes.length} 帧基准图，已渲染 ${renderedCount} 帧)`;
    },
  },
  {
    key: 'video-production',
    stage: WorkflowStage.VIDEO_PRODUCTION,
    title: '动态视频切片 (Video Production)',
    order: 5,
    isPipelineStep: true,
    requireConfirmation: false,
    sopGuide: '核心任务：基于分镜首帧与运镜提示词，调度物理视频算力生成高一致性动态视频切片，把控运动幅度与连贯性，消除角色形变与物理幻觉。',
    reviewFocus: '切片动态幅度、运镜轨迹与物理连贯性',
    step: videoProductionSubWorkflow,
    modifier: async ({ projectId, userFeedback, target, payload }) => {
      const targetShotId = target || payload?.targetShotId;
      return await modifyVideoProduction({
        projectId,
        targetShotId,
        userFeedback,
        actionRevision: Boolean(payload?.actionRevision),
        cameraTrajectory: payload?.cameraTrajectory,
        motionIntensity: payload?.motionIntensity,
        isMock: payload?.isMock,
      });
    },
    summarizeArtifact: (art) => {
      if (!Array.isArray(art.clips) || art.clips.length === 0) return '✅ 资产已落盘';
      const renderedClips = art.clips.filter((c: any) => c.videoUrl).length;
      return `✅ 已就绪 (共 ${art.clips.length} 个动态切片，已渲染 ${renderedClips} 段)`;
    },
  },
  {
    key: 'critic-review',
    stage: WorkflowStage.NARRATIVE_DESIGN, // 切面审计贯穿全生命周期，默认关联
    title: '独立审查质检 (Critic Review)',
    order: -1, // 切面审查，不参与顺向 0 到 1 批量生产流水线
    isPipelineStep: false,
    requireConfirmation: false,
    reviewFocus: '各工序资产完整度、多维评分与门禁裁决',
    step: criticReviewStep,
  },
  {
    key: 'fmv-packaging',
    stage: WorkflowStage.FMV_PACKAGING,
    title: '互动母带打包 (FMV Packaging)',
    order: 6,
    isPipelineStep: true,
    requireConfirmation: false,
    sopGuide: '核心任务：装配所有视听切片与互动抉择节点，生成完整的互动影游母带（FMV Packaging）并核验可交互图谱的连通性。',
    reviewFocus: '全片互动拓扑连通性、母带封装与沉浸体验',
    step: fmvPackagingStep,
    summarizeArtifact: (art) => {
      if (!art.gameManifestUrl) return '✅ 资产已落盘';
      return `✅ 母带已打包 (互动节点: ${art.totalNodes || 0} 个，总时长: ${art.playableDurationSec || 0}s)`;
    },
  },
];

/**
 * 快速按 key 获取工序元数据
 */
export function getStepManifest(key: string): StepManifest | undefined {
  return STEP_MANIFESTS.find((m) => m.key === key);
}

/**
 * 按 stage 获取主责工序元数据
 */
export function getStepManifestByStage(stage: WorkflowStage): StepManifest | undefined {
  return STEP_MANIFESTS.find((m) => m.stage === stage && m.isPipelineStep);
}

// -------------------------------------------------------------
// 自动推导派生层（彻底消灭 constants.ts / types/index.ts 手写死字典）
// -------------------------------------------------------------

/** 严格按位序排序的 7 大顺向法定流水线步骤 */
const pipelineManifests = STEP_MANIFESTS
  .filter((m) => m.isPipelineStep && m.order >= 0)
  .sort((a, b) => a.order - b.order);

/** 自动派生：严格对应当前系统中真实已落地的标准工序阶段序列 */
export const DERIVED_STAGE_SEQUENCE: WorkflowStage[] = pipelineManifests.map((m) => m.stage);

/** 自动派生：工序到下一阶段的权威推进映射表 */
export const DERIVED_STAGE_TRANSITION_MAP: Record<string, WorkflowStage> = {};
for (let i = 0; i < pipelineManifests.length; i++) {
  const current = pipelineManifests[i];
  const next = pipelineManifests[i + 1];
  DERIVED_STAGE_TRANSITION_MAP[current.key] = next ? next.stage : WorkflowStage.COMPLETED;
}

/** 自动派生：各技能对应的法定工序阶段 */
export const DERIVED_STAGE_OF_SKILL: Record<string, WorkflowStage> = {};
for (const m of STEP_MANIFESTS) {
  DERIVED_STAGE_OF_SKILL[m.key] = m.stage;
}

/** 自动派生：工序阶段对应的主责技能 */
export const DERIVED_SKILL_OF_STAGE: Record<string, string> = {};
for (const m of pipelineManifests) {
  DERIVED_SKILL_OF_STAGE[m.stage] = m.key;
}

/** 自动派生：各工序工业标准显示标题 */
export const DERIVED_SKILL_TITLES: Record<string, string> = {};
for (const m of STEP_MANIFESTS) {
  DERIVED_SKILL_TITLES[m.key] = `生成${m.title}`;
}
if (DERIVED_SKILL_TITLES['critic-review']) {
  DERIVED_SKILL_TITLES['critic-review'] = '审查官多维质检评估 (Critic Review)';
}

/**
 * 动态渲染 Prompt 中的法定工序列表文本
 */
export function buildLegalStepsPromptText(): string {
  return STEP_MANIFESTS
    .map((m, idx) => `${idx + 1}. ${m.key} (${m.title})`)
    .join('\n');
}
