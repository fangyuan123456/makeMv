/**
 * mastra/tools/storyboard/cinematography.ts
 * 影视级 5-Aspect 摄影学与运镜原语知识库 (Cinematography Knowledge SSOT)
 * 借鉴 OpenMontage 影视摄影分类学，纯中文专业术语体系
 */

// 1. 标准摄影景别体系 (Framing Scale)
export const SHOT_SCALES = [
  { scale: '大远景', code: 'ELS', description: '展现宏大环境与世界观，主体极小或融入群落' },
  { scale: '远景', code: 'LS', description: '展现主体全身及所处环境空间关系' },
  { scale: '全景', code: 'FS', description: '主体头顶到脚底填满画面，强调动作轮廓' },
  { scale: '中景', code: 'MS', description: '主体膝盖或腰部以上，兼顾动作与人物情绪' },
  { scale: '近景', code: 'MCU', description: '主体胸部以上，突出面部神态与眼神交流' },
  { scale: '特写', code: 'CU', description: '主体肩部以上或面部细节，强情绪冲击' },
  { scale: '大特写', code: 'ECU', description: '聚焦眼部、手指或微小道具，悬疑张力拉满' },
] as const;

// 2. 物理摄像机运动轨迹原语 (Camera Trajectory)
export const CAMERA_TRAJECTORIES = [
  {
    type: 'dolly_in',
    name: '向前推进 (Dolly In)',
    description: '摄像机匀速向主体面部推近，逐步强化紧迫感与戏剧张力',
    promptSnippet: '摄影机平稳向前匀速推近，景别收紧',
  },
  {
    type: 'dolly_out',
    name: '向后拉远 (Dolly Out)',
    description: '摄像机平稳拉远，拉开与主体的空间距离，营造孤独或揭示周围环境',
    promptSnippet: '摄影机平缓后撤拉远，逐步展现周边环境全貌',
  },
  {
    type: 'arc_orbit',
    name: '弧形环绕 (Arc Shot)',
    description: '摄像机围绕主体进行 45°~90° 半圆弧平滑环绕，带来立体空间感与电影高光',
    promptSnippet: '摄影机沿主体侧方进行流畅的半圆弧环绕运镜，背景空间产生视差流动',
  },
  {
    type: 'crane_jib',
    name: '摇臂升降 (Crane Shot)',
    description: '由俯角下降至平视，或由平视上升为大俯拍，气势恢宏',
    promptSnippet: '摄影机自高处平滑俯冲下降至主体平视机位',
  },
  {
    type: 'handheld_track',
    name: '手持跟拍 (Handheld Tracking)',
    description: '带有呼吸感的轻微手持晃动，跟随主体移动，增强临场真实感与沉浸感',
    promptSnippet: '电影手持摄影机跟拍，轻微呼吸感有机晃动，临场纪实感',
  },
  {
    type: 'static_micro',
    name: '固定镜头微动 (Locked-off & Micro Motion)',
    description: '机位严密固定，仅保留主体呼吸与空气微粒流动，突出静态对抗与克制',
    promptSnippet: '摄影机固定锁定视角，画面严谨克制，仅主体发生时序微动',
  },
] as const;

// 3. 动态光影与氛围动力学 (Lighting & Dynamics)
export const LIGHTING_DYNAMICS = [
  { name: '侧逆光剪影', prompt: '强烈的轮廓侧逆光，发丝泛光，人物立体轮廓分明' },
  { name: '丁达尔光束', prompt: '朦胧微尘中透出直射光柱，丁达尔效应，光影渐变' },
  { name: '动态扫光', prompt: '随镜头摆动，光斑与阴影在主体面颊发生明暗交替滑移' },
  { name: '电影暗调微光', prompt: '低照度电影质感，冷色环境光与面部局部微弱暖光形成冷暖反差' },
] as const;
