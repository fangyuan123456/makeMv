/**
 * client/src/lib/session.ts
 * URL projectId 同步与会话/任务状态跨刷新水合工具
 */

import type { ChatMessage } from '../hooks/useDirectorChat.js';
import type { ActionProposal, ProjectData, StageTaskView } from '../types/index.js';
import { buildGameUrl, type TaskSnapshot } from './api.js';

export interface ActiveWatchTarget {
  runId: string;
  stage: 'plan_gdd' | 'build_text_game';
  messageId: string;
}

export interface RestoredSessionState {
  messages: ChatMessage[];
  activeProposal: ActionProposal | null;
  streamingMessageId: string | null;
  streamingContent: string;
  currentRunId: string | null;
  activeWatch: ActiveWatchTarget | null;
  gameUrl: string | null;
}

export function createDraftProjectId(): string {
  return `proj_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

export function readProjectIdFromUrl(): string | null {
  const id = new URLSearchParams(window.location.search).get('projectId');
  return id && id.trim() ? id.trim() : null;
}

export function syncProjectIdToUrl(projectId: string | null, mode: 'replace' | 'push' = 'replace'): void {
  const url = new URL(window.location.href);
  const current = url.searchParams.get('projectId');
  if (projectId) {
    if (current === projectId) return;
    url.searchParams.set('projectId', projectId);
  } else {
    if (current === null) return;
    url.searchParams.delete('projectId');
  }
  const target = `${url.pathname}${url.search}${url.hash}`;
  if (mode === 'push') {
    window.history.pushState(null, '', target);
  } else {
    window.history.replaceState(null, '', target);
  }
}

function buildRestoredTaskView(
  projectId: string,
  stage: 'plan_gdd' | 'build_text_game',
  runId: string,
  task: TaskSnapshot | undefined,
  nextProposalResolved: boolean | undefined,
  project: ProjectData
): StageTaskView {
  const stageResult = task?.result as any;
  const gddData =
    (stageResult?.pendingApproval?.type === 'gdd_approval' ? stageResult.pendingApproval.data : null) ||
    project.artifacts?.gdd;
  const textGameData =
    (stageResult?.pendingApproval?.type === 'playtest_approval' ? stageResult.pendingApproval.data : null) ||
    project.artifacts?.text_game;

  if (stage === 'plan_gdd') {
    const stage2Progressed =
      Boolean(nextProposalResolved) ||
      stageResult?.currentStage === 'build_text_game' ||
      stageResult?.currentStage === 'completed' ||
      task?.status === 'succeeded' ||
      Boolean(stageResult?.pendingApproval?.type === 'playtest_approval');
    const stage1Done =
      stage2Progressed ||
      ((task?.status === 'suspended' || task?.status === 'proposed') &&
        stageResult?.pendingApproval?.type === 'gdd_approval') ||
      (Boolean(project.artifacts?.gdd) &&
        task?.status !== 'failed' &&
        task?.status !== 'cancelled' &&
        task?.status !== 'running' &&
        task?.status !== 'queued');

    const cancelled = task?.status === 'cancelled' && !stage1Done;
    const failed = task?.status === 'failed' && !stage1Done;
    const status: StageTaskView['status'] = cancelled
      ? 'cancelled'
      : failed
        ? 'failed'
        : stage1Done
          ? 'succeeded'
          : task?.status === 'queued'
            ? 'queued'
            : 'running';

    const title = gddData?.title || project.meta.title || '互动影游';
    const beats = Array.isArray(gddData?.beatOutline) ? gddData.beatOutline.length : 0;
    const gate = stageResult?.pendingApproval?.validation;
    const gateNote =
      gate && gate.valid === false
        ? ` ⚠️ 拓扑门禁未通过（${gate.errors?.length ?? 0} 项），系统未阻断，请留意策划案质量。`
        : '';

    return {
      runId,
      stage,
      title: '推演游戏策划案 (GDD)',
      status,
      percent:
        status === 'running' || status === 'queued'
          ? Math.min(100, Math.max(0, task?.progress?.percent ?? 0))
          : 100,
      note: cancelled
        ? task?.error || '任务已被创作者取消'
        : failed
          ? task?.error || '任务执行失败'
          : task?.progress?.note || (stage1Done ? '策划案已推演完成' : '正在推演中…'),
      startedAt: task?.createdAt || new Date().toISOString(),
      ...(stage1Done
        ? {
            resultSummary:
              `《${title}》策划案已完成${beats ? `：${beats} 幕主干节拍` : ''}，` +
              `全案 PRD 与互动拓扑已落盘，可在右侧「GDD 策划案」查看。${gateNote}`,
            nextProposal: {
              action: 'build_text_game',
              targetStage: 'build_text_game',
              summary: `确认后先生成角色 / 道具 / 场景母本图，再装配可玩的《${title}》`,
              payload: { runId },
            },
            nextProposalResolved: Boolean(nextProposalResolved || stage2Progressed),
          }
        : {}),
    };
  }

  const pendingType = stageResult?.pendingApproval?.type;
  /** 阶段二中途的母本确认点：角色 / 道具 / 场景母本图出完即挂起，进入装配前需要创作者点一次确认 */
  const isLookdevCheckpoint =
    (task?.status === 'suspended' || task?.status === 'proposed') && pendingType === 'lookdev_approval';

  const stage2Done =
    isLookdevCheckpoint ||
    ((task?.status === 'suspended' || task?.status === 'proposed') &&
      pendingType === 'playtest_approval') ||
    task?.status === 'succeeded' ||
    stageResult?.currentStage === 'compile_film' ||
    stageResult?.currentStage === 'completed' ||
    Boolean(
      project.artifacts?.hasStandaloneGame &&
        task?.status !== 'running' &&
        task?.status !== 'queued' &&
        task?.status !== 'failed' &&
        task?.status !== 'cancelled'
    );

  const cancelled = task?.status === 'cancelled' && !stage2Done;
  const failed = task?.status === 'failed' && !stage2Done;
  const status: StageTaskView['status'] = cancelled
    ? 'cancelled'
    : failed
      ? 'failed'
      : stage2Done
        ? 'succeeded'
        : task?.status === 'queued'
          ? 'queued'
          : 'running';
  const nodes = Array.isArray(textGameData?.nodes) ? textGameData.nodes.length : 0;
  const lookdevEntities = isLookdevCheckpoint ? stageResult?.pendingApproval?.data : null;
  const lookdevChars = Array.isArray(lookdevEntities?.characters) ? lookdevEntities.characters.length : 0;
  const lookdevItems = Array.isArray(lookdevEntities?.items) ? lookdevEntities.items.length : 0;
  const lookdevLocations = Array.isArray(lookdevEntities?.locations)
    ? lookdevEntities.locations.length
    : 0;

  return {
    runId,
    stage,
    title: isLookdevCheckpoint ? '角色 / 道具 / 场景母本图' : '装配互动文游 (index.html)',
    status,
    percent:
      status === 'running' || status === 'queued'
        ? Math.min(100, Math.max(0, task?.progress?.percent ?? 0))
        : 100,
    note: cancelled
      ? task?.error || '任务已被创作者取消'
      : failed
        ? task?.error || '任务执行失败'
        : task?.progress?.note || (stage2Done ? '互动文游已装配就绪' : '正在装配中…'),
    startedAt: task?.createdAt || new Date().toISOString(),
    ...(isLookdevCheckpoint
      ? {
          resultSummary:
            `已生成 ${lookdevChars} 个角色 / ${lookdevItems} 件道具 / ${lookdevLocations} 个场景的母本图，母本清单已落盘；` +
            '确认后按场景装配分幕与可玩切片。',
          nextProposal: {
            action: 'render_images',
            targetStage: 'build_text_game',
            summary: '确认母本图，开始装配互动文游',
            payload: { runId },
          } satisfies ActionProposal,
          nextProposalResolved: Boolean(nextProposalResolved),
        }
      : stage2Done
        ? {
            resultSummary:
              `互动文游已直接产出${nodes ? `：${nodes} 幕可玩切片` : ''}，` +
              '独立入口 game-assembly/index.html 即刻可试玩；玩家在游戏内修改后续接入。',
            gameUrl: buildGameUrl(projectId),
          }
        : {}),
  };
}

/**
 * 基于服务端 `projectData` + `tasks.json` 重建客户端完整聊天面板、当前 runId、活跃轮询与游戏入口
 */
export function buildRestoredSessionState(
  projectId: string,
  project: ProjectData,
  tasks: TaskSnapshot[]
): RestoredSessionState {
  const taskMap = new Map(tasks.map((t) => [t.taskId, t]));
  const hasStage2InChat = (project.chat || []).some((m) => m.taskStage === 'build_text_game');

  let activeWatch: ActiveWatchTarget | null = null;
  let activeProposal: ActionProposal | null = null;
  let streamingMessageId: string | null = null;
  let streamingContent = '';

  const chatList = project.chat || [];
  const lastIdx = chatList.length - 1;
  /** 旧版本把报错直接拼进正文，水合时顺手拆出来 */
  const LEGACY_ERROR_MARK = '[导演总控提示: ';
  const firstIdxByRunStage = new Map<string, number>();
  chatList.forEach((rec, idx) => {
    if (rec.taskRunId) {
      const stage = rec.taskStage || 'plan_gdd';
      const key = `${rec.taskRunId}:${stage}`;
      if (!firstIdxByRunStage.has(key)) {
        firstIdxByRunStage.set(key, idx);
      }
    }
  });

  const messages: ChatMessage[] = chatList.map((rec, idx) => {
    let content = rec.content || '';
    let errorMessage = rec.errorMessage;
    if (!errorMessage && rec.status === 'error') {
      const at = content.lastIndexOf(LEGACY_ERROR_MARK);
      if (at >= 0) {
        errorMessage = content.slice(at + LEGACY_ERROR_MARK.length).replace(/\]\s*$/, '');
        content = content.slice(0, at).trimEnd();
      }
    }

    let taskView: StageTaskView | undefined;
    if (rec.taskRunId) {
      const stage = rec.taskStage || 'plan_gdd';
      const key = `${rec.taskRunId}:${stage}`;
      const isPrimaryOwner = firstIdxByRunStage.get(key) === idx;
      if (isPrimaryOwner) {
        const task = taskMap.get(rec.taskRunId);
        const nextResolved = rec.nextProposalResolved || (stage === 'plan_gdd' && hasStage2InChat);
        taskView = buildRestoredTaskView(projectId, stage, rec.taskRunId, task, nextResolved, project);
        if (taskView.status === 'running' || taskView.status === 'queued') {
          activeWatch = { runId: rec.taskRunId, stage, messageId: rec.id };
        }
      }
    }

    if (rec.proposal && !rec.proposalResolved) {
      activeProposal = rec.proposal;
    }

    if (rec.role === 'assistant' && rec.status === 'streaming') {
      streamingMessageId = rec.id;
      streamingContent = content;
    }

    /** 只有会话末尾那一轮失败才挂重试按钮；后面又有对话了，旧报错不再残留 */
    let retryText = '';
    if (rec.role === 'assistant') {
      for (let i = idx - 1; i >= 0; i--) {
        if (chatList[i].role === 'user') {
          retryText = chatList[i].content || '';
          break;
        }
      }
    }
    const error =
      errorMessage && idx === lastIdx && rec.role === 'assistant'
        ? { message: `[导演总控提示: ${errorMessage}]`, retryText }
        : undefined;

    return {
      id: rec.id,
      role: rec.role,
      content,
      createdAt: rec.createdAt,
      ...(error ? { error } : {}),
      ...(rec.proposal ? { proposal: rec.proposal } : {}),
      ...(rec.proposalResolved !== undefined ? { proposalResolved: rec.proposalResolved } : {}),
      ...(taskView ? { task: taskView } : {}),
    };
  });

  const latestValidTask = [...tasks]
    .reverse()
    .find((t) => t.status !== 'failed' && t.status !== 'cancelled');
  const currentRunId = latestValidTask?.taskId || null;

  const gameReady =
    Boolean(project.artifacts?.hasStandaloneGame) ||
    Boolean(project.artifacts?.text_game) ||
    messages.some((m) => Boolean(m.task?.gameUrl));

  return {
    messages,
    activeProposal,
    streamingMessageId,
    streamingContent,
    currentRunId,
    activeWatch,
    gameUrl: gameReady ? buildGameUrl(projectId) : null,
  };
}
