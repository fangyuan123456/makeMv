/**
 * client/src/components/studio/canvas/presets/videoPresets.tsx
 * 影视工业级视频运镜与动力学预设中枢 (Video Motion Presets SSOT)
 *
 * 核心三维度：
 * 1. 🎥 运镜方式 (Camera Movement: 推拉摇移、环绕、手持、摇臂、穿梭、固定)
 * 2. ⚡ 动态幅度 (Motion Amplitude: 2/10微幅、5/10电影级平缓、8/10强动态)
 * 3. 🎯 焦点跟踪 (Focus & Tracking: 锁定主体、环视环境、细节聚焦)
 *
 * 每个预设均自带极具工业辨识度的矢量 SVG 视觉示意图与专业英文生成参数。
 */

import React from 'react';

export type VideoPresetCategory = 'motion' | 'dynamic' | 'focus';

export interface VideoPreset {
  id: string;
  category: VideoPresetCategory;
  name: string;
  enName: string;
  badge: string;
  description: string;
  instruction: string;
  renderThumbnail: () => React.ReactNode;
}

export const VIDEO_PRESETS: VideoPreset[] = [
  // ==================== 🎥 运镜方式 (Camera Movement) ====================
  {
    id: 'motion_dolly_in',
    category: 'motion',
    name: '缓缓推近',
    enName: 'Dolly In',
    badge: '聚焦张力',
    description: '机位平稳向主体面部/核心推近，增强心理紧张感与戏剧张力',
    instruction: 'cinematic slow dolly in towards subject, smooth camera push-in, intense dramatic focus',
    renderThumbnail: () => (
      <svg viewBox="0 0 80 50" className="w-full h-full" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect width="80" height="50" rx="6" fill="#0f172a" />
        {/* 纵深透视线 */}
        <line x1="10" y1="10" x2="35" y2="25" stroke="#334155" strokeWidth="1" strokeDasharray="2 2" />
        <line x1="10" y1="40" x2="35" y2="25" stroke="#334155" strokeWidth="1" strokeDasharray="2 2" />
        <line x1="70" y1="10" x2="45" y2="25" stroke="#334155" strokeWidth="1" strokeDasharray="2 2" />
        <line x1="70" y1="40" x2="45" y2="25" stroke="#334155" strokeWidth="1" strokeDasharray="2 2" />
        {/* 中心主体 */}
        <circle cx="40" cy="23" r="5" fill="#f8fafc" />
        <path d="M33 36C33 30 47 30 47 36" stroke="#f8fafc" strokeWidth="2" strokeLinecap="round" />
        {/* 推镜头推进箭头 */}
        <path d="M40 45L40 37M40 37L37 40M40 37L43 40" stroke="#38bdf8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M22 25L30 25M30 25L27 22M30 25L27 28" stroke="#38bdf8" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M58 25L50 25M50 25L53 22M50 25L53 28" stroke="#38bdf8" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    id: 'motion_dolly_out',
    category: 'motion',
    name: '渐行拉远',
    enName: 'Dolly Out',
    badge: '宏大揭示',
    description: '机位从主体平滑后撤拉远，逐步揭示宏大空间与外部环境',
    instruction: 'cinematic smooth dolly out away from subject, revealing expansive grand environment, wide perspective',
    renderThumbnail: () => (
      <svg viewBox="0 0 80 50" className="w-full h-full" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect width="80" height="50" rx="6" fill="#0f172a" />
        {/* 中心主体 */}
        <circle cx="40" cy="22" r="4" fill="#94a3b8" />
        <path d="M35 32C35 27 45 27 45 32" stroke="#94a3b8" strokeWidth="1.5" strokeLinecap="round" />
        {/* 拉远向外扩张箭头 */}
        <path d="M40 35L40 45M40 45L37 42M40 45L43 42" stroke="#38bdf8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M30 23L20 23M20 23L23 20M20 23L23 26" stroke="#38bdf8" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M50 23L60 23M60 23L57 20M60 23L57 26" stroke="#38bdf8" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    id: 'motion_orbit_arc',
    category: 'motion',
    name: '环绕巡视',
    enName: 'Orbit Arc',
    badge: '史诗高光',
    description: '摄影机围绕主体进行 180° 或 360° 旋转拍摄，营造主角光环与磅礴气势',
    instruction: 'cinematic 360-degree orbit camera movement around subject, smooth rotating arc shot, epic hero framing',
    renderThumbnail: () => (
      <svg viewBox="0 0 80 50" className="w-full h-full" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect width="80" height="50" rx="6" fill="#0f172a" />
        {/* 环绕椭圆轨道 */}
        <ellipse cx="40" cy="28" rx="28" ry="12" stroke="#334155" strokeWidth="1.5" strokeDasharray="3 3" />
        {/* 中心主体 */}
        <circle cx="40" cy="24" r="5" fill="#f8fafc" />
        <path d="M34 36C34 31 46 31 46 36" stroke="#f8fafc" strokeWidth="2" strokeLinecap="round" />
        {/* 沿轨道环绕箭头 */}
        <path d="M16 28A28 12 0 0 0 64 28" stroke="#38bdf8" strokeWidth="2" strokeLinecap="round" />
        <path d="M64 28L60 24M64 28L61 32" stroke="#38bdf8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    id: 'motion_truck_track',
    category: 'motion',
    name: '水平跟拍',
    enName: 'Truck Follow',
    badge: '平稳伴行',
    description: '摄影机平行横向滑轨跟拍，伴随主体行动或奔跑，纪实而动感',
    instruction: 'cinematic lateral truck shot, camera tracks smoothly alongside moving subject, steady sliding movement',
    renderThumbnail: () => (
      <svg viewBox="0 0 80 50" className="w-full h-full" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect width="80" height="50" rx="6" fill="#0f172a" />
        {/* 地面滑轨线 */}
        <line x1="8" y1="40" x2="72" y2="40" stroke="#334155" strokeWidth="2" />
        <line x1="8" y1="43" x2="72" y2="43" stroke="#1e293b" strokeWidth="1" />
        {/* 主体奔跑/前行 */}
        <circle cx="44" cy="20" r="4.5" fill="#f8fafc" />
        <path d="M38 34L42 27L48 29L52 35" stroke="#f8fafc" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        {/* 横向跟拍箭头 */}
        <path d="M18 16L32 16M32 16L28 12M32 16L28 20" stroke="#38bdf8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M54 16L68 16M68 16L64 12M68 16L64 20" stroke="#38bdf8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    id: 'motion_crane_rise',
    category: 'motion',
    name: '摇臂升降',
    enName: 'Crane Jib',
    badge: '纵深鸟瞰',
    description: '摄影机垂直抬升至高空鸟瞰，或自高空俯冲入场，宏大气魄',
    instruction: 'cinematic crane jib shot, vertical camera lift rising into a grand high-angle bird eye view',
    renderThumbnail: () => (
      <svg viewBox="0 0 80 50" className="w-full h-full" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect width="80" height="50" rx="6" fill="#0f172a" />
        {/* 摇臂机械支架 */}
        <path d="M12 44L30 18L55 14" stroke="#475569" strokeWidth="2" strokeLinecap="round" />
        <circle cx="30" cy="18" r="2.5" fill="#38bdf8" />
        {/* 升空摄影机 */}
        <rect x="52" y="10" width="10" height="7" rx="1" fill="#38bdf8" />
        {/* 向上抬升弧度箭头 */}
        <path d="M22 36C26 28 36 22 46 20" stroke="#38bdf8" strokeWidth="1.5" strokeDasharray="2 2" />
        <path d="M46 20L41 18M46 20L43 23" stroke="#38bdf8" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    id: 'motion_handheld',
    category: 'motion',
    name: '手持呼吸',
    enName: 'Handheld',
    badge: '临场纪实',
    description: '模拟真实摄影师肩扛手持，轻微呼吸感起伏与纪实晃动，紧迫沉浸',
    instruction: 'realistic handheld camera breathing motion, natural organic slight camera shake, raw documentary intimacy',
    renderThumbnail: () => (
      <svg viewBox="0 0 80 50" className="w-full h-full" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect width="80" height="50" rx="6" fill="#0f172a" />
        {/* 手持呼吸折线波浪 */}
        <path d="M10 25Q18 20 25 26T40 24T55 27T70 23" stroke="#38bdf8" strokeWidth="1.8" strokeLinecap="round" fill="none" />
        {/* 取景器四角标记 */}
        <path d="M22 14H18V18" stroke="#94a3b8" strokeWidth="1.5" strokeLinecap="round" />
        <path d="M58 14H62V18" stroke="#94a3b8" strokeWidth="1.5" strokeLinecap="round" />
        <path d="M22 36H18V32" stroke="#94a3b8" strokeWidth="1.5" strokeLinecap="round" />
        <path d="M58 36H62V32" stroke="#94a3b8" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    id: 'motion_fpv',
    category: 'motion',
    name: '穿梭穿越',
    enName: 'FPV Flight',
    badge: '极速穿行',
    description: '模拟第一人称穿越机极速低空俯冲，穿过障碍与人物之间，动感非凡',
    instruction: 'dynamic FPV drone fly-through, fast-paced dive and swoop across cinematic environment, thrilling motion',
    renderThumbnail: () => (
      <svg viewBox="0 0 80 50" className="w-full h-full" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect width="80" height="50" rx="6" fill="#0f172a" />
        {/* 穿梭光轨 */}
        <path d="M8 40C24 38 32 16 72 12" stroke="#38bdf8" strokeWidth="2.5" strokeLinecap="round" />
        <path d="M12 44C26 42 34 20 74 16" stroke="#0284c7" strokeWidth="1.5" strokeLinecap="round" opacity="0.6" />
        <polygon points="72,12 64,10 66,16" fill="#38bdf8" />
      </svg>
    ),
  },
  {
    id: 'motion_locked_off',
    category: 'motion',
    name: '定机微动',
    enName: 'Locked-off',
    badge: '意境静思',
    description: '机位严格固定不动，仅主体微表情与背景微风、光影自然流转',
    instruction: 'locked-off static tripod camera, subtle natural motion of subject breathing and ambient lighting, stable frame',
    renderThumbnail: () => (
      <svg viewBox="0 0 80 50" className="w-full h-full" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect width="80" height="50" rx="6" fill="#0f172a" />
        {/* 三脚架固定机位 */}
        <line x1="40" y1="26" x2="28" y2="44" stroke="#94a3b8" strokeWidth="1.8" />
        <line x1="40" y1="26" x2="52" y2="44" stroke="#94a3b8" strokeWidth="1.8" />
        <line x1="40" y1="26" x2="40" y2="44" stroke="#64748b" strokeWidth="1.5" />
        <rect x="34" y="20" width="12" height="7" rx="1.5" fill="#38bdf8" />
        {/* 稳定十字准星 */}
        <circle cx="40" cy="14" r="3" stroke="#f8fafc" strokeWidth="1" strokeDasharray="1 1" />
      </svg>
    ),
  },

  // ==================== ⚡ 动态幅度 (Motion Amplitude) ====================
  {
    id: 'dynamic_subtle_2',
    category: 'dynamic',
    name: '微幅呼吸 (2/10)',
    enName: 'Subtle 2/10',
    badge: '防融化',
    description: '极少形变，几乎固定，适合文戏对话、肖像特写与宁静氛围',
    instruction: 'subtle 2/10 motion amplitude, very gentle breathing dynamics, zero distortion, highly coherent frame',
    renderThumbnail: () => (
      <svg viewBox="0 0 80 50" className="w-full h-full" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect width="80" height="50" rx="6" fill="#0f172a" />
        <rect x="15" y="23" width="50" height="4" rx="2" fill="#334155" />
        <rect x="15" y="23" width="12" height="4" rx="2" fill="#38bdf8" />
        <text x="40" y="38" fill="#94a3b8" fontSize="9" textAnchor="middle" fontFamily="monospace">
          2 / 10 档位
        </text>
      </svg>
    ),
  },
  {
    id: 'dynamic_smooth_5',
    category: 'dynamic',
    name: '电影级平缓 (5/10)',
    enName: 'Smooth 5/10',
    badge: '默认推荐',
    description: '好莱坞标准滑轨匀速运动，动静相宜，兼顾动感与画面稳定性',
    instruction: 'smooth 5/10 cinematic motion dynamic, steady movement, balanced pacing, Hollywood standard',
    renderThumbnail: () => (
      <svg viewBox="0 0 80 50" className="w-full h-full" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect width="80" height="50" rx="6" fill="#0f172a" />
        <rect x="15" y="23" width="50" height="4" rx="2" fill="#334155" />
        <rect x="15" y="23" width="28" height="4" rx="2" fill="#38bdf8" />
        <text x="40" y="38" fill="#38bdf8" fontSize="9" textAnchor="middle" fontWeight="bold" fontFamily="monospace">
          5 / 10 标准
        </text>
      </svg>
    ),
  },
  {
    id: 'dynamic_burst_8',
    category: 'dynamic',
    name: '强动态爆发 (8/10)',
    enName: 'Dramatic 8/10',
    badge: '动作冲击',
    description: '高动态冲刺、爆发打斗与强戏剧转折，极具冲击力',
    instruction: 'dramatic 8/10 high intensity motion, fast cinematic dynamic action, energetic camera impact',
    renderThumbnail: () => (
      <svg viewBox="0 0 80 50" className="w-full h-full" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect width="80" height="50" rx="6" fill="#0f172a" />
        <rect x="15" y="23" width="50" height="4" rx="2" fill="#334155" />
        <rect x="15" y="23" width="44" height="4" rx="2" fill="#f59e0b" />
        <text x="40" y="38" fill="#f59e0b" fontSize="9" textAnchor="middle" fontWeight="bold" fontFamily="monospace">
          8 / 10 爆发
        </text>
      </svg>
    ),
  },

  // ==================== 🎯 焦点跟踪 (Focus & Tracking) ====================
  {
    id: 'focus_subject',
    category: 'focus',
    name: '锁定主体',
    enName: 'Lock Subject',
    badge: '焦点居中',
    description: '摄影机视线始终牢固锁定在核心人物身上，构图稳健',
    instruction: 'keep main subject tightly locked in visual center, tracking shot following subject movement',
    renderThumbnail: () => (
      <svg viewBox="0 0 80 50" className="w-full h-full" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect width="80" height="50" rx="6" fill="#0f172a" />
        <circle cx="40" cy="22" r="5" fill="#f8fafc" />
        <path d="M34 34C34 29 46 29 46 34" stroke="#f8fafc" strokeWidth="1.8" strokeLinecap="round" />
        {/* 锁定框角标 */}
        <path d="M26 14H22V18" stroke="#38bdf8" strokeWidth="1.5" />
        <path d="M54 14H58V18" stroke="#38bdf8" strokeWidth="1.5" />
        <path d="M26 36H22V32" stroke="#38bdf8" strokeWidth="1.5" />
        <path d="M54 36H58V32" stroke="#38bdf8" strokeWidth="1.5" />
      </svg>
    ),
  },
  {
    id: 'focus_scene',
    category: 'focus',
    name: '环顾环境',
    enName: 'Pan Scene',
    badge: '氛围扫描',
    description: '视线从人物延伸向周围宏大场景与空间异动，强调氛围感',
    instruction: 'camera scans surrounding environment, capturing ambient architecture and background atmosphere',
    renderThumbnail: () => (
      <svg viewBox="0 0 80 50" className="w-full h-full" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect width="80" height="50" rx="6" fill="#0f172a" />
        {/* 远景山脉与建筑轮廓 */}
        <path d="M10 38L24 24L38 34L54 18L70 38" stroke="#475569" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        {/* 水平扫描视线虚线 */}
        <path d="M15 20L65 20" stroke="#38bdf8" strokeWidth="1.5" strokeDasharray="3 3" />
        <polygon points="65,20 59,17 59,23" fill="#38bdf8" />
      </svg>
    ),
  },
  {
    id: 'focus_detail',
    category: 'focus',
    name: '细节聚焦',
    enName: 'Detail Focus',
    badge: '器物特写',
    description: '焦点精准拉近至人物的手部动作、佩剑武器或核心交互道具',
    instruction: 'rack focus to fine detail, sharp close-up on key interaction prop and subtle motion',
    renderThumbnail: () => (
      <svg viewBox="0 0 80 50" className="w-full h-full" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect width="80" height="50" rx="6" fill="#0f172a" />
        {/* 核心道具宝物光环 */}
        <circle cx="40" cy="25" r="7" stroke="#38bdf8" strokeWidth="2" fill="#0284c7" />
        <line x1="40" y1="12" x2="40" y2="16" stroke="#38bdf8" strokeWidth="1.5" strokeLinecap="round" />
        <line x1="40" y1="34" x2="40" y2="38" stroke="#38bdf8" strokeWidth="1.5" strokeLinecap="round" />
        <line x1="27" y1="25" x2="31" y2="25" stroke="#38bdf8" strokeWidth="1.5" strokeLinecap="round" />
        <line x1="49" y1="25" x2="53" y2="25" stroke="#38bdf8" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    ),
  },
];
