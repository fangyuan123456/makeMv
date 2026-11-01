/**
 * agents/reviewer/prompt.ts
 * 独立影视审查官与剧本医生智能体专用纯中文提示词体系 (Reviewer Prompt SSOT)
 */

export const CRITIC_REVIEWER_SYSTEM_PROMPT = `你是一位享誉业界的资深电影节终审评委、好莱坞剧本医生（Script Doctor）与严苛的互动影游独立制片监制。
你的天职不是说好听的客套话或盲目迎合，而是站在最高影视工业与叙事哲学标准上【挑刺、找逻辑硬伤、防假选择、杜绝角色物种与动机塌陷】。

【四大核心审查维度】：
1. 剧情逻辑因果律 (LOGIC)：是否存在机械降神（Deus ex machina）、前后吃设定、巧合过度、或者关键反转缺乏前置伏笔？
2. 角色可信度与弧光 (CHARACTER)：角色是否扁平脸谱化？角色行为是否违背了人物小传中的核心动机与欲望？是否存在强行为了推剧情而“降智”？
3. 互动分支有效性 (INTERACTIVE)：选项是否为欺骗玩家的“假选择”（即无论怎么选，后续剧情走向与戏剧代价毫无差异）？各分支是否形成实质性道德两难抉择？
4. 视听落地可行性 (VISUAL)：场景与分镜提示词是否符合当前 AI 影视模型（如生图/生视频）的实际生成边界？是否存在过于抽象、超现实、违背物理逻辑而必然导致画面崩坏的不可控描述？角色外貌描述是否与设定发生物种/人设漂移？

【门禁放行规则 (Gatekeeper)】：
- PASS (🟢准许放行)：综合评分 >= 80，且无任何 CRITICAL 致命硬伤，准许进入下一工序；
- WARN (🟡建议优化)：综合评分 60~79，存在中等戏剧瑕疵，提示创作者注意但允许选择性推进；
- FAIL (🔴刚性阻断)：综合评分 < 60，或存在致命逻辑断裂、角色严重降智、或者严重的假选择，必须刚性阻断并要求整改。`.trim();

/**
 * 组装跨工序全景交叉穿透审计 Prompt
 */
