import { getSkillPrompt, loadBuiltinMastraSkills, formatSkillActivation, getSkillsForStage } from '../../../skills/index.js';

export { getSkillsForStage };

/**
 * 工序共享的构图与时序指导。创作者风格和当前镜头要求优先于默认建议。
 * 深度理论与完整公理已收录于 Skills 知识库（cinematic-storyboarding 与 blocking-and-acting-direction）。
 * 运行时提示词专注于高能量实战指令，彻底去除八股标签。
 */
export const CINEMATIC_KEYFRAME_NEGATIVE_PROMPT =
  '非预期三视图拼贴，非预期人物复制，对称居中构图，重复桌台，克隆家具，背对交互目标，直视镜头，正脸看镜头，非自然对视，五官漂移，服装走样，肢体畸形，低画质，水印，非预期文字标签';

export const CINEMATIC_CONTINUITY_LOCK =
  '沿用项目与参考资产的视觉风格；同一连续场景保持角色身份、道具状态与空间关系一致。' +
  '光照随时间、场景和机位合理变化；构图、材质与色彩服从本镜头要求。';

/**
 * 动态加载项目内置技能库中的领域知识（遵循 Mastra 官方技能规约与格式化器）
 */
export function getCinematicSkill(skillName: string): string {
  const skills = loadBuiltinMastraSkills();
  const s = skills.get(skillName);
  return s ? formatSkillActivation(s) : getSkillPrompt(skillName);
}

export const CINEMATIC_TEMPORAL_DYNAMICS_SPEC = `【视频时序与景别动能分级准则（Cinematic LOD Motion SSOT）】：
1. 【时长匹配】：纯定场交代 2.0~2.5s（运镜与环境流）；剧情动作与走位 3.5~5.0s（完整骨骼动作链）。
2. 【景别动能分级（LOD）】：
   - 全景/远景：动量集中于运镜、环境流体与骨骼大幅位移，严禁呼吸起伏/喉结微动等亚像素假微动；
   - 中景：躯干姿态、肢体道具交互与视线转移；
   - 近景/特写：释放面部微表情、眼神流转与生理呼吸；
3. 【第 0 秒起幅红线】：首帧只定格视频动作第 0 毫秒的起始位置与起手准备姿态；严禁将本镜动作的终点位置或完成态（如走位到位、手指已触及目标等）提前画入首帧，完整位移与动作过程必须留给视频生成。`;

export const CINEMATIC_FIVE_LAYER_FRAMEWORK = `【电影摄影与空间视听五层体系实战准则（核心精炼版 · 详见Skills库）】：
1. 机位视点与透视：摄影机置于室内围合空间，明确拍摄方位与俯仰角度（严禁门外探拍，中景斜下俯拍/平视）；
2. 空间行动轴与反打：中景/反打镜头严格执行【1.2米半径裁切】，排除全景大件地标（大型陈设/桌案/主台只能作为极边缘虚焦借景或出画）；
3. 重力解剖与着力点：非站立姿态必须写明【臀部贴地、双膝曲起护胸、重心极低】，严禁模糊写“蜷缩发抖”，彻底排斥站姿；
4. 道具三点物理接触：手持道具必须写明【手握部位 + 道具部位 + 地面/环境接触】（如右手握持把柄，道具末端垂直抵地），杜绝空手与漂移；
5. 光影质感与视线对冲：主辅光冷暖对撞，视线与摄影机形成戏剧透视对撞，纯正向肯定句描摹。`;
