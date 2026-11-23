/**
 * client/src/hooks/StudioFocusContext.tsx
 * 全系统通用视口焦点栈微内核 (Universal Studio Focus Microkernel SSOT)
 *
 * 架构保证：
 * 1. 状态与操作双 Context 物理拆分：操作函数引用永久稳定，绝不因焦点变更触发误清理或无效重渲染；
 * 2. 显式优先级排序：高优先级子视图（如单镜头处理页 priority=10）永远覆盖父画布（默认 priority=0），
 *    彻底摆脱 React 子父 useEffect 执行顺序影响；
 * 3. 卸载自动弹栈：任意视图调用 `useReportFocus(focus, priority)`，卸载自动清理，零残留。
 */

import React, { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { AgentFocusContext } from '../lib/DirectorConversation.js';

interface FocusStackEntry {
  sourceId: string;
  priority: number;
  order: number;
  focus: AgentFocusContext;
}

interface StudioFocusActions {
  upsertFocus: (sourceId: string, focus: AgentFocusContext, priority: number) => void;
  removeFocus: (sourceId: string) => void;
}

const StudioFocusActionsContext = createContext<StudioFocusActions | null>(null);
const StudioFocusStateContext = createContext<AgentFocusContext | undefined>(undefined);

function isSameFocus(a: AgentFocusContext, b: AgentFocusContext): boolean {
  if (a.location !== b.location) return false;
  if (Boolean(a.target) !== Boolean(b.target)) return false;
  if (a.target && b.target) {
    if (
      a.target.kind !== b.target.kind ||
      a.target.id !== b.target.id ||
      a.target.label !== b.target.label ||
      a.target.subview !== b.target.subview
    ) {
      return false;
    }
  }
  const aMeta = a.meta || {};
  const bMeta = b.meta || {};
  const aKeys = Object.keys(aMeta);
  const bKeys = Object.keys(bMeta);
  if (aKeys.length !== bKeys.length) return false;
  for (const key of aKeys) {
    if (aMeta[key] !== bMeta[key]) return false;
  }
  return true;
}

export const StudioFocusProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [entries, setEntries] = useState<FocusStackEntry[]>([]);
  const seqRef = useRef(0);

  const upsertFocus = useCallback((sourceId: string, focus: AgentFocusContext, priority: number) => {
    setEntries((prev) => {
      const index = prev.findIndex((entry) => entry.sourceId === sourceId);
      if (index >= 0) {
        const current = prev[index];
        if (current.priority === priority && isSameFocus(current.focus, focus)) {
          return prev;
        }
        const next = [...prev];
        next[index] = {
          sourceId,
          priority,
          order: ++seqRef.current,
          focus,
        };
        return next;
      }
      return [...prev, { sourceId, priority, order: ++seqRef.current, focus }];
    });
  }, []);

  const removeFocus = useCallback((sourceId: string) => {
    setEntries((prev) => {
      if (!prev.some((entry) => entry.sourceId === sourceId)) return prev;
      return prev.filter((entry) => entry.sourceId !== sourceId);
    });
  }, []);

  // 操作上下文永久稳定，不会因为 entries 变化而重新创建
  const actions = useMemo<StudioFocusActions>(
    () => ({ upsertFocus, removeFocus }),
    [upsertFocus, removeFocus]
  );

  // 按 priority 降序、同优先级按最新写入 order 降序选取当前活跃焦点
  const activeFocus = useMemo(() => {
    if (entries.length === 0) return undefined;
    let best = entries[0];
    for (let i = 1; i < entries.length; i++) {
      const candidate = entries[i];
      if (
        candidate.priority > best.priority ||
        (candidate.priority === best.priority && candidate.order > best.order)
      ) {
        best = candidate;
      }
    }
    return best.focus;
  }, [entries]);

  return (
    <StudioFocusActionsContext.Provider value={actions}>
      <StudioFocusStateContext.Provider value={activeFocus}>
        {children}
      </StudioFocusStateContext.Provider>
    </StudioFocusActionsContext.Provider>
  );
};

/**
 * 任意业务画布/子视图调用：上报当前视口焦点，卸载或传 null 时自动弹栈清理。
 * @param focus 当前视口焦点；传 null/undefined 表示清除本视图上报
 * @param priority 层级优先级（主画布默认 0；下钻子页/抽屉/弹窗建议传 10+）
 */
export function useReportFocus(
  focus: AgentFocusContext | null | undefined,
  priority: number = 0
): void {
  const actions = useContext(StudioFocusActionsContext);
  const sourceId = useId();
  const serialized = focus ? JSON.stringify(focus) : '';

  useEffect(() => {
    if (!actions) return;
    if (!serialized) {
      actions.removeFocus(sourceId);
      return;
    }
    actions.upsertFocus(sourceId, JSON.parse(serialized) as AgentFocusContext, priority);
  }, [actions, sourceId, serialized, priority]);

  useEffect(() => {
    if (!actions) return;
    return () => {
      actions.removeFocus(sourceId);
    };
  }, [actions, sourceId]);
}

/**
 * 任意对话组件或 Hook 调用：读取当前最深层的活跃视口焦点。
 */
export function useActiveFocus(): AgentFocusContext | undefined {
  return useContext(StudioFocusStateContext);
}

/**
 * 通用零分支焦点徽章格式化器（仅在聚焦到具体目标对象时返回紧凑标签）。
 */
export function formatFocusLabel(focus?: AgentFocusContext): string {
  if (!focus?.target) return '';
  return focus.target.subview
    ? `${focus.target.label} · ${focus.target.subview}`
    : focus.target.label;
}
