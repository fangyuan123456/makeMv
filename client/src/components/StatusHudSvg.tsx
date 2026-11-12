/**
 * client/src/components/StatusHudSvg.tsx
 * 纯原生自主绘制 SVG 交互 HUD (Pure SVG Architecture)
 * 动态展示全量数值槽、关键旗标与道具徽章，零第三方重型依赖
 */

import React from 'react';
import type { PlayerGameState } from '../types/index.js';

interface StatusHudSvgProps {
  state: PlayerGameState;
}

export const StatusHudSvg: React.FC<StatusHudSvgProps> = ({ state }) => {
  const variables = state?.variables || {};
  const flags = state?.flags || {};
  const inventory = state?.inventory || [];

  const varEntries = Object.entries(variables);
  const flagEntries = Object.entries(flags);

  // 动态高度与排版计算
  const itemWidth = 180;
  const itemHeight = 36;
  const paddingX = 14;
  const paddingY = 12;

  const totalCols = Math.max(varEntries.length, 1);
  const svgWidth = Math.max(totalCols * (itemWidth + 12) + paddingX * 2, 600);
  const svgHeight = 64;

  return (
    <div style={{ width: '100%', overflowX: 'auto', background: 'rgba(10, 13, 20, 0.75)', borderRadius: '8px', border: '1px solid var(--border-subtle)', padding: '6px' }}>
      <svg
        viewBox={`0 0 ${svgWidth} ${svgHeight}`}
        style={{ width: '100%', height: 'auto', display: 'block', minHeight: '54px' }}
      >
        <defs>
          {/* 青色渐变 */}
          <linearGradient id="cyanGrad" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#06b6d4" />
            <stop offset="100%" stopColor="#3b82f6" />
          </linearGradient>

          {/* 红色警报渐变 */}
          <linearGradient id="dangerGrad" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#f59e0b" />
            <stop offset="100%" stopColor="#ef4444" />
          </linearGradient>

          {/* 紫色神经负荷渐变 */}
          <linearGradient id="purpleGrad" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#8b5cf6" />
            <stop offset="100%" stopColor="#ec4899" />
          </linearGradient>

          {/* 翡翠绿渐变 */}
          <linearGradient id="emeraldGrad" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#10b981" />
            <stop offset="100%" stopColor="#059669" />
          </linearGradient>

          {/* 阴影滤镜 */}
          <filter id="hudGlow" x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="0" dy="1" stdDeviation="2" floodColor="#00d2ff" floodOpacity="0.3" />
          </filter>
        </defs>

        {/* 渲染数值槽 */}
        {varEntries.map(([name, val], idx) => {
          const numVal = typeof val === 'number' ? val : 0;
          const percent = Math.min(Math.max(numVal, 0), 100);
          const x = paddingX + idx * (itemWidth + 14);
          const y = paddingY;

          // 依据指标选择渐变色彩
          const isDanger = name.toLowerCase().includes('suspic') || name.toLowerCase().includes('overload') || name.toLowerCase().includes('fear');
          const isTech = name.toLowerCase().includes('neural') || name.toLowerCase().includes('memory');
          const barGrad = isDanger ? (numVal > 50 ? 'url(#dangerGrad)' : 'url(#purpleGrad)') : (isTech ? 'url(#purpleGrad)' : 'url(#cyanGrad)');

          return (
            <g key={name} transform={`translate(${x}, ${y})`}>
              {/* 背景板 */}
              <rect
                width={itemWidth}
                height={itemHeight}
                rx="6"
                fill="rgba(18, 23, 34, 0.85)"
                stroke="rgba(255, 255, 255, 0.08)"
                strokeWidth="1"
              />

              {/* 变量名 */}
              <text
                x="8"
                y="16"
                fill="#94a3b8"
                fontSize="11"
                fontWeight="600"
                fontFamily="sans-serif"
              >
                {name}
              </text>

              {/* 变量数值 */}
              <text
                x={itemWidth - 8}
                y="16"
                fill="#ffffff"
                fontSize="12"
                fontWeight="700"
                fontFamily="monospace"
                textAnchor="end"
              >
                {numVal}
              </text>

              {/* 槽底 */}
              <rect
                x="8"
                y="22"
                width={itemWidth - 16}
                height="6"
                rx="3"
                fill="rgba(255, 255, 255, 0.06)"
              />

              {/* 动态进度条 */}
              <rect
                x="8"
                y="22"
                width={Math.max(((itemWidth - 16) * percent) / 100, 2)}
                height="6"
                rx="3"
                fill={barGrad}
              />
            </g>
          );
        })}

        {varEntries.length === 0 && (
          <text x="20" y="36" fill="#64748b" fontSize="12" fontFamily="sans-serif">
            当前故事暂无全局博弈变量
          </text>
        )}
      </svg>

      {/* 旗标与物品微观徽章栏 */}
      {(flagEntries.length > 0 || inventory.length > 0) && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', padding: '6px 12px 2px', borderTop: '1px solid rgba(255, 255, 255, 0.04)', alignItems: 'center' }}>
          {inventory.map((item, idx) => (
            <span
              key={`inv-${idx}`}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
                fontSize: '11px',
                padding: '2px 8px',
                borderRadius: '4px',
                background: 'rgba(245, 158, 11, 0.15)',
                border: '1px solid rgba(245, 158, 11, 0.4)',
                color: '#fbbf24',
                fontFamily: 'var(--font-mono)',
              }}
            >
              🗝️ {item}
            </span>
          ))}

          {flagEntries.map(([flag, val]) => (
            <span
              key={`flag-${flag}`}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
                fontSize: '11px',
                padding: '2px 8px',
                borderRadius: '4px',
                background: val ? 'rgba(16, 185, 129, 0.15)' : 'rgba(100, 116, 139, 0.15)',
                border: val ? '1px solid rgba(16, 185, 129, 0.4)' : '1px solid rgba(100, 116, 139, 0.3)',
                color: val ? '#34d399' : '#94a3b8',
                fontFamily: 'var(--font-mono)',
              }}
            >
              <span style={{ fontSize: '9px' }}>{val ? '●' : '○'}</span> {flag}
            </span>
          ))}
        </div>
      )}
    </div>
  );
};
