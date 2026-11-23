/**
 * client/src/components/studio/canvas/presets/directorPresets.tsx
 * 影视工业级导演视听预设中枢 (Director Visual Presets SSOT)
 *
 * 包含三大维度：
 * 1. 🎥 机位与视角 (Camera Angles & Framing)
 * 2. 🎨 电影调色与光影 (Color Grading & Lighting)
 * 3. 🧍 演员姿态与眼神 (Actor Pose & Stance)
 *
 * 每个预设均自带极具辨识度的独立矢量 SVG 视觉示意图，告别纯文字抽象描述。
 */

import React from 'react';

export type PresetCategory = 'camera' | 'color' | 'pose';

export interface DirectorPreset {
  id: string;
  category: PresetCategory;
  name: string;
  enName: string;
  badge: string;
  description: string;
  instruction: string;
  renderThumbnail: () => React.ReactNode;
}

export const DIRECTOR_PRESETS: DirectorPreset[] = [
  // ==================== 🎥 机位与视角 (Camera Angles) ====================
  {
    id: 'cam_low_angle',
    category: 'camera',
    name: '低机位仰拍',
    enName: 'Low Angle',
    badge: '威慑压迫',
    description: '摄影机由下往上仰视，增强主体威严崇高感与压迫力',
    instruction: '将镜头机位调整为低机位仰拍视角（Low Angle Hero Shot），由下往上仰视主体，增强角色的威严压迫感与环境纵深',
    renderThumbnail: () => (
      <svg viewBox="0 0 80 50" className="w-full h-full" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect width="80" height="50" rx="6" fill="#0f172a" />
        {/* 地平面 */}
        <line x1="8" y1="42" x2="72" y2="42" stroke="#334155" strokeWidth="1.5" strokeDasharray="2 2" />
        {/* 低机位摄影机 */}
        <g transform="translate(14, 30)">
          <rect x="0" y="0" width="14" height="9" rx="1.5" fill="#38bdf8" />
          <path d="M14 2L20 -1V10L14 7V2Z" fill="#0284c7" />
          <line x1="7" y1="9" x2="3" y2="13" stroke="#94a3b8" strokeWidth="1.5" />
          <line x1="7" y1="9" x2="11" y2="13" stroke="#94a3b8" strokeWidth="1.5" />
        </g>
        {/* 视锥线向上投射 */}
        <path d="M34 32L62 10L68 28Z" fill="#38bdf8" fillOpacity="0.12" />
        <line x1="34" y1="32" x2="62" y2="10" stroke="#38bdf8" strokeWidth="1" strokeDasharray="2 2" />
        <line x1="34" y1="32" x2="68" y2="28" stroke="#38bdf8" strokeWidth="1" strokeDasharray="2 2" />
        {/* 雄伟主体人物剪影 */}
        <path d="M60 12C60 10.3 61.3 9 63 9C64.7 9 66 10.3 66 12C66 13.7 64.7 15 63 15C61.3 15 60 13.7 60 12Z" fill="#e2e8f0" />
        <path d="M57 16H69L71 42H55L57 16Z" fill="#cbd5e1" />
      </svg>
    ),
  },
  {
    id: 'cam_high_angle',
    category: 'camera',
    name: '高机位俯拍',
    enName: 'High Angle',
    badge: '宏观俯瞰',
    description: '摄影机由上往下俯视，展现空间站位与渺小感',
    instruction: '将镜头机位调整为高机位俯拍视角（High Angle），由上往下俯视，展现宏观空间格局与环境站位',
    renderThumbnail: () => (
      <svg viewBox="0 0 80 50" className="w-full h-full" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect width="80" height="50" rx="6" fill="#0f172a" />
        {/* 高机位摄影机 */}
        <g transform="translate(14, 8)">
          <rect x="0" y="0" width="14" height="9" rx="1.5" fill="#38bdf8" />
          <path d="M14 3L20 6V14L14 10V3Z" fill="#0284c7" />
          <line x1="7" y1="0" x2="7" y2="-4" stroke="#94a3b8" strokeWidth="1.5" />
        </g>
        {/* 视锥线向下投射 */}
        <path d="M34 16L60 32L68 44Z" fill="#38bdf8" fillOpacity="0.12" />
        <line x1="34" y1="16" x2="60" y2="32" stroke="#38bdf8" strokeWidth="1" strokeDasharray="2 2" />
        <line x1="34" y1="16" x2="68" y2="44" stroke="#38bdf8" strokeWidth="1" strokeDasharray="2 2" />
        {/* 地面俯视人物与阴影 */}
        <ellipse cx="64" cy="42" rx="7" ry="2.5" fill="#1e293b" />
        <circle cx="64" cy="35" r="3.5" fill="#e2e8f0" />
        <path d="M59 39C59 37.5 61 36.5 64 36.5C67 36.5 69 37.5 69 39L67 43H61L59 39Z" fill="#94a3b8" />
      </svg>
    ),
  },
  {
    id: 'cam_eye_level',
    category: 'camera',
    name: '平视标准机位',
    enName: 'Eye Level',
    badge: '自然写实',
    description: '镜头与主体视线平齐，自然客观沉浸的观影视角',
    instruction: '将镜头机位调整为平视标准机位（Eye Level），与角色视线平齐，保持客观写实的电影实感',
    renderThumbnail: () => (
      <svg viewBox="0 0 80 50" className="w-full h-full" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect width="80" height="50" rx="6" fill="#0f172a" />
        {/* 水平视线准星线 */}
        <line x1="8" y1="25" x2="72" y2="25" stroke="#334155" strokeWidth="1" strokeDasharray="3 3" />
        {/* 摄影机水平对齐 */}
        <g transform="translate(12, 19)">
          <rect x="0" y="0" width="14" height="11" rx="1.5" fill="#38bdf8" />
          <path d="M14 2L20 0V11L14 9V2Z" fill="#0284c7" />
        </g>
        {/* 水平视锥 */}
        <path d="M32 25L54 16V34L32 25Z" fill="#38bdf8" fillOpacity="0.12" />
        {/* 目标人物 */}
        <circle cx="62" cy="18" r="4" fill="#e2e8f0" />
        <rect x="57" y="23" width="10" height="18" rx="2" fill="#94a3b8" />
      </svg>
    ),
  },
  {
    id: 'cam_over_shoulder',
    category: 'camera',
    name: '过肩正反打',
    enName: 'Over Shoulder',
    badge: '对话交锋',
    description: '前景借由另一人肩背虚化，后景聚焦主角对话表情',
    instruction: '将镜头调整为过肩正反打视角（Over-the-Shoulder OTS），前景借由近景角色后肩背部虚化遮挡，画面核心焦点对准另一主体的对白神情',
    renderThumbnail: () => (
      <svg viewBox="0 0 80 50" className="w-full h-full" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect width="80" height="50" rx="6" fill="#0f172a" />
        {/* 前景虚化背影 (过肩) */}
        <path d="M4 50C4 36 12 30 22 28C26 27 28 29 32 35L34 50H4Z" fill="#1e293b" />
        <ellipse cx="20" cy="22" rx="7" ry="8" fill="#1e293b" />
        {/* 视线焦点 */}
        <line x1="30" y1="24" x2="52" y2="20" stroke="#38bdf8" strokeWidth="1" strokeDasharray="2 2" />
        {/* 后景清晰主体 */}
        <circle cx="56" cy="18" r="5" fill="#e2e8f0" stroke="#38bdf8" strokeWidth="1" />
        <path d="M49 25C49 23 52 22 56 22C60 22 63 23 63 25L65 46H47L49 25Z" fill="#cbd5e1" />
      </svg>
    ),
  },
  {
    id: 'cam_dutch_angle',
    category: 'camera',
    name: '荷兰角倾斜',
    enName: 'Dutch Angle',
    badge: '危机悬疑',
    description: '水平机位倾斜 15°，打破稳定平衡，营造紧张失衡感',
    instruction: '将镜头机位调整为荷兰角倾斜机位（Dutch Angle），镜头轴线倾斜 15 度，制造失衡感与危机悬疑的戏剧张力',
    renderThumbnail: () => (
      <svg viewBox="0 0 80 50" className="w-full h-full" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect width="80" height="50" rx="6" fill="#0f172a" />
        {/* 倾斜地平线 */}
        <line x1="6" y1="40" x2="74" y2="14" stroke="#f43f5e" strokeWidth="1.5" />
        {/* 倾斜取景框 */}
        <g transform="translate(40, 25) rotate(-16) translate(-22, -14)">
          <rect x="0" y="0" width="44" height="28" rx="2" stroke="#38bdf8" strokeWidth="1.2" strokeDasharray="3 2" fill="none" />
          <circle cx="22" cy="11" r="3" fill="#e2e8f0" />
          <path d="M17 16H27L28 26H16L17 16Z" fill="#94a3b8" />
        </g>
      </svg>
    ),
  },
  {
    id: 'cam_profile_view',
    category: 'camera',
    name: '正侧面剪影',
    enName: 'Profile View',
    badge: '轮廓特写',
    description: '镜头 90° 侧对角色面部与身形，展现锋利侧颜与内心戏',
    instruction: '将镜头机位调整为正侧面角度（Profile View），展现人物侧脸轮廓五官与沉思神态',
    renderThumbnail: () => (
      <svg viewBox="0 0 80 50" className="w-full h-full" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect width="80" height="50" rx="6" fill="#0f172a" />
        {/* 侧面光束 */}
        <path d="M10 10L42 22L10 40Z" fill="#38bdf8" fillOpacity="0.1" />
        {/* 侧脸高光剪影 */}
        <path d="M42 12C41 14 42 16 41 18L44 19L41 21C41 22 43 23 41 25L43 26C42 28 38 29 36 29C35 25 35 20 37 14C39 12 41 11 42 12Z" fill="#e2e8f0" />
        <path d="M36 29L34 45H48L44 31C41 31 38 30 36 29Z" fill="#64748b" />
      </svg>
    ),
  },

  // ==================== 🎨 电影调色与光影 (Color Grading) ====================
  {
    id: 'color_teal_orange',
    category: 'color',
    name: '好莱坞青橙冷暖',
    enName: 'Teal & Orange',
    badge: '商业大片标配',
    description: '冷青色阴影与暖橙色高光撞色，极强的主体分离度',
    instruction: '画面采用好莱坞经典青橙冷暖电影调色（Teal & Orange LUT），暗部与环境沉浸于冷青蓝色调，人物面部高光泛着温润暖橙，形成电影级对比张力',
    renderThumbnail: () => (
      <svg viewBox="0 0 80 50" className="w-full h-full" fill="none" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="tealOrangeGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#083344" />
            <stop offset="50%" stopColor="#0e7490" />
            <stop offset="85%" stopColor="#ea580c" />
            <stop offset="100%" stopColor="#f97316" />
          </linearGradient>
        </defs>
        <rect width="80" height="50" rx="6" fill="url(#tealOrangeGrad)" />
        {/* 对比色光带 */}
        <circle cx="28" cy="25" r="16" fill="#06b6d4" fillOpacity="0.35" filter="blur(4px)" />
        <circle cx="56" cy="25" r="14" fill="#fb923c" fillOpacity="0.45" filter="blur(3px)" />
        {/* 电影胶片暗角 */}
        <rect width="80" height="50" rx="6" stroke="#000" strokeWidth="3" strokeOpacity="0.5" fill="none" />
      </svg>
    ),
  },
  {
    id: 'color_bleach_bypass',
    category: 'color',
    name: '诺兰高反差跳漂白',
    enName: 'Bleach Bypass',
    badge: '硬核冷峻金属',
    description: '银盐保留工艺，低饱和度、高对比度与金属锋利感',
    instruction: '画面采用跳漂白（Bleach Bypass）电影工艺调色，压低色彩饱和度，强化明暗高反差，呈现冷硬金属感与锐利暗部阴影',
    renderThumbnail: () => (
      <svg viewBox="0 0 80 50" className="w-full h-full" fill="none" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="bleachGrad" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#020617" />
            <stop offset="50%" stopColor="#334155" />
            <stop offset="100%" stopColor="#cbd5e1" />
          </linearGradient>
        </defs>
        <rect width="80" height="50" rx="6" fill="url(#bleachGrad)" />
        {/* 冷光切线 */}
        <line x1="10" y1="40" x2="70" y2="10" stroke="#f8fafc" strokeWidth="2" strokeOpacity="0.8" />
        <rect x="22" y="14" width="36" height="22" rx="2" stroke="#94a3b8" strokeWidth="1" strokeDasharray="4 2" fill="none" />
      </svg>
    ),
  },
  {
    id: 'color_tungsten_retro',
    category: 'color',
    name: '王家卫港风复古',
    enName: 'Tungsten 35mm',
    badge: '微醺怀旧黄绿',
    description: '钨丝灯暖黄绿调，胶片颗粒微暗角，浓郁故事感',
    instruction: '画面采用王家卫港风复古胶片调色（Vintage 35mm Tungsten），带有一层温暖微醺的钨丝灯黄绿色调、轻微暗角与细腻胶片颗粒感',
    renderThumbnail: () => (
      <svg viewBox="0 0 80 50" className="w-full h-full" fill="none" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <radialGradient id="tungstenGrad" cx="50%" cy="50%" r="65%">
            <stop offset="0%" stopColor="#fef08a" />
            <stop offset="40%" stopColor="#ca8a04" />
            <stop offset="75%" stopColor="#3f3f46" />
            <stop offset="100%" stopColor="#18181b" />
          </radialGradient>
        </defs>
        <rect width="80" height="50" rx="6" fill="url(#tungstenGrad)" />
        {/* 港风光晕斑 */}
        <circle cx="36" cy="22" r="12" fill="#eab308" fillOpacity="0.4" filter="blur(2px)" />
        <circle cx="52" cy="30" r="8" fill="#84cc16" fillOpacity="0.25" filter="blur(2px)" />
      </svg>
    ),
  },
  {
    id: 'color_golden_hour',
    category: 'color',
    name: '日落黄金时刻',
    enName: 'Golden Hour',
    badge: '逆光温暖史诗',
    description: '日落暖金逆光，丁达尔光晕与柔和边缘轮廓光',
    instruction: '画面采用日落黄金时刻（Golden Hour）电影光影，漫射温暖的金黄色逆光与丁达尔光束，主体边缘泛着柔和发丝轮廓光',
    renderThumbnail: () => (
      <svg viewBox="0 0 80 50" className="w-full h-full" fill="none" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="goldenGrad" x1="0%" y1="100%" x2="0%" y2="0%">
            <stop offset="0%" stopColor="#451a03" />
            <stop offset="50%" stopColor="#b45309" />
            <stop offset="85%" stopColor="#f59e0b" />
            <stop offset="100%" stopColor="#fef3c7" />
          </linearGradient>
        </defs>
        <rect width="80" height="50" rx="6" fill="url(#goldenGrad)" />
        {/* 太阳与金色光束 */}
        <circle cx="40" cy="18" r="8" fill="#fffbeb" />
        <line x1="40" y1="18" x2="16" y2="44" stroke="#fef3c7" strokeWidth="2.5" strokeOpacity="0.4" />
        <line x1="40" y1="18" x2="40" y2="46" stroke="#fef3c7" strokeWidth="2.5" strokeOpacity="0.4" />
        <line x1="40" y1="18" x2="64" y2="44" stroke="#fef3c7" strokeWidth="2.5" strokeOpacity="0.4" />
      </svg>
    ),
  },
  {
    id: 'color_cyber_neon',
    category: 'color',
    name: '赛博朋克霓虹',
    enName: 'Cyberpunk Neon',
    badge: '品红青蓝撞色',
    description: '未来科技感夜市，高亮粉紫霓虹与青蓝夜色反光',
    instruction: '画面采用赛博朋克霓虹夜调（Cyberpunk Neon），深邃黑夜中交织着耀眼的品红粉紫与青荧冷光，地面泛着雨夜霓虹倒影',
    renderThumbnail: () => (
      <svg viewBox="0 0 80 50" className="w-full h-full" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect width="80" height="50" rx="6" fill="#050510" />
        {/* 霓虹发光管 */}
        <path d="M12 18Q26 8 40 18T68 18" stroke="#ec4899" strokeWidth="2.5" filter="drop-shadow(0 0 4px #f43f5e)" />
        <line x1="18" y1="32" x2="62" y2="32" stroke="#06b6d4" strokeWidth="2" filter="drop-shadow(0 0 4px #0891b2)" />
        {/* 水面倒影 */}
        <path d="M20 42L35 42M45 42L60 42" stroke="#ec4899" strokeWidth="1" strokeOpacity="0.6" strokeDasharray="3 2" />
        <path d="M28 45L52 45" stroke="#06b6d4" strokeWidth="1" strokeOpacity="0.6" strokeDasharray="4 2" />
      </svg>
    ),
  },
  {
    id: 'color_film_noir',
    category: 'color',
    name: '经典黑白光影',
    enName: 'Film Noir',
    badge: '纯黑白戏剧光',
    description: '强烈的明暗反差 Chiaroscuro，百叶窗阴影，纯粹质感',
    instruction: '画面采用经典黑色电影黑白影调（Film Noir），强烈的明暗反差与深邃阴影，光线如百叶窗条纹般投射在主体与背景上',
    renderThumbnail: () => (
      <svg viewBox="0 0 80 50" className="w-full h-full" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect width="80" height="50" rx="6" fill="#09090b" />
        {/* 百叶窗光栅斜切线 */}
        <polygon points="18,0 26,0 46,50 38,50" fill="#f4f4f5" fillOpacity="0.85" />
        <polygon points="34,0 42,0 62,50 54,50" fill="#f4f4f5" fillOpacity="0.85" />
        <polygon points="50,0 58,0 78,50 70,50" fill="#f4f4f5" fillOpacity="0.85" />
      </svg>
    ),
  },

  // ==================== 🧍 角色姿态与眼神 (Actor Pose & Stance) ====================
  {
    id: 'pose_standing_tall',
    category: 'pose',
    name: '自然直立并拢',
    enName: 'Standing Tall',
    badge: '治愈交叉腿',
    description: '人体挺拔直立，双脚自然并拢，双臂垂于身侧，消除肢体偶发伪影',
    instruction: '角色站姿调整为双脚自然并拢、直立肃立姿态（严禁双脚交叉腿），双臂自然垂立，身姿挺拔端正',
    renderThumbnail: () => (
      <svg viewBox="0 0 80 50" className="w-full h-full" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect width="80" height="50" rx="6" fill="#0f172a" />
        {/* 垂直对齐参考线 */}
        <line x1="40" y1="4" x2="40" y2="46" stroke="#22c55e" strokeWidth="1" strokeDasharray="2 2" strokeOpacity="0.6" />
        {/* 直立小人 */}
        <circle cx="40" cy="11" r="4" fill="#e2e8f0" />
        <rect x="35" y="16" width="10" height="15" rx="1.5" fill="#38bdf8" />
        {/* 并拢双腿 (直立) */}
        <rect x="36" y="32" width="3.5" height="13" rx="1" fill="#cbd5e1" />
        <rect x="40.5" y="32" width="3.5" height="13" rx="1" fill="#cbd5e1" />
        {/* 双手自然垂于两侧 */}
        <rect x="31.5" y="18" width="2.5" height="12" rx="1" fill="#94a3b8" />
        <rect x="46" y="18" width="2.5" height="12" rx="1" fill="#94a3b8" />
      </svg>
    ),
  },
  {
    id: 'pose_defensive_guard',
    category: 'pose',
    name: '警惕戒备防守',
    enName: 'Defensive Stance',
    badge: '战备对峙',
    description: '重心微沉，侧身屈膝戒备，双手握持或护于胸前',
    instruction: '角色姿态调整为警惕戒备防守步（Defensive Stance），重心微沉，侧身站位，随时准备迎战',
    renderThumbnail: () => (
      <svg viewBox="0 0 80 50" className="w-full h-full" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect width="80" height="50" rx="6" fill="#0f172a" />
        {/* 头部微前倾 */}
        <circle cx="36" cy="13" r="4" fill="#e2e8f0" />
        {/* 侧身胸腔 */}
        <path d="M32 18H44L41 31H30L32 18Z" fill="#38bdf8" />
        {/* 屈膝扎马双腿 */}
        <path d="M31 31L26 44H30L34 33Z" fill="#cbd5e1" />
        <path d="M39 31L46 44H50L43 32Z" fill="#cbd5e1" />
        {/* 前后护持双臂 */}
        <path d="M34 20L44 24" stroke="#f43f5e" strokeWidth="2.5" strokeLinecap="round" />
        <path d="M30 22L24 28" stroke="#94a3b8" strokeWidth="2" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    id: 'pose_leaning_relaxed',
    category: 'pose',
    name: '放松靠立沉思',
    enName: 'Leaning Back',
    badge: '从容闲适',
    description: '背部或单肩微倚靠立，单腿受力，姿态松弛从容',
    instruction: '角色姿态调整为放松靠立沉思（Leaning Stance），身体自然微靠身旁支撑结构，单腿微屈，散发从容气场',
    renderThumbnail: () => (
      <svg viewBox="0 0 80 50" className="w-full h-full" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect width="80" height="50" rx="6" fill="#0f172a" />
        {/* 背后倚靠支撑物 */}
        <rect x="22" y="10" width="4" height="36" fill="#475569" rx="1" />
        {/* 微倾靠立人物 */}
        <circle cx="34" cy="12" r="4" fill="#e2e8f0" />
        <path d="M29 17L37 18L35 32H27L29 17Z" fill="#38bdf8" />
        {/* 交叉受力腿 */}
        <line x1="30" y1="32" x2="31" y2="45" stroke="#cbd5e1" strokeWidth="3" strokeLinecap="round" />
        <line x1="34" y1="32" x2="38" y2="44" stroke="#94a3b8" strokeWidth="2.5" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    id: 'pose_direct_gaze',
    category: 'pose',
    name: '正面直视镜头',
    enName: 'Direct Gaze',
    badge: '打破第四面墙',
    description: '面孔正对镜头，眼神坚定直视观众，强沉浸情绪直击',
    instruction: '角色面部正对摄影机镜头，眼神坚定直视前方（Direct Gaze at Camera），情绪穿透力极强',
    renderThumbnail: () => (
      <svg viewBox="0 0 80 50" className="w-full h-full" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect width="80" height="50" rx="6" fill="#0f172a" />
        {/* 面部特写框架 */}
        <ellipse cx="40" cy="24" rx="15" ry="17" fill="#1e293b" stroke="#38bdf8" strokeWidth="1" />
        {/* 凝视双眼与瞳孔 */}
        <ellipse cx="34" cy="22" rx="3.5" ry="2" fill="#fff" />
        <circle cx="34" cy="22" r="1.5" fill="#0284c7" />
        <ellipse cx="46" cy="22" rx="3.5" ry="2" fill="#fff" />
        <circle cx="46" cy="22" r="1.5" fill="#0284c7" />
        {/* 坚定嘴角 */}
        <line x1="37" y1="32" x2="43" y2="32" stroke="#cbd5e1" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    id: 'pose_looking_away',
    category: 'pose',
    name: '侧视凝望画外',
    enName: 'Looking Away',
    badge: '深沉叙事感',
    description: '头部微偏 30°，眼神凝视画外空间，营造深远悬念',
    instruction: '角色头部与视线微偏向侧前方（Glancing Off-Camera），凝望画外远方，神情深邃若有所思',
    renderThumbnail: () => (
      <svg viewBox="0 0 80 50" className="w-full h-full" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect width="80" height="50" rx="6" fill="#0f172a" />
        {/* 视线射向右侧外部 */}
        <line x1="44" y1="21" x2="72" y2="15" stroke="#f59e0b" strokeWidth="1.5" strokeDasharray="2 2" />
        <polygon points="72,12 76,15 72,18" fill="#f59e0b" />
        {/* 微偏侧脸 */}
        <ellipse cx="38" cy="24" rx="14" ry="17" fill="#1e293b" />
        {/* 侧视眼睛 */}
        <ellipse cx="44" cy="21" rx="3" ry="1.8" fill="#fff" />
        <circle cx="45.5" cy="21" r="1.2" fill="#d97706" />
      </svg>
    ),
  },
  {
    id: 'pose_holding_prop',
    category: 'pose',
    name: '手持/操作道具',
    enName: 'Holding Prop',
    badge: '戏剧动作互动',
    description: '双手握持武器、战术平板或全息控制台，带有明确的动作性',
    instruction: '角色双手握持并操作关键道具或全息界面，动作自然专注，强化戏剧叙事互动',
    renderThumbnail: () => (
      <svg viewBox="0 0 80 50" className="w-full h-full" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect width="80" height="50" rx="6" fill="#0f172a" />
        {/* 角色身形 */}
        <circle cx="35" cy="13" r="4" fill="#e2e8f0" />
        <rect x="30" y="18" width="10" height="16" rx="2" fill="#38bdf8" />
        {/* 双手托举/操作光标道具 */}
        <rect x="46" y="20" width="18" height="11" rx="2" fill="#0369a1" stroke="#38bdf8" strokeWidth="1" />
        <line x1="49" y1="23" x2="61" y2="23" stroke="#7dd3fc" strokeWidth="1" />
        <line x1="49" y1="26" x2="57" y2="26" stroke="#7dd3fc" strokeWidth="1" />
        <path d="M35 22L47 25" stroke="#cbd5e1" strokeWidth="2" strokeLinecap="round" />
        <path d="M38 24L48 28" stroke="#cbd5e1" strokeWidth="2" strokeLinecap="round" />
      </svg>
    ),
  },
];
