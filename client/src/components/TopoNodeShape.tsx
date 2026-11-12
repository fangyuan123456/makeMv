/**
 * client/src/components/TopoNodeShape.tsx
 * 拓扑图通用几何节点轮廓渲染器与图例微标（Stadium / Rect / Parallelogram / Hexagon / Octagon）
 *
 * 约定：所有几何体均嵌于 [0..w, 0..h] 包围盒内，且上下中点 (w/2, 0) / (w/2, h) 始终落在平边顶点上，
 * 左右中点由 getShapeAnchors 返回精确贴边偏移量，确保连线与边框严丝合缝。
 */

import React from 'react';

export type TopoShapeKind = 'stadium' | 'rect' | 'parallelogram' | 'hexagon' | 'octagon';

export interface TopoShapeAnchors {
  leftX: number;
  rightX: number;
}

export function getShapeAnchors(shape: TopoShapeKind, w: number, _h: number): TopoShapeAnchors {
  if (shape === 'parallelogram') {
    const skew = Math.min(12, Math.floor(w * 0.08));
    return { leftX: skew / 2, rightX: w - skew / 2 };
  }
  return { leftX: 0, rightX: w };
}

function buildPolygonPoints(shape: TopoShapeKind, w: number, h: number, inset: number = 0): string {
  const x0 = inset;
  const y0 = inset;
  const x1 = w - inset;
  const y1 = h - inset;
  const iw = x1 - x0;
  const ih = y1 - y0;

  if (shape === 'parallelogram') {
    const skew = Math.min(12, Math.floor(iw * 0.08));
    return `${(x0 + skew).toFixed(1)},${y0.toFixed(1)} ${x1.toFixed(1)},${y0.toFixed(1)} ${(x1 - skew).toFixed(1)},${y1.toFixed(1)} ${x0.toFixed(1)},${y1.toFixed(1)}`;
  }

  if (shape === 'hexagon') {
    const cut = Math.min(16, Math.floor(iw * 0.1), Math.floor(ih * 0.45));
    const my = (y0 + y1) / 2;
    return `${(x0 + cut).toFixed(1)},${y0.toFixed(1)} ${(x1 - cut).toFixed(1)},${y0.toFixed(1)} ${x1.toFixed(1)},${my.toFixed(1)} ${(x1 - cut).toFixed(1)},${y1.toFixed(1)} ${(x0 + cut).toFixed(1)},${y1.toFixed(1)} ${x0.toFixed(1)},${my.toFixed(1)}`;
  }

  // octagon
  const cut = Math.min(12, Math.floor(ih * 0.28));
  return `${(x0 + cut).toFixed(1)},${y0.toFixed(1)} ${(x1 - cut).toFixed(1)},${y0.toFixed(1)} ${x1.toFixed(1)},${(y0 + cut).toFixed(1)} ${x1.toFixed(1)},${(y1 - cut).toFixed(1)} ${(x1 - cut).toFixed(1)},${y1.toFixed(1)} ${(x0 + cut).toFixed(1)},${y1.toFixed(1)} ${x0.toFixed(1)},${(y1 - cut).toFixed(1)} ${x0.toFixed(1)},${(y0 + cut).toFixed(1)}`;
}

interface TopoNodeShapeProps {
  shape: TopoShapeKind;
  w: number;
  h: number;
  fill: string;
  stroke: string;
  strokeWidth: number;
  strokeDasharray?: string;
  filter?: string;
  doubleBorder?: boolean;
}

export const TopoNodeShape: React.FC<TopoNodeShapeProps> = ({
  shape,
  w,
  h,
  fill,
  stroke,
  strokeWidth,
  strokeDasharray,
  filter,
  doubleBorder = false,
}) => {
  if (shape === 'stadium' || shape === 'rect') {
    const rx = shape === 'stadium' ? h / 2 : 8;
    return (
      <>
        <rect
          x={0}
          y={0}
          width={w}
          height={h}
          rx={rx}
          ry={rx}
          fill={fill}
          stroke={stroke}
          strokeWidth={strokeWidth}
          strokeDasharray={strokeDasharray}
          filter={filter}
          style={{ transition: 'stroke 0.2s, stroke-width 0.2s' }}
        />
        {doubleBorder && (
          <rect
            x={3.5}
            y={3.5}
            width={Math.max(2, w - 7)}
            height={Math.max(2, h - 7)}
            rx={Math.max(4, rx - 3.5)}
            ry={Math.max(4, rx - 3.5)}
            fill="none"
            stroke={stroke}
            strokeWidth={1}
            strokeOpacity={0.45}
            pointerEvents="none"
          />
        )}
      </>
    );
  }

  return (
    <>
      <polygon
        points={buildPolygonPoints(shape, w, h, 0)}
        fill={fill}
        stroke={stroke}
        strokeWidth={strokeWidth}
        strokeDasharray={strokeDasharray}
        strokeLinejoin="round"
        filter={filter}
        style={{ transition: 'stroke 0.2s, stroke-width 0.2s' }}
      />
      {doubleBorder && (
        <polygon
          points={buildPolygonPoints(shape, w, h, 3.5)}
          fill="none"
          stroke={stroke}
          strokeWidth={1}
          strokeOpacity={0.48}
          strokeLinejoin="round"
          pointerEvents="none"
        />
      )}
    </>
  );
};

interface TopoLegendIconProps {
  shape: TopoShapeKind;
  stroke: string;
  fill?: string;
  doubleBorder?: boolean;
}

export const TopoLegendIcon: React.FC<TopoLegendIconProps> = ({
  shape,
  stroke,
  fill = 'rgba(255,255,255,0.06)',
  doubleBorder = false,
}) => (
  <svg width={20} height={14} viewBox="-1 -1 22 16" aria-hidden="true" style={{ flexShrink: 0 }}>
    <TopoNodeShape
      shape={shape}
      w={20}
      h={14}
      fill={fill}
      stroke={stroke}
      strokeWidth={1.6}
      doubleBorder={doubleBorder}
    />
  </svg>
);
