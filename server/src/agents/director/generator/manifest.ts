/**
 * agents/director/generator/manifest.ts
 * 生成轨执行体装配清单 (Producer Manifest Assembly)
 *
 * 分工：
 * 1. 目录（key / stage / title / order / flags / SOP）由 ../catalog.ts 统一持有（中立 SSOT）；
 * 2. 本文件只做一件事：把 SKILL_CATALOG 与生成轨的 Mastra Step、黑板摘要器装配成 StepManifest；
 * 3. 本文件不再持有任何修改轨执行体：微调的唯一入口是 modifier/modifier.workflow.ts，
 *    生成轨与修改轨之间零运行时依赖。
 */

import type { WorkflowStage } from '../../../types/index.js';
import { SKILL_CATALOG, type SkillMeta } from '../catalog.js';
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

export interface StepManifest extends SkillMeta {
  /** Mastra 顺向生产 Step 微内核实例 */
  step: any;
  /** 高信噪比黑板态势摘要提取器 (供 ContextAssembler 统一消费) */
  summarizeArtifact?: (artifact: any) => string;
}

/** 生成轨执行体：各工序的 Mastra Step */
const PRODUCERS: Record<string, any> = {
  'story-bible': storyBibleSubWorkflow,
  'character-portrait': characterPortraitSubWorkflow,
  'scene-script': sceneScriptSubWorkflow,
  storyboard: storyboardSubWorkflow,
  'keyframe-reference': keyframeReferenceSubWorkflow,
  'video-production': videoProductionSubWorkflow,
  'critic-review': criticReviewStep,
  'fmv-packaging': fmvPackagingStep,
};

/** 生成轨黑板摘要器：只描述「这个工序落盘后产出了什么」 */
const SUMMARIZERS: Record<string, (art: any) => string> = {
  'story-bible': (art) => {
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
  'character-portrait': (art) => {
    if (!Array.isArray(art.characters) || art.characters.length === 0) return '✅ 资产已落盘';
    const charItems = art.characters.map((c: any, idx: number) => {
      const status = c.imageUrl ? '✓已定妆' : '待渲染';
      const visual = c.visualPrompt || '暂无详细描述';
      const shortVisual = visual.length > 35 ? visual.slice(0, 35) + '...' : visual;
      return `    * [${idx + 1}] ${c.name} (${status}): ${shortVisual}`;
    });
    return `✅ 已就绪 (共 ${art.characters.length} 位角色)\n${charItems.join('\n')}`;
  },
  'scene-script': (art) => {
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
  storyboard: (art) => {
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
  'keyframe-reference': (art) => {
    if (!Array.isArray(art.keyframes) || art.keyframes.length === 0) return '✅ 资产已落盘';
    const renderedCount = art.keyframes.filter((k: any) => k.imageUrl).length;
    return `✅ 已就绪 (共 ${art.keyframes.length} 帧基准图，已渲染 ${renderedCount} 帧)`;
  },
  'video-production': (art) => {
    if (!Array.isArray(art.clips) || art.clips.length === 0) return '✅ 资产已落盘';
    const renderedClips = art.clips.filter((c: any) => c.videoUrl).length;
    return `✅ 已就绪 (共 ${art.clips.length} 个动态切片，已渲染 ${renderedClips} 段)`;
  },
  'fmv-packaging': (art) => {
    if (!art.gameManifestUrl) return '✅ 资产已落盘';
    return `✅ 母带已打包 (互动节点: ${art.totalNodes || 0} 个，总时长: ${art.playableDurationSec || 0}s)`;
  },
};

/**
 * 互动影游全流程标准工序清单（目录 + 生成轨执行体 装配结果）
 */
export const STEP_MANIFESTS: StepManifest[] = SKILL_CATALOG.map((meta) => {
  const manifest: StepManifest = {
    ...meta,
    step: PRODUCERS[meta.key],
  };
  const summarizer = SUMMARIZERS[meta.key];
  if (summarizer) {
    manifest.summarizeArtifact = summarizer;
  }
  return manifest;
});

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
// 派生层统一由 catalog 提供（此处仅做向后兼容再导出）
// -------------------------------------------------------------
export {
  DERIVED_STAGE_SEQUENCE,
  DERIVED_STAGE_TRANSITION_MAP,
  DERIVED_STAGE_OF_SKILL,
  DERIVED_SKILL_OF_STAGE,
  DERIVED_SKILL_TITLES,
  buildLegalStepsPromptText,
} from '../catalog.js';
