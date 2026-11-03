/**
 * server/src/knowledge/motion-dialects.ts
 * 图生视频 (I2V) 纯动量增量引擎 (Delta Motion Engine)
 * 核心法则：彻底剔除静图长相/服装等冗余描述，仅向视频扩散模型注入主体时序动量、摄像机轨迹与环境动力学
 */

export interface DeltaMotionInput {
  rawKeyframePrompt?: string;      // 关键帧原 Prompt (包含静态描述，需中英清洗脱敏)
  subjectMotion?: string;          // 主体时序微动作 (如: 眼神微动，随后猛然抬头)
  cameraTrajectory?: string;       // 摄像机物理轨迹 (如: 向前推进、弧形环绕)
  sceneDynamics?: string;          // 环境动力学 (如: 烟尘弥漫、雨丝滑落)
  userFeedback?: string;           // 创作者人在回路额外微调指示
  motionIntensity?: 'low' | 'normal' | 'high'; // 动量幅度
}

/**
 * 静态特征清洗器：中英双语过滤人脸长相、发型颜色、静态衣着与通用画质词，
 * 防止 I2V 阶段注意力冲突导致面部融化闪烁
 */
export function sanitizeStaticAttributes(prompt: string): string {
  if (!prompt) return '';

  const noisePatterns = [
    // 中文静态特征
    /五官[^\s，,。；;]*/g,
    /长相[^\s，,。；;]*/g,
    /身穿[^\s，,。；;]*/g,
    /穿着[^\s，,。；;]*/g,
    /发色[^\s，,。；;]*/g,
    /(黑发|白发|金发|卷发|短发|长发)/g,
    /瞳孔[^\s，,。；;]*/g,
    /容貌[^\s，,。；;]*/g,
    /高清|超高清|超写实|杰作/g,

    // 英文静态特征与画质词
    /\b(black|white|blonde|brown|red|short|long|curly)\s+hair\b/gi,
    /\b(wearing|dressed in|outfit)\s+[a-z0-9\s-]+(?=[,\.;]|$)/gi,
    /\b(beautiful|detailed|handsome|sharp)\s+(face|eyes|features)\b/gi,
    /\b(ultra-detailed|photorealistic|hyperrealistic|masterpiece|8k|4k|high quality|high-res)\b/gi,
  ];

  let cleaned = prompt;
  for (const pattern of noisePatterns) {
    cleaned = cleaned.replace(pattern, '');
  }

  // 清洗中英文标点残余与多余空白
  return cleaned
    .replace(/[，,]{2,}/g, '，')
    .replace(/^[，,\s\.;]+|[，,\s\.;]+$/g, '')
    .trim();
}

/**
 * 纯动量时序增量组装器 (OpenMontage Delta Motion Assembler)
 */
export function assembleDeltaMotionPrompt(input: DeltaMotionInput): string {
  const parts: string[] = [];

  // 1. 主体时序微动作（赋予角色生命动量）
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

  // 3. 环境动力学与光影交互 (优先使用显式动力学，若无则使用脱敏清洗后的原关键帧氛围底色)
  let dynamics = input.sceneDynamics?.trim();
  if (!dynamics && input.rawKeyframePrompt) {
    const cleanedAtmosphere = sanitizeStaticAttributes(input.rawKeyframePrompt);
    if (cleanedAtmosphere) {
      dynamics = cleanedAtmosphere;
    }
  }
  if (dynamics) {
    parts.push(`【环境动力学】：${dynamics}`);
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
