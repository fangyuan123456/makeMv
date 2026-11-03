/**
 * server/src/knowledge/motion-dialects.ts
 * 图生视频 (I2V) 纯动量增量引擎与模型方言适配器 (Delta Motion Engine & Dialects)
 * 核心法则：彻底剔除静图长相/服装等冗余描述，仅向视频扩散模型注入主体时序动量、摄像机轨迹与环境动力学
 */

export interface DeltaMotionInput {
  rawKeyframePrompt?: string;      // 关键帧原 Prompt (包含静态描述，需清洗脱敏)
  subjectMotion?: string;          // 主体时序微动作 (如: 眼神微动，随后猛然抬头)
  cameraTrajectory?: string;       // 摄像机物理轨迹 (如: 向前推进、弧形环绕)
  sceneDynamics?: string;          // 环境动力学 (如: 烟尘弥漫、雨丝滑落)
  userFeedback?: string;           // 创作者人在回路额外微调指示
  motionIntensity?: 'low' | 'normal' | 'high'; // 动量幅度
  modelProvider?: 'dashscope' | 'kling' | 'local'; // 目标渲染器方言
}

/**
 * 静态特征清洗器：过滤人脸长相、发型颜色、静态衣着等文生图专有冗余词，防止 I2V 阶段注意力冲突导致面部融化闪烁
 */
export function sanitizeStaticAttributes(prompt: string): string {
  if (!prompt) return '';

  // 剔除常见的静态特征描述，保留环境或氛围底色
  const noisePatterns = [
    /五官[^\s，,。；;]*/g,
    /长相[^\s，,。；;]*/g,
    /身穿[^\s，,。；;]*/g,
    /穿着[^\s，,。；;]*/g,
    /发色[^\s，,。；;]*/g,
    /黑发|白发|金发|卷发|短发|长发/g,
    /瞳孔[^\s，,。；;]*/g,
    /容貌[^\s，,。；;]*/g,
    /高清[^\s，,。；;]*/g,
    /8k|4k|masterpiece|photorealistic/gi,
  ];

  let cleaned = prompt;
  for (const pattern of noisePatterns) {
    cleaned = cleaned.replace(pattern, '');
  }

  // 清洗多余逗号和空白
  return cleaned
    .replace(/[，,]{2,}/g, '，')
    .replace(/^[，,\s]+|[，,\s]+$/g, '')
    .trim();
}

/**
 * 纯动量时序增量组装器 (OpenMontage Delta Motion Assembler)
 */
export function assembleDeltaMotionPrompt(input: DeltaMotionInput): string {
  const parts: string[] = [];

  // 1. 主体时序微动作（最核心，赋予角色生命感）
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

  // 3. 环境动力学与光影交互
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

  // 6. 模型方言适配
  const baseResult = parts.join('，');
  if (input.modelProvider === 'kling') {
    // 可灵模型偏好：高动量动词链，逗号分隔短语
    return baseResult.replace(/【[^】]+】：/g, '');
  }

  // 默认 (如 Wan2.1 / DashScope)：电影叙述性中文纯动量
  return `电影级真实动态序列：${baseResult}。画面连贯平稳，第一帧人物特征严格锁定不形变。`;
}
