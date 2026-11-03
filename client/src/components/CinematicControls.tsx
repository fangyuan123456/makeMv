import React, { useState, useEffect } from 'react';

export interface CinematicParams {
  cameraTrajectory: string;
  motionIntensity: 'low' | 'normal' | 'high';
  userFeedback: string;
}

interface CinematicControlsProps {
  initialTrajectory?: string;
  initialIntensity?: 'low' | 'normal' | 'high';
  initialFeedback?: string;
  onChange: (params: CinematicParams) => void;
}

const TRAJECTORY_OPTIONS = [
  { id: 'dolly_in', name: '平稳向前推近 (Dolly In)', desc: '景别逐步收紧，强化戏剧张力' },
  { id: 'dolly_out', name: '平稳向后拉远 (Dolly Out)', desc: '拉开空间距离，展现环境全貌' },
  { id: 'arc_orbit', name: '弧形环绕 (Arc Shot)', desc: '半圆弧平滑环绕，增强视差立体感' },
  { id: 'handheld', name: '手持跟拍 (Handheld)', desc: '有机微幅呼吸晃动，真实临场感' },
  { id: 'crane', name: '摇臂俯冲 (Crane Shot)', desc: '高位平滑下潜，气势恢宏' },
  { id: 'static', name: '固定镜头微动 (Locked-off)', desc: '视角绝对锁定，仅保留生理微动' },
];

export const CinematicControls: React.FC<CinematicControlsProps> = ({
  initialTrajectory = '平稳向前推近 (Dolly In)',
  initialIntensity = 'normal',
  initialFeedback = '',
  onChange,
}) => {
  const [trajectory, setTrajectory] = useState<string>(initialTrajectory);
  const [intensity, setIntensity] = useState<'low' | 'normal' | 'high'>(initialIntensity);
  const [feedback, setFeedback] = useState<string>(initialFeedback);

  useEffect(() => {
    onChange({ cameraTrajectory: trajectory, motionIntensity: intensity, userFeedback: feedback });
  }, [trajectory, intensity, feedback]);

  // 计算实时预览提示词
  const previewPrompt = `【主体动作】：自然时序动作与神态转换${
    intensity === 'high' ? '，张力爆发' : intensity === 'low' ? '，微幅克制' : ''
  }，【运镜轨迹】：${trajectory}${feedback.trim() ? `，【靶向指令】：${feedback.trim()}` : ''}`;

  return (
    <div style={{ marginTop: 12, padding: 12, background: '#1e293b', borderRadius: 8, border: '1px solid #334155' }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: '#38bdf8', marginBottom: 8 }}>
        🎥 镜头物理运镜与动量微调 (OpenMontage 纯动量控制台)
      </div>

      {/* 运镜轨迹选择 */}
      <div style={{ marginBottom: 10 }}>
        <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 4 }}>运镜物理轨迹:</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 6 }}>
          {TRAJECTORY_OPTIONS.map((opt) => {
            const isSelected = trajectory === opt.name;
            return (
              <button
                key={opt.id}
                type="button"
                onClick={() => setTrajectory(opt.name)}
                style={{
                  padding: '6px 8px',
                  borderRadius: 6,
                  border: isSelected ? '1px solid #38bdf8' : '1px solid #475569',
                  background: isSelected ? '#0369a1' : '#0f172a',
                  color: isSelected ? '#ffffff' : '#cbd5e1',
                  fontSize: 11,
                  textAlign: 'left',
                  cursor: 'pointer',
                }}
              >
                <div>{opt.name}</div>
              </button>
            );
          })}
        </div>
      </div>

      {/* 动量张力强度 */}
      <div style={{ marginBottom: 10 }}>
        <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 4 }}>动量张力强度:</div>
        <div style={{ display: 'flex', gap: 6 }}>
          {(['low', 'normal', 'high'] as const).map((lvl) => {
            const labelMap = { low: '微动 (Low)', normal: '自然动感 (Normal)', high: '强烈动态 (High)' };
            const isSelected = intensity === lvl;
            return (
              <button
                key={lvl}
                type="button"
                onClick={() => setIntensity(lvl)}
                style={{
                  flex: 1,
                  padding: '4px 8px',
                  borderRadius: 6,
                  border: isSelected ? '1px solid #38bdf8' : '1px solid #475569',
                  background: isSelected ? '#0369a1' : '#0f172a',
                  color: isSelected ? '#ffffff' : '#cbd5e1',
                  fontSize: 11,
                  cursor: 'pointer',
                }}
              >
                {labelMap[lvl]}
              </button>
            );
          })}
        </div>
      </div>

      {/* 导演附加靶向微调意见 */}
      <div style={{ marginBottom: 10 }}>
        <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 4 }}>微调动作指令 (可选):</div>
        <input
          type="text"
          value={feedback}
          onChange={(e) => setFeedback(e.target.value)}
          placeholder="例如：“眼神要更坚定冷冽”、“雨水从额头滑落”..."
          style={{
            width: '100%',
            boxSizing: 'border-box',
            padding: '6px 10px',
            borderRadius: 6,
            border: '1px solid #475569',
            background: '#0f172a',
            color: '#f8fafc',
            fontSize: 12,
          }}
        />
      </div>

      {/* 实时 Prompt 动态反显 */}
      <div style={{ padding: '6px 10px', background: '#0f172a', borderRadius: 6, border: '1px dashed #475569' }}>
        <span style={{ fontSize: 10, color: '#38bdf8', fontWeight: 600 }}>[实时 Prompt 反显] </span>
        <span style={{ fontSize: 11, color: '#94a3b8' }}>{previewPrompt}</span>
      </div>
    </div>
  );
};