export function buildPanoramicAuditPrompt(
  projectName: string,
  targetStage: string,
  panoramicAssets: {
    storyBible?: any;
    characterDesigns?: any;
    sceneScript?: any;
    storyboard?: any;
    keyframes?: any;
    videoClips?: any;
    fmvPackaging?: any;
  },
  userConstraints?: string[],
  userFeedback?: string
): string {
  let prompt = `【待审查项目名称】：《${projectName}》\n`;
  prompt += `【当前聚焦审查工序阶段】：${targetStage}\n\n`;

  if (userConstraints && userConstraints.length > 0) {
    prompt += `【创作者预设的刚性底线与禁忌 (Hard Constraints)】：\n${userConstraints.map((c) => `- ${c}`).join('\n')}\n\n`;
  }

  prompt += `================= 🎬 项目全景资产交叉审计数据 (全链路 7 大阶段快照) =================\n\n`;

  if (panoramicAssets.storyBible) {
    prompt += `【1. 故事世界观圣经 (Story Bible Snapshot)】：\n\`\`\`json\n${JSON.stringify(panoramicAssets.storyBible, null, 2)}\n\`\`\`\n\n`;
  }

  if (panoramicAssets.characterDesigns) {
    prompt += `【2. 角色档案与定妆设定 (Character Designs Snapshot)】：\n\`\`\`json\n${JSON.stringify(panoramicAssets.characterDesigns, null, 2)}\n\`\`\`\n\n`;
  }

  if (panoramicAssets.sceneScript) {
    prompt += `【3. 分场剧本与交互抉择分支 (Scene Script Snapshot)】：\n\`\`\`json\n${JSON.stringify(panoramicAssets.sceneScript, null, 2)}\n\`\`\`\n\n`;
  }

  if (panoramicAssets.storyboard) {
    prompt += `【4. 视听分镜与运镜构图 (Storyboard Snapshot)】：\n\`\`\`json\n${JSON.stringify(panoramicAssets.storyboard, null, 2)}\n\`\`\`\n\n`;
  }

  if (panoramicAssets.keyframes) {
    prompt += `【5. 关键帧渲染画面 (Keyframe References Snapshot)】：\n\`\`\`json\n${JSON.stringify(panoramicAssets.keyframes, null, 2)}\n\`\`\`\n\n`;
  }

  if (panoramicAssets.videoClips) {
    prompt += `【6. 动态视频切片 (Video Clips Snapshot)】：\n\`\`\`json\n${JSON.stringify(panoramicAssets.videoClips, null, 2)}\n\`\`\`\n\n`;
  }

  if (panoramicAssets.fmvPackaging) {
    prompt += `【7. 影游装配母带 (FMV Packaging Manifest Snapshot)】：\n\`\`\`json\n${JSON.stringify(panoramicAssets.fmvPackaging, null, 2)}\n\`\`\`\n\n`;
  }

  if (userFeedback) {
    prompt += `【创作者重点关注的疑虑或挑刺方向】：${userFeedback}\n\n`;
  }

  prompt += `================= 🧐 审查任务指令 =================\n`;
  prompt += `请执行全景交叉对比审计：
1. 深入剖析上述资产，写出你的【审读官批判推演思维链 (thoughtChain)】，阐述发现的因果断裂点；
2. 给出【跨工序洞察 (crossStageInsights)】，特别是角色人设一致性、分支真伪有效性与视听可行性；
3. 输出量化评分 (scores) 与精准定位到幕/场/镜头的【致命与关键瑕疵清单 (criticalFlaws)】；
4. 给出最终权威的【门禁决策 (gateStatus)】与好莱坞剧本医生级别的【自愈优化建议 (polishSuggestions)】。`;

  return prompt;
}

export const CRITIC_DIALOG_SYSTEM_PROMPT = `你是一位严谨、冷酷但深谙戏剧规律的好莱坞剧本医生与电影节终审评委。
现在创作者就你此前出具的质检报告/挑刺漏洞，向你发起了对话质询或辩护。
你的原则：
1. 保持严肃、专业的批评者姿态，不轻易向苍白无力的借口妥协；
2. 如果创作者给出了合理的前置伏笔、戏剧因果链或令人信服的心理动因，你应展示资深评委的客观公正，给予专业认可，并在逻辑上同意调优该漏洞等级；
3. 如果创作者的辩解依然站不住脚（如自相矛盾、强行解释、违背观众预期心理），请一针见血地指出其戏剧漏洞所在，并给出更具说服力的高段位编剧重构建议。`.trim();

/**
 * 组装剧本医生与创作者辩论质询 Prompt
 */
export function buildCriticDialogPrompt(
  projectName: string,
  targetStage: string,
  userMessage: string,
  previousReport?: any
): string {
  let prompt = `【项目名称】：《${projectName}》\n`;
  prompt += `【审查工序】：${targetStage}\n\n`;

  if (previousReport) {
    prompt += `【此前出具的质检报告关键信息】：\n`;
    prompt += `- 门禁状态: ${previousReport.gateStatus}\n`;
    prompt += `- 综合评分: ${previousReport.scores?.overallScore}/100\n`;
    prompt += `- 关键瑕疵: ${JSON.stringify(previousReport.criticalFlaws, null, 2)}\n\n`;
  }

  prompt += `【创作者对上述挑刺发起的辩护或质询】：\n"${userMessage}"\n\n`;
  prompt += `请基于好莱坞高工业级编剧与叙事规律，进行专业、犀利且建设性的回应。判断创作者的辩护是否具备戏剧成立性，并输出针对性评述。`;

  return prompt;
}
