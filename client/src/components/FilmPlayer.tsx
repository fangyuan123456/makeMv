/**
 * client/src/components/FilmPlayer.tsx
 * 影游视听分镜切片播放器与视听总监工位
 */

import React, { useState } from 'react';
import type { FilmSliceArtifact } from '../types/index.js';

interface FilmPlayerProps {
  slices?: FilmSliceArtifact[];
}

export const FilmPlayer: React.FC<FilmPlayerProps> = ({ slices = [] }) => {
  const [selectedIndex, setSelectedIndex] = useState(0);

  if (!slices || slices.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--text-muted)' }}>
        <div style={{ fontSize: '48px', marginBottom: '16px' }}>🎬</div>
        <h3 style={{ color: 'var(--text-main)', marginBottom: '8px' }}>暂未编译影游视听切片</h3>
        <p>在文游分支试玩验证闭环后，向 AI 总导演下发“编译影游视听切片”指令。</p>
      </div>
    );
  }

  const currentSlice = slices[selectedIndex] || slices[0];

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: '20px', height: '100%' }}>
      {/* 左侧主播放器 */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <div
          style={{
            width: '100%',
            height: '420px',
            background: '#090d16',
            borderRadius: '9px',
            border: '1px solid var(--border-subtle)',
            overflow: 'hidden',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            position: 'relative',
            boxShadow: 'var(--shadow-sm)',
          }}
        >
          {currentSlice.videoUrl ? (
            <video
              key={currentSlice.videoUrl}
              src={currentSlice.videoUrl}
              controls
              autoPlay
              style={{ width: '100%', height: '100%', objectFit: 'contain' }}
            />
          ) : currentSlice.keyframeImageUrl ? (
            <img
              src={currentSlice.keyframeImageUrl}
              alt={currentSlice.title}
              style={{ width: '100%', height: '100%', objectFit: 'contain' }}
            />
          ) : (
            <div style={{ textAlign: 'center', color: '#94a3b8' }}>
              <div style={{ fontSize: '42px', marginBottom: '10px' }}>🎞️</div>
              <div>【视听切片：{currentSlice.title}】</div>
              <div style={{ fontSize: '12px', marginTop: '6px' }}>
                物理算力分镜渲染中 (ComfyUI / DashScope / FFmpeg)
              </div>
            </div>
          )}
        </div>

        {/* 当前切片视听指标 */}
        <div className="panel-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
            <h3 style={{ color: 'var(--accent-blue)', fontSize: '16px', fontWeight: 700 }}>
              {currentSlice.title}
            </h3>
            <span style={{ fontSize: '11px', fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>
              Scene: {currentSlice.sceneId} | {currentSlice.durationSeconds ? `${currentSlice.durationSeconds}s` : '3s'}
            </span>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '10px', fontSize: '12.5px' }}>
            <div style={{ background: '#f8fafc', border: '1px solid var(--border-subtle)', padding: '10px 12px', borderRadius: '6px' }}>
              <strong style={{ color: 'var(--accent-amber)' }}>🎥 运镜机位：</strong>
              <div style={{ marginTop: '4px', color: 'var(--text-secondary)' }}>{currentSlice.cameraMovement || '特写缓慢推进，营造压迫张力'}</div>
            </div>

            <div style={{ background: '#f8fafc', border: '1px solid var(--border-subtle)', padding: '10px 12px', borderRadius: '6px' }}>
              <strong style={{ color: 'var(--accent-blue)' }}>💡 光影色温：</strong>
              <div style={{ marginTop: '4px', color: 'var(--text-secondary)' }}>{currentSlice.lighting || '低饱和冷调，局部轮廓光'}</div>
            </div>

            {currentSlice.soundEffects && currentSlice.soundEffects.length > 0 && (
              <div style={{ background: '#f8fafc', border: '1px solid var(--border-subtle)', padding: '10px 12px', borderRadius: '6px', gridColumn: '1 / -1' }}>
                <strong style={{ color: 'var(--accent-violet)' }}>🔊 音画设计与音效：</strong>
                <div style={{ marginTop: '4px', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  {currentSlice.soundEffects.map((snd, i) => (
                    <span key={i} style={{ background: '#ffffff', border: '1px solid var(--border-subtle)', padding: '2px 8px', borderRadius: '4px', fontSize: '11px', color: 'var(--text-secondary)' }}>
                      🎵 {snd}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 右侧分镜切片列表 */}
      <div className="panel-card" style={{ height: '100%', overflowY: 'auto' }}>
        <div className="panel-card-title">
          <span>🎬 视听分镜切片列表 ({slices.length})</span>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {slices.map((slice, idx) => {
            const isSelected = idx === selectedIndex;
            return (
              <div
                key={slice.sceneId || idx}
                onClick={() => setSelectedIndex(idx)}
                style={{
                  background: isSelected ? '#eff6ff' : '#ffffff',
                  border: isSelected ? '1px solid var(--accent-blue)' : '1px solid var(--border-subtle)',
                  borderRadius: '7px',
                  padding: '12px',
                  cursor: 'pointer',
                  transition: 'all 0.15s',
                  boxShadow: isSelected ? 'var(--shadow-xs)' : 'none',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                  <span style={{ fontWeight: 600, color: isSelected ? 'var(--accent-blue)' : 'var(--text-main)', fontSize: '13px' }}>
                    {slice.title}
                  </span>
                  <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                    #{idx + 1}
                  </span>
                </div>
                <div style={{ fontSize: '11.5px', color: 'var(--text-muted)' }}>
                  {slice.cameraMovement || '分镜切片渲染就绪'}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
