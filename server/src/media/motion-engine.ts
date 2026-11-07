/**
 * media/motion-engine.ts
 * 图生视频 (I2V) 纯动量增量引擎与动作姿态时序解构器 (Delta Motion & Key Pose Engine SSOT)
 *
 * 层归属：媒体基础设施。生成轨与修改轨都向下依赖本层，二者之间无横向引用。
 * 原位置：agents/director/generator/steps/video-production/motion-engine.ts（已改为 re-export）
 */

import { LLMRegistry } from '../llm/LLMRegistry.js';
import type { KeyPoseItem } from '../artifacts/video-production.js';

export interface DeltaMotionInput {
  sceneDynamics?: string;
  subjectMotion?: string;
  cameraTrajectory?: string;
  userFeedback?: string;
  motionIntensity?: 'low' | 'normal' | 'high';
  characterPrompt?: string;
}

export interface BreakdownKeyPosesOptions {
  shotId: string;
  subjectMotion?: string;
  userFeedback?: string;
  durationSec?: number;
  isMock?: boolean;
}

export function assembleDeltaMotionPrompt(input: DeltaMotionInput): string {
  const parts: string[] = [];

  if (input.characterPrompt && input.characterPrompt.trim()) {
    parts.push(`【主体角色锁定】：${input.characterPrompt.trim()}`);
  }

  if (input.subjectMotion && input.subjectMotion.trim()) {
    parts.push(`【主体动作】：${input.subjectMotion.trim()}`);
  } else {
    parts.push('【主体动作】：自然呼吸与眼神微动，保持生理真实感');
  }

  if (input.cameraTrajectory && input.cameraTrajectory.trim()) {
    parts.push(`【运镜轨迹】：${input.cameraTrajectory.trim()}`);
  } else {
    parts.push('【运镜轨迹】：摄影机平稳向前推近，景别匀速收紧');
  }

  if (input.sceneDynamics && input.sceneDynamics.trim()) {
    parts.push(`【环境动力学】：${input.sceneDynamics.trim()}`);
  }

  if (input.motionIntensity === 'high') {
    parts.push('动态幅度强烈，张力拉满，动作干净利落');
  } else if (input.motionIntensity === 'low') {
    parts.push('动作极为细腻克制，微幅平缓动态');
  }

  if (input.userFeedback && input.userFeedback.trim()) {
    parts.push(`【导演靶向微调】：${input.userFeedback.trim()}`);
  }

  const baseResult = parts.join('，');
  return `电影级真实动态序列：${baseResult}。画面连贯平稳，第一帧人物特征严格锁定不形变。`;
}

export async function breakdownActionKeyPoses(
  options: BreakdownKeyPosesOptions
): Promise<KeyPoseItem[]> {
  const { shotId, subjectMotion = '', userFeedback = '', durationSec = 3, isMock = false } = options;

  const timestamps: number[] = [];
  if (durationSec <= 2.5) {
    timestamps.push(0.0, Math.round(durationSec * 10) / 10);
  } else if (durationSec <= 4.5) {
    timestamps.push(0.0, Math.round((durationSec / 2) * 10) / 10, Math.round(durationSec * 10) / 10);
  } else {
    timestamps.push(
      0.0,
      Math.round((durationSec / 3) * 10) / 10,
      Math.round(((durationSec * 2) / 3) * 10) / 10,
      Math.round(durationSec * 10) / 10
    );
  }

  if (isMock || (!subjectMotion.trim() && !userFeedback.trim())) {
    return generateFallbackPoses(timestamps, subjectMotion, userFeedback);
  }

  try {
    const llm = LLMRegistry.get();
    const prompt = `你是一名资深动画原画师与动作导演。请将以下分镜镜头在 ${durationSec} 秒内的肢体动作与动态，拆解为 ${timestamps.length} 个关键动作姿态卡点（Key Poses）：

镜头编号：${shotId}
原设动作：${subjectMotion || '自然动态'}
导演修改指示：${userFeedback || '优化动作连贯性与张力'}
时间轴卡点(秒)：${timestamps.join(', ')}

请直接返回一个标准的 JSON 数组，严禁包含 markdown 标记或多余文字，结构如下：
[
  {
    "poseIndex": 0,
    "timestampSec": 0.0,
    "poseName": "动作简述 (如: 拔剑蓄力起势)",
    "poseDescription": "镜头中角色的精确肢体姿势、面部朝向、动态发力点细节"
  }
]`;

    const response = await llm.generateText(prompt);
    const cleaned = response.trim().replace(/^```json/i, '').replace(/```$/i, '').trim();
    const parsed = JSON.parse(cleaned);

    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed.map((item: any, idx: number) => ({
        poseIndex: typeof item.poseIndex === 'number' ? item.poseIndex : idx,
        timestampSec: typeof item.timestampSec === 'number' ? item.timestampSec : (timestamps[idx] ?? idx * 1.5),
        poseName: String(item.poseName || `动作姿态 #${idx + 1}`),
        poseDescription: String(item.poseDescription || '动态姿态平滑过渡'),
      }));
    }
  } catch (err) {
    console.warn(`[motion-engine] LLM 动作解构降级为基础时序卡点:`, err);
  }

  return generateFallbackPoses(timestamps, subjectMotion, userFeedback);
}

function generateFallbackPoses(
  timestamps: number[],
  subjectMotion: string,
  userFeedback: string
): KeyPoseItem[] {
  const actionCore = userFeedback || subjectMotion || '肢体动作';
  const stageNames = ['起始准备姿态', '核心动作发力卡点', '动作高潮延伸', '动作收式定格'];

  return timestamps.map((ts, idx) => {
    const name = stageNames[idx] || `动作姿态阶段 #${idx + 1}`;
    let desc = `${name}：`;
    if (idx === 0) {
      desc += `角色处于动作起始状态，目光锁定目标，肌肉紧绷准备发力（对应：${actionCore}）`;
    } else if (idx === timestamps.length - 1) {
      desc += `角色完成全套动态，姿态稳定定格，带出衣角与发丝惯性回摆`;
    } else {
      desc += `动作完全舒展释放，速度与力量达到峰值，肢体轨迹清晰连贯`;
    }

    return {
      poseIndex: idx,
      timestampSec: ts,
      poseName: name,
      poseDescription: desc,
    };
  });
}

export function assemblePoseGuidedMotionPrompt(
  keyPoses: KeyPoseItem[],
  baseInput: DeltaMotionInput
): string {
  const poseSteps = keyPoses
    .sort((a, b) => a.timestampSec - b.timestampSec)
    .map((p) => `【${p.timestampSec}s ${p.poseName}】：${p.poseDescription}`)
    .join(' ➔ ');

  return assembleDeltaMotionPrompt({
    ...baseInput,
    subjectMotion: `严格按时序动作卡点平滑推进：${poseSteps}`,
    motionIntensity: 'high',
  });
}
