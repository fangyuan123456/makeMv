/**
 * server/src/knowledge/motion-dialects.ts
 * 图生视频 (I2V) 纯动量增量引擎 (Delta Motion Engine SSOT)
 * 核心法则：源头结构化物理隔离，彻底断绝静态长相污染，仅注入时序动作、物理运镜与环境动力学
 */

export interface DeltaMotionInput {
  sceneDynamics?: string;          // 环境动力学 (来自分镜 sceneDynamics 或关键帧 sceneEnvironment)
  subjectMotion?: string;          // 主体时序微动作 (如: 眼神微动，随后猛然抬头)
  cameraTrajectory?: string;       // 摄像机物理轨迹 (如: 向前推进、弧形环绕)
  userFeedback?: string;           // 创作者人在回路额外微调指示
  motionIntensity?: 'low' | 'normal' | 'high'; // 动量幅度
}

/**
 * 纯动量时序增量组装器 (OpenMontage Delta Motion Assembler)
 */
export function assembleDeltaMotionPrompt(input: DeltaMotionInput): string {
  const parts: string[] = [];

  // 1. 主体时序微动作（赋予角色生命动量，杜绝假人木偶感）
  if (input.subjectMotion && input.subjectMotion.trim()) {
    parts.push(`【主体动作】：${input.subjectMotion.trim()}`);
  } else {
    parts.push('【主体动作】：自然呼吸与眼神微动，保持生理真实感');
  }

  // 2. 摄影机物理运镜轨迹
  if (input.cameraTrajectory && input.cameraTrajectory.trim()) {
    parts.push(`【运镜轨迹】：${input.cameraTrajectory.trim()}`);
  } else {
    parts.push('【运镜轨迹】：摄影机平稳向前推近，景别匀速收紧');
  }

  // 3. 场景物理环境与光影动力学 (来自上游结构化物理分流，100% 纯净无面部污染)
  if (input.sceneDynamics && input.sceneDynamics.trim()) {
    parts.push(`【环境动力学】：${input.sceneDynamics.trim()}`);
  }

  // 4. 动量强度修饰
  if (input.motionIntensity === 'high') {
    parts.push('动态幅度强烈，张力拉满，动作干净利落');
  } else if (input.motionIntensity === 'low') {
    parts.push('动作极为细腻克制，微幅平缓动态');
  }

  // 5. 创作者人在回路靶向指令
  if (input.userFeedback && input.userFeedback.trim()) {
    parts.push(`【导演靶向微调】：${input.userFeedback.trim()}`);
  }

  const baseResult = parts.join('，');
  return `电影级真实动态序列：${baseResult}。画面连贯平稳，第一帧人物特征严格锁定不形变。`;
}
