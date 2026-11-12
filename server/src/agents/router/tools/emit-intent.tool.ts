/**
 * agents/router/tools/emit-intent.tool.ts
 * 中枢路由总控专属意图决策工具 (Router Intent Tool SSOT)
 *
 * 核心设计（高内聚、零语言硬编码、AI 自主语义漏斗 + 客观工程状态门禁）：
 * 1. 意图识别规则 100% 内聚在工具内部：动作语义边界、自顶向下优先级漏斗 (P0 -> P1 -> P2 -> P3)
 *    与上下文思考字段 (`contextAnalysis`) 全部内聚在本工具契约中，外部 `prompt.ts` 仅保留导演人格与客观态势；
 * 2. 零词表硬编码，完全由 AI 理解识别：绝不使用关键词列表或正则匹配自然语言，而是向工具注入
 *    实时工程态势与上下文指引，由大模型结合完整对话历史自主完成 P0->P3 多层语义漏斗推理；
 * 3. 纯客观工程状态门禁 (`evaluateRouterIntentFunnel`)：工具 `execute` 仅依据 ProjectStore/TaskStore 的
 *    客观物理态（是否存在运行中任务、挂起待批阶段、已落盘产物、前序立项提案）执行刚性门禁并回传
 *    `guidance` 给第 1 步对话模型，确保决策动作与自然语言回复同源一致。
 */

import { z } from 'zod';
import { createTool, resolveToolArgs } from '../../../mastra-compat/index.js';
import { ProjectStore } from '../../../project-store/ProjectStore.js';
import type { ProjectChatMessage } from '../../../project-store/types.js';
import { TaskStore } from '../../../workflow-engine/TaskStore.js';
import type { Task } from '../../../workflow-engine/types.js';

export const EMIT_ROUTER_INTENT_TOOL_ID = 'emit_router_intent';

export interface RouterDialogueTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface RouterIntentToolContext {
  projectId?: string;
  latestUserMessage?: string;
  dialogueTurns?: RouterDialogueTurn[];
}

export const RouterIntentSchema = z.object({
  contextAnalysis: z
    .string()
    .optional()
    .describe(
      '【漏斗思考（决策前必先梳理）】结合完整对话历史与实时工程黑板，简述：(1) 创作者本轮是在提出/完善创意、修改或附加条件、要求恢复已停止/中断的某个 taskId、纯粹确认推进；(2) 对话记录或工程任务账本中是否存在待恢复任务或待确认提案'
    ),
  action: z.preprocess(
    (v) => {
      if (typeof v !== 'string') return 'propose_stage';
      const lower = v.toLowerCase().trim();
      if (lower === 'start_pipeline' || lower === 'startpipeline') return 'propose_stage';
      if (lower === 'chat' || lower === 'chat_only' || lower === 'talk') return 'chat_only';
      return lower;
    },
    z
      .enum(['modify_asset', 'resume_task', 'approve_stage', 'propose_stage', 'start_pipeline', 'chat_only'])
      .describe(
        '路由决策类型：modify_asset（局部精修）/ resume_task（任务恢复）/ approve_stage（纯粹授权开跑）/ propose_stage（提炼构想并提议推进，兜底）'
      )
  ),
  targetStage: z.preprocess(
    (v) => {
      if (typeof v !== 'string') return undefined;
      const lower = v.toLowerCase().trim();
      if (lower.includes('gdd') || lower.includes('plan') || lower.includes('stage1') || lower.includes('stage_1')) {
        return 'plan_gdd';
      }
      if (lower.includes('text') || lower.includes('game') || lower.includes('stage2') || lower.includes('stage_2')) {
        return 'build_text_game';
      }
      if (lower.includes('film') || lower.includes('video') || lower.includes('stage3') || lower.includes('stage_3')) {
        return 'compile_film';
      }
      return undefined;
    },
    z
      .enum(['plan_gdd', 'build_text_game', 'compile_film'])
      .optional()
      .describe('意图针对的目标工序阶段（approve_stage/propose_stage/resume_task/modify_asset 时尽量明确填写）')
  ),
  target_stage: z.string().optional(),
  taskId: z
    .string()
    .optional()
    .describe(
      '目标任务 ID：当 action=resume_task 时必填，必须直接从对话历史中的 [关联任务记录 taskId=...] 或黑板任务账本中读取准确 taskId'
    ),
  task_id: z.string().optional(),
  summary: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() ? v.trim() : '推进当前工序'),
    z.string().describe('展示给创作者的一句话行动提议摘要，如“已提炼深海潜艇悬疑博弈设定，建议启动全案策划推演”')
  ),
  payload: z.preprocess(
    (v) => {
      if (!v) return {};
      if (typeof v === 'string') {
        try {
          const parsed = JSON.parse(v);
          return typeof parsed === 'object' && parsed !== null ? parsed : { userPrompt: v };
        } catch {
          return { userPrompt: v };
        }
      }
      return typeof v === 'object' ? v : {};
    },
    z
      .record(z.any())
      .optional()
      .describe(
        '附加参数 JSON 对象：propose_stage 或启动阶段一时填写 {"userPrompt": "提炼后的完整故事构想"}；modify_asset 时填写 {"target": "修改目标", "detail": "修改诉求"}'
      )
  ),
});

export type RouterIntentInput = z.infer<typeof RouterIntentSchema>;

export interface ExtractedRouterProposal {
  action: 'propose_stage' | 'approve_stage' | 'resume_task' | 'modify_asset' | 'start_pipeline';
  targetStage?: 'plan_gdd' | 'build_text_game' | 'compile_film';
  taskId?: string;
  summary: string;
  payload?: Record<string, any>;
}

export type RouterIntentFunnelVerdict =
  | 'attach_running'
  | 'already_running'
  | 'resume_to_stage2'
  | 'resume_task_ready'
  | 'missing_task_id'
  | 'task_not_found'
  | 'task_already_succeeded'
  | 'already_completed'
  | 'missing_premise'
  | 'no_pending_approval'
  | 'approved_to_start_stage1'
  | 'downgraded_modify_to_propose_stage'
  | 'modify_proposal_ready'
  | 'proposal_ready'
  | 'chat_only';

export interface RouterIntentFunnelResult {
  action: 'propose_stage' | 'approve_stage' | 'resume_task' | 'modify_asset' | 'start_pipeline' | 'chat_only';
  targetStage?: 'plan_gdd' | 'build_text_game' | 'compile_film';
  taskId?: string;
  summary: string;
  payload?: Record<string, any>;
  verdict: RouterIntentFunnelVerdict;
  intercepted: boolean;
  guidance: string;
}

export interface RouterTaskLedgerItem {
  taskId: string;
  title: string;
  stage: 'plan_gdd' | 'build_text_game' | 'compile_film';
  status: Task['status'];
  percent: number;
  note: string;
}

function toTaskLedgerItem(t: Task): RouterTaskLedgerItem {
  const stageMeta = (t.result as any)?.currentStage;
  const stage: RouterTaskLedgerItem['stage'] =
    stageMeta === 'build_text_game'
      ? 'build_text_game'
      : stageMeta === 'compile_film'
        ? 'compile_film'
        : 'plan_gdd';
  return {
    taskId: t.taskId,
    title: t.title,
    stage,
    status: t.status,
    percent: Math.min(100, Math.max(0, t.progress?.percent ?? 0)),
    note: t.error || t.progress?.note || '',
  };
}

/**
 * 格式化指定项目的任务账本摘要（供 prompt.ts 与工具描述单源复用）
 */
export function formatProjectTaskLedgerLines(projectId: string, limit: number = 6): string[] {
  const tasks = TaskStore.getInstance().listTasks(projectId);
  if (tasks.length === 0) return [];
  const recent = [...tasks].slice(-limit).reverse().map(toTaskLedgerItem);
  return recent.map(
    (item) =>
      `- taskId=${item.taskId} | 阶段=${item.stage} | 状态=${item.status} | 进度=${item.percent}%${
        item.note ? ` | 说明=${item.note}` : ''
      }`
  );
}

interface HydratedRouterContext {
  projectId?: string;
  latestUserMessage: string;
  hasGdd: boolean;
  hasTextGame: boolean;
  hasFilmSpec: boolean;
  runningTask: Task | null;
  suspendedGddTask: Task | undefined;
  tasks: Task[];
  priorStartProposal: ProjectChatMessage | undefined;
  priorPendingStartProposal: ProjectChatMessage | undefined;
  priorTurnCount: number;
  hasPriorDialogue: boolean;
}

function getPriorChatRecords(
  chat: ProjectChatMessage[],
  latestUserMessage: string
): ProjectChatMessage[] {
  const trimmedCurrent = latestUserMessage.trim();
  let end = chat.length;
  // ChatStreamManager.startStream 会在调用模型前写入本轮 user 与空 streaming assistant 占位消息
  if (
    end > 0 &&
    chat[end - 1]?.role === 'assistant' &&
    chat[end - 1]?.status === 'streaming'
  ) {
    end -= 1;
    if (
      end > 0 &&
      trimmedCurrent &&
      chat[end - 1]?.role === 'user' &&
      chat[end - 1]?.content?.trim() === trimmedCurrent
    ) {
      end -= 1;
    }
  } else if (
    end > 0 &&
    trimmedCurrent &&
    chat[end - 1]?.role === 'user' &&
    chat[end - 1]?.content?.trim() === trimmedCurrent
  ) {
    end -= 1;
  }
  return chat.slice(0, end);
}

function getPriorDialogueTurns(
  turns: RouterDialogueTurn[] | undefined,
  latestUserMessage: string
): RouterDialogueTurn[] {
  if (!Array.isArray(turns) || turns.length === 0) return [];
  const trimmedCurrent = latestUserMessage.trim();
  const last = turns[turns.length - 1];
  if (last?.role === 'user' && (!trimmedCurrent || last.content.trim() === trimmedCurrent)) {
    return turns.slice(0, -1);
  }
  return turns;
}

/**
 * 水合黑板客观工程态势与前序会话元数据（纯读黑板事实，不做自然语言关键词猜测）
 */
function hydrateRouterContext(runtimeCtx?: RouterIntentToolContext): HydratedRouterContext {
  const projectId = runtimeCtx?.projectId;
  const latestUserMessage = (
    runtimeCtx?.latestUserMessage ||
    [...(runtimeCtx?.dialogueTurns || [])].reverse().find((t) => t.role === 'user')?.content ||
    ''
  ).trim();

  const priorTurns = getPriorDialogueTurns(runtimeCtx?.dialogueTurns, latestUserMessage);

  if (!projectId) {
    return {
      latestUserMessage,
      hasGdd: false,
      hasTextGame: false,
      hasFilmSpec: false,
      runningTask: null,
      suspendedGddTask: undefined,
      tasks: [],
      priorStartProposal: undefined,
      priorPendingStartProposal: undefined,
      priorTurnCount: priorTurns.length,
      hasPriorDialogue: priorTurns.length > 0,
    };
  }

  const store = ProjectStore.getInstance();
  const taskStore = TaskStore.getInstance();
  const project = store.getProject(projectId);

  const hasGdd = Boolean(store.getArtifact(projectId, 'gdd') || store.getArtifact(projectId, 'planner_prd'));
  const hasTextGame = Boolean(store.getArtifact(projectId, 'text_game'));
  const hasFilmSpec = Boolean(store.getArtifact(projectId, 'film_spec'));

  const runningTask = taskStore.getRunningTask(projectId);
  const allTasks = taskStore.listTasks(projectId);
  const suspendedGddTask = [...allTasks]
    .reverse()
    .find(
      (t) =>
        t.status === 'suspended' &&
        (t.result as any)?.pendingApproval?.type === 'gdd_approval'
    );

  const priorChat = getPriorChatRecords(project?.chat || [], latestUserMessage);
  const isStartProposal = (act?: string) => act === 'propose_stage' || act === 'start_pipeline';
  const priorStartProposal = [...priorChat]
    .reverse()
    .find((m) => isStartProposal(m.proposal?.action) && m.proposal?.payload?.userPrompt);
  const priorPendingStartProposal = [...priorChat]
    .reverse()
    .find(
      (m) =>
        isStartProposal(m.proposal?.action) &&
        !m.proposalResolved &&
        m.proposal?.payload?.userPrompt
    );

  const priorTurnCount = Math.max(priorChat.length, priorTurns.length);

  return {
    projectId,
    latestUserMessage,
    hasGdd,
    hasTextGame,
    hasFilmSpec,
    runningTask,
    suspendedGddTask,
    tasks: allTasks,
    priorStartProposal,
    priorPendingStartProposal,
    priorTurnCount,
    hasPriorDialogue: priorTurnCount > 0,
  };
}

/**
 * 意图元数据描述器接口
 */
export interface IntentDescriptor {
  action: 'modify_asset' | 'resume_task' | 'approve_stage' | 'propose_stage';
  name: string;
  describe: (ctx: HydratedRouterContext) => string;
}

/**
 * 1 2 3 4 核心意图清单 SSOT
 */
export const ROUTER_INTENT_REGISTRY: Record<
  'modify_asset' | 'resume_task' | 'approve_stage' | 'propose_stage',
  IntentDescriptor
> = {
  // 1. 局部精修与定向微调
  modify_asset: {
    action: 'modify_asset',
    name: '局部精修与微调',
    describe: () =>
      '只要创作者表达中包含对人设、剧情分支、玩法规则或结局等已有产物的修改、调整、删改或新增诉求（哪怕开头先说了认同或肯定），必须选 modify_asset 并填写 target 与 detail',
  },
  // 2. 恢复历史中断/取消任务
  resume_task: {
    action: 'resume_task',
    name: '恢复中断任务',
    describe: () =>
      '创作者明确要求恢复、继续、接着执行历史中断/取消的任务时，选 resume_task 并填入目标 taskId',
  },
  // 3. 纯粹授权推进 / 确认开工
  approve_stage: {
    action: 'approve_stage',
    name: '纯粹授权推进 / 确认开工',
    describe: (ctx) =>
      ctx.suspendedGddTask
        ? '创作者确认策划案、要求进入阶段二（“同意”、“进入文游”、“开始装配”、“继续”），选 approve_stage 立即启动阶段二互动文游装配'
        : '创作者整句表达纯粹是在确认推进、授权开工（如“开始吧”、“启动”、“开工”、“开跑”、“同意”、“可以”等且不附带新修改条件），且存在待确认方案时，选 approve_stage 立即触发全案策划推演',
  },
  // 4. 创意提炼与推进提案（天然兜底）
  propose_stage: {
    action: 'propose_stage',
    name: '创意提炼与推进提案（天然兜底）',
    describe: (ctx) =>
      !ctx.hasGdd
        ? '创作者提出故事灵感、角色细节、构想探讨或剧情问题，由总导演提炼整合为完整构想，在输入框旁生成待确认立项卡片（等待创作者确认，不会擅自开跑）；每次探讨构思均输出此提案推动创作者开工'
        : '创作者提出宏观剧情或玩法探讨，提炼方案并在输入框旁生成推进卡片，等待创作者确认',
  },
};

/**
 * 工程生命周期客观状态
 */
export type ProjectLifecycleState =
  | 'pre_planning'          // 态 1: 立项前（无 GDD）
  | 'gdd_review'            // 态 2: 阶段一已完稿，挂起审批推进阶段二
  | 'text_game_ready'       // 态 3: 阶段二互动文游已完成
  | 'default_fallback';     // 态 4: 通用兜底态

/**
 * 状态意图决策矩阵（配置驱动）：
 * 数组中元素的排列顺序严格决定自顶向下的优先级（P0 -> P1 -> P2）
 */
export const STATE_INTENT_MATRIX: Record<
  ProjectLifecycleState,
  {
    standard: ('modify_asset' | 'resume_task' | 'approve_stage' | 'propose_stage')[];
    withRecoverableTask?: ('modify_asset' | 'resume_task' | 'approve_stage' | 'propose_stage')[];
  }
> = {
  // 态 1：立项前 —— 开工优先，构思兜底（绝无 modify_asset）
  pre_planning: {
    standard: ['approve_stage', 'propose_stage'],
    withRecoverableTask: ['resume_task', 'approve_stage', 'propose_stage'],
  },
  // 态 2：阶段一挂起审批 —— 修改优先，开工推进次之，构思兜底
  gdd_review: {
    standard: ['modify_asset', 'approve_stage', 'propose_stage'],
    withRecoverableTask: ['resume_task', 'modify_asset', 'approve_stage', 'propose_stage'],
  },
  // 态 3：阶段二互动文游完成 —— 微调优先，下一阶段提案兜底
  text_game_ready: {
    standard: ['modify_asset', 'propose_stage'],
    withRecoverableTask: ['resume_task', 'modify_asset', 'propose_stage'],
  },
  // 态 4：通用全集兜底
  default_fallback: {
    standard: ['modify_asset', 'resume_task', 'approve_stage', 'propose_stage'],
  },
};

/**
 * 判定当前工程生命周期状态的纯函数
 */
export function resolveLifecycleState(ctx: HydratedRouterContext): ProjectLifecycleState {
  if (!ctx.hasGdd) return 'pre_planning';
  if (ctx.suspendedGddTask) return 'gdd_review';
  if (ctx.hasTextGame) return 'text_game_ready';
  return 'default_fallback';
}

/**
 * 根据工程黑板客观状态与配置矩阵动态组装意图契约（数组顺序自动决定优先级）
 */
export function buildDynamicRouterIntentSchema(ctx: HydratedRouterContext): z.ZodObject<any> {
  const state = resolveLifecycleState(ctx);
  const cfg = STATE_INTENT_MATRIX[state];
  const hasRecoverableTask = ctx.tasks.some(
    (t) => t.status === 'cancelled' || t.status === 'failed' || t.status === 'suspended'
  );

  // 1. 提取当前状态下的动作数组（配置数组顺序直接决定优先级）
  const activeActions =
    hasRecoverableTask && cfg.withRecoverableTask
      ? cfg.withRecoverableTask
      : cfg.standard;

  // 2. 依据数组顺序自动渲染 P0 -> P1 -> P2 连贯描述
  const actionDescriptionLines = activeActions.map((act, index) => {
    const item = ROUTER_INTENT_REGISTRY[act];
    return `【P${index} · ${act} ${item.name}】${item.describe(ctx)}`;
  });

  const fullDescription =
    `路由决策类型（必须严格按 P0 -> P${activeActions.length - 1} 优先级判定）：\n` +
    actionDescriptionLines.join('\n');

  return z.object({
    contextAnalysis: z
      .string()
      .optional()
      .describe('结合对话历史与实时工程状态，简述判断依据与意图定位'),
    action: z.preprocess(
      (v) => {
        if (typeof v !== 'string') return activeActions[activeActions.length - 1];
        const lower = v.toLowerCase().trim();
        if (activeActions.includes(lower as any)) return lower;
        if (lower === 'start_pipeline' || lower === 'startpipeline') {
          return activeActions.includes('propose_stage' as any)
            ? 'propose_stage'
            : activeActions[activeActions.length - 1];
        }
        if (lower === 'chat' || lower === 'chat_only' || lower === 'talk') {
          return activeActions.includes('propose_stage' as any)
            ? 'propose_stage'
            : activeActions[activeActions.length - 1];
        }
        return activeActions[activeActions.length - 1];
      },
      z.enum(activeActions as [string, ...string[]]).describe(fullDescription)
    ),
    targetStage: z.preprocess(
      (v) => {
        if (typeof v !== 'string') return undefined;
        const lower = v.toLowerCase().trim();
        if (lower.includes('gdd') || lower.includes('plan') || lower.includes('stage1') || lower.includes('stage_1')) {
          return 'plan_gdd';
        }
        if (lower.includes('text') || lower.includes('game') || lower.includes('stage2') || lower.includes('stage_2')) {
          return 'build_text_game';
        }
        if (lower.includes('film') || lower.includes('video') || lower.includes('stage3') || lower.includes('stage_3')) {
          return 'compile_film';
        }
        return undefined;
      },
      z
        .enum(['plan_gdd', 'build_text_game', 'compile_film'])
        .optional()
        .describe('目标工序阶段')
    ),
    target_stage: z.string().optional(),
    taskId: z.string().optional().describe('目标任务 ID（resume_task 时必填）'),
    task_id: z.string().optional(),
    summary: z.preprocess(
      (v) => (typeof v === 'string' && v.trim() ? v.trim() : '推进当前工序'),
      z.string().describe('展示给创作者的一句话行动提议摘要')
    ),
    payload: z.preprocess(
      (v) => {
        if (!v) return {};
        if (typeof v === 'string') {
          try {
            const parsed = JSON.parse(v);
            return typeof parsed === 'object' && parsed !== null ? parsed : { userPrompt: v };
          } catch {
            return { userPrompt: v };
          }
        }
        return typeof v === 'object' ? v : {};
      },
      z
        .record(z.any())
        .optional()
        .describe(
          '附加参数 JSON：propose_stage 或启动阶段一时填写 {"userPrompt": "提炼后的完整故事构想"}；modify_asset 时填写 {"target": "目标", "detail": "诉求"}'
        )
    ),
  });
}

/**
 * 构建内聚实时工程态势的工具描述，让 AI 自己基于完整语境完成 P0 -> P3 多层语义漏斗决策
 */
function buildCohesiveToolDescription(runtimeCtx?: RouterIntentToolContext): string {
  const baseDesc =
    '中枢路由总控唯一官方意图决策工具（内聚多层语义漏斗）。无论创作者是提出创意、补充或修改设定、要求恢复已停止或中断任务、纯粹确认推进还是纯对话咨询，都必须先调用本工具自主理解识别真实意图，并在正文回复中严格遵循本工具返回的 `guidance`，严禁抢跑声称任务已启动或已完成。';

  if (!runtimeCtx?.projectId && !runtimeCtx?.latestUserMessage && !runtimeCtx?.dialogueTurns?.length) {
    return baseDesc;
  }

  const ctx = hydrateRouterContext(runtimeCtx);
  const stageFacts = [
    `阶段一 GDD=${ctx.hasGdd ? '已完成(✅)' : '未生成(⏳)'}`,
    `阶段二 TextGame=${ctx.hasTextGame ? '已完成(✅)' : '未生成(⏳)'}`,
    `阶段三 FilmSpec=${ctx.hasFilmSpec ? '已完成(✅)' : '未生成(⏳)'}`,
  ].join(' | ');

  const ledgerLines = ctx.projectId ? formatProjectTaskLedgerLines(ctx.projectId, 6) : [];
  const recoverableTasks = ctx.tasks
    .filter((t) => t.status === 'cancelled' || t.status === 'failed' || t.status === 'suspended')
    .map(toTaskLedgerItem);

  const taskFact = ctx.runningTask
    ? `运行中任务=${ctx.runningTask.taskId}`
    : ctx.suspendedGddTask
      ? `挂起待审批推进阶段二=${ctx.suspendedGddTask.taskId}(gdd_approval)`
      : recoverableTasks.length > 0
        ? `存在可恢复任务=${recoverableTasks
            .map((t) => `${t.taskId}(${t.stage}/${t.status})`)
            .join('、')}`
        : '无挂起或待恢复任务';

  const proposalPrompt =
    typeof ctx.priorPendingStartProposal?.proposal?.payload?.userPrompt === 'string'
      ? ctx.priorPendingStartProposal.proposal.payload.userPrompt.trim()
      : '';
  const proposalFact = proposalPrompt
    ? `已形成待确认立项策划方案（构想摘要：${proposalPrompt.slice(0, 80)}，等待创作者确认或发起“开始/启动/同意”开跑）`
    : ctx.priorStartProposal
      ? '曾产生过历史立项策划方案'
      : '尚未形成任何立项提案';

  const ledgerBlock =
    ledgerLines.length > 0 ? `\n【历史任务账本（传 resume_task 时请从中读取准确 taskId）】：\n${ledgerLines.join('\n')}` : '';

  return (
    `${baseDesc}\n` +
    `【当前工具内聚实时上下文】：${stageFacts}；${taskFact}；${proposalFact}；前序对话消息数=${ctx.priorTurnCount}。` +
    `${ledgerBlock}\n` +
    '请先在 `contextAnalysis` 中审视完整对话脉络与上述状态，再严格按 P0（修改/附加条件优先）➔ P1（resume_task 带准确 taskId 恢复中断任务 / approve_stage 纯粹授权）➔ P2（创意收敛待审）➔ P3（交流/澄清/无前提兜底）自主裁决。'
  );
}

/**
 * 客观工程态门禁 (`evaluateRouterIntentFunnel`)
 * 不对自然语言做任何关键词或正则硬编码猜测，仅基于 AI 结构化决策与黑板物理态执行客观边界校验：
 * - 运行中任务防并发重开；
 * - 已挂起 `gdd_approval` 任务锚定阶段二；
 * - 已完成阶段二防重复启动；
 * - 无产物时拒绝执行 `modify_asset`；
 * - 没有任何前序提案且模型未提炼出独立创意前提时，拒绝 `approve_stage` 空启动。
 */
export function evaluateRouterIntentFunnel(
  runtimeCtx: RouterIntentToolContext | undefined,
  rawSignal: RouterIntentInput
): RouterIntentFunnelResult {
  if (!rawSignal.targetStage && (rawSignal as any).target_stage) {
    rawSignal.targetStage = (rawSignal as any).target_stage;
  }
  if (!rawSignal.taskId && (rawSignal as any).task_id) {
    rawSignal.taskId = (rawSignal as any).task_id;
  }
  const ctx = hydrateRouterContext(runtimeCtx);
  const msg = ctx.latestUserMessage;
  const rawPayload =
    rawSignal.payload && typeof rawSignal.payload === 'object' ? { ...rawSignal.payload } : {};

  if (rawSignal.action === 'resume_task') {
    if (ctx.runningTask) {
      return {
        action: 'chat_only',
        summary: '当前已有任务正在执行中',
        verdict: 'already_running',
        intercepted: true,
        guidance: `当前已有任务 [${ctx.runningTask.taskId}] 正在后台运行，请告知创作者等待其完成或先停止后再恢复其他任务。`,
      };
    }

    const requestedTaskId = typeof rawSignal.taskId === 'string' ? rawSignal.taskId.trim() : '';
    const recoverableList = ctx.tasks
      .filter((t) => t.status === 'cancelled' || t.status === 'failed' || t.status === 'suspended')
      .map(toTaskLedgerItem);

    if (!requestedTaskId) {
      const hint = recoverableList.length
        ? `可用任务：${recoverableList.map((t) => `${t.taskId}(${t.stage}/${t.status})`).join('、')}`
        : '当前项目暂无被取消或中断的任务记录。';
      return {
        action: 'chat_only',
        summary: '缺少明确的目标 taskId，无法定位要恢复的任务',
        verdict: 'missing_task_id',
        intercepted: true,
        guidance: `调用 resume_task 必须明确传入目标 \`taskId\`。${hint} 请重新读取上下文任务记录并传入准确 \`taskId\`，或向创作者确认。`,
      };
    }

    const targetTask = ctx.tasks.find((t) => t.taskId === requestedTaskId);
    if (!targetTask) {
      const hint = recoverableList.length
        ? `当前可恢复的任务仅有：${recoverableList.map((t) => `${t.taskId}(${t.stage}/${t.status})`).join('、')}`
        : '当前项目没有任何任务记录。';
      return {
        action: 'chat_only',
        summary: `未找到任务记录 ${requestedTaskId}`,
        verdict: 'task_not_found',
        intercepted: true,
        guidance: `在项目中找不到 taskId="${requestedTaskId}" 的任务记录（严禁猜测替换）。${hint}`,
      };
    }

    if (targetTask.status === 'succeeded') {
      return {
        action: 'chat_only',
        summary: `任务 ${targetTask.taskId} 已完成，无需恢复`,
        verdict: 'task_already_succeeded',
        intercepted: true,
        guidance: `任务 [${targetTask.taskId}] 已成功结束（succeeded），无需再次恢复执行。请告知创作者当前进展并引导下一步操作。`,
      };
    }

    const ledgerItem = toTaskLedgerItem(targetTask);
    const effectiveStage =
      targetTask.status === 'suspended' && (targetTask.result as any)?.pendingApproval?.type === 'gdd_approval'
        ? 'build_text_game'
        : ledgerItem.stage;

    return {
      action: 'resume_task',
      targetStage: effectiveStage,
      taskId: targetTask.taskId,
      summary: rawSignal.summary || `恢复任务 ${targetTask.taskId}（${effectiveStage}）继续执行`,
      ...(Object.keys(rawPayload).length > 0 ? { payload: rawPayload } : {}),
      verdict: 'resume_task_ready',
      intercepted: false,
      guidance: `已锚定目标任务 [${targetTask.taskId}]（阶段：${effectiveStage}），系统将沿用该任务记录恢复流水线并从已完成步骤后继续执行，进度将在本消息中实时展示。请用一句话沉稳告知创作者已恢复执行。`,
    };
  }

  if (rawSignal.action === 'approve_stage') {
    if (ctx.runningTask) {
      const currentStage = (ctx.runningTask.result as any)?.currentStage;
      const stage = currentStage === 'build_text_game' ? 'build_text_game' : 'plan_gdd';
      return {
        action: 'approve_stage',
        targetStage: stage,
        summary: rawSignal.summary || '当前已有运行中任务，挂载实时进度',
        payload: Object.keys(rawPayload).length > 0 ? rawPayload : undefined,
        verdict: 'attach_running',
        intercepted: false,
        guidance: '项目已有任务正在后台执行，进度将挂载到本条消息中。请简短告知创作者正在继续推进。',
      };
    }

    if (ctx.suspendedGddTask) {
      return {
        action: 'approve_stage',
        targetStage: 'build_text_game',
        summary: rawSignal.summary || '已确认阶段一策划案，启动阶段二互动文游装配',
        payload: Object.keys(rawPayload).length > 0 ? rawPayload : undefined,
        verdict: 'resume_to_stage2',
        intercepted: false,
        guidance:
          '阶段一策划案已就绪，本次授权将立即唤醒并启动阶段二互动文游装配（build_text_game）。请用一句话沉稳确认已开始生成文游，不要再提示用户点击确认按钮。',
      };
    }

    if (ctx.hasTextGame) {
      return {
        action: 'chat_only',
        summary: '阶段二互动文游已装配完成，当前无待审批的推进任务',
        verdict: 'already_completed',
        intercepted: true,
        guidance:
          '阶段二互动文游已经生成完毕，目前没有待推进的后续自动工序。请引导创作者直接在右侧试玩体验，或提出具体的局部调整要求。',
      };
    }

    if (ctx.hasGdd) {
      return {
        action: 'chat_only',
        summary: '当前阶段一策划案已存在，暂无处于挂起待审批状态的阶段推进任务',
        verdict: 'no_pending_approval',
        intercepted: true,
        guidance:
          '当前阶段一策划案已存在，但系统内暂无挂起待审批的推进任务，本次不会触发自动执行。请告知创作者当前工程态势，并引导其提出具体修改意见或明确下一步指令。',
      };
    }

    // !hasGdd：核验工程前提——优先采纳前序持久化提案，或由 AI 从前情中明确提炼出的 userPrompt
    const rawPrompt = typeof rawPayload.userPrompt === 'string' ? rawPayload.userPrompt.trim() : '';
    const priorProposalPrompt =
      typeof ctx.priorStartProposal?.proposal?.payload?.userPrompt === 'string'
        ? ctx.priorStartProposal.proposal.payload.userPrompt.trim()
        : '';

    const aiDistilledDistinctPrompt = rawPrompt && rawPrompt !== msg ? rawPrompt : '';
    const effectivePremise = aiDistilledDistinctPrompt || priorProposalPrompt;

    if (!effectivePremise) {
      return {
        action: 'chat_only',
        summary: '尚无有效故事构想或待确认提案，引导创作者先补充创作方向',
        verdict: 'missing_premise',
        intercepted: true,
        guidance:
          '当前项目尚未形成任何故事创意或待确认提案（不能在空白前提下直接启动推演）。请温和告诉创作者当前还没有确定题材、主角或剧情方向，并引导其先描述想要创作的故事设想。严禁声称任务已启动！',
      };
    }

    return {
      action: 'approve_stage',
      targetStage: 'plan_gdd',
      summary: rawSignal.summary || '已确认立项方向，立即启动阶段一全案策划推演',
      payload: { ...rawPayload, userPrompt: effectivePremise },
      verdict: 'approved_to_start_stage1',
      intercepted: false,
      guidance:
        '创作者已明确确认立项方案，系统将在本轮同步启动阶段一全案策划推演（plan_gdd）并在本消息内实时展示进度。请用一句话沉稳确认已开始推演，严禁再提示用户点确认按钮。',
    };
  }

  if (rawSignal.action === 'modify_asset') {
    if (!ctx.hasGdd && !ctx.hasTextGame) {
      const priorProposalPrompt =
        typeof ctx.priorStartProposal?.proposal?.payload?.userPrompt === 'string'
          ? ctx.priorStartProposal.proposal.payload.userPrompt.trim()
          : '';
      const rawPrompt =
        (typeof rawPayload.userPrompt === 'string' && rawPayload.userPrompt.trim()) ||
        (typeof rawPayload.detail === 'string' && rawPayload.detail.trim()) ||
        msg;
      const candidatePrompt =
        priorProposalPrompt && rawPrompt && rawPrompt !== priorProposalPrompt && !rawPrompt.includes(priorProposalPrompt)
          ? `${priorProposalPrompt}\n补充调整：${rawPrompt}`
          : rawPrompt || priorProposalPrompt;

      if (!candidatePrompt) {
        return {
          action: 'chat_only',
          summary: '尚未立项生成任何资产，请先提供故事创作方向',
          verdict: 'missing_premise',
          intercepted: true,
          guidance:
            '当前项目还没有生成任何策划案或文游资产，无法执行局部修改。请引导创作者先提出故事灵感。',
        };
      }

      return {
        action: 'propose_stage',
        targetStage: 'plan_gdd',
        summary: '当前尚未立项产出，已将您的调整设想整合为待确认立项提案',
        payload: { userPrompt: candidatePrompt },
        verdict: 'downgraded_modify_to_propose_stage',
        intercepted: true,
        guidance:
          '由于尚未生成任何落盘产物，系统已将修改诉求收敛为待确认立项提案（propose_stage）。请简述更新后的立项设想并邀请创作者确认启动。',
      };
    }

    const detail = (typeof rawPayload.detail === 'string' && rawPayload.detail.trim()) || msg || rawSignal.summary;
    const target = (typeof rawPayload.target === 'string' && rawPayload.target.trim()) || (ctx.hasTextGame ? 'text_game' : 'gdd');

    return {
      action: 'modify_asset',
      targetStage: rawSignal.targetStage || (ctx.hasTextGame ? 'build_text_game' : 'plan_gdd'),
      summary: rawSignal.summary || '已提炼局部修改建议，等待创作者确认后执行',
      payload: { ...rawPayload, target, detail },
      verdict: 'modify_proposal_ready',
      intercepted: false,
      guidance:
        '已形成局部修改提案，请向创作者说明计划调整的部位与方向，并提示确认后再执行，严禁声称已经修改完成。',
    };
  }

  if (rawSignal.action === 'propose_stage' || (rawSignal.action as any) === 'start_pipeline') {
    if (ctx.runningTask) {
      return {
        action: 'chat_only',
        summary: '当前已有任务正在执行中',
        verdict: 'attach_running',
        intercepted: true,
        guidance: '后台已有任务正在推演中，请提醒创作者稍候当前任务完成。',
      };
    }

    const rawUserPrompt =
      typeof rawPayload.userPrompt === 'string' ? rawPayload.userPrompt.trim() : '';
    const priorPendingPrompt =
      typeof ctx.priorPendingStartProposal?.proposal?.payload?.userPrompt === 'string'
        ? ctx.priorPendingStartProposal.proposal.payload.userPrompt.trim()
        : '';
    const priorProposalPrompt =
      priorPendingPrompt ||
      (typeof ctx.priorStartProposal?.proposal?.payload?.userPrompt === 'string'
        ? ctx.priorStartProposal.proposal.payload.userPrompt.trim()
        : '');
    const finalUserPrompt = rawUserPrompt || priorProposalPrompt || msg;

    if (!finalUserPrompt) {
      return {
        action: 'chat_only',
        summary: '尚无明确立项题材内容，等待创作者补充构想',
        verdict: 'missing_premise',
        intercepted: true,
        guidance:
          '创作者尚未给出具体的故事题材或剧情核心，请引导其先补充设定细节，暂不生成立项启动卡片。',
      };
    }

    return {
      action: 'propose_stage',
      targetStage: rawSignal.targetStage || 'plan_gdd',
      summary: rawSignal.summary || '已提炼核心戏剧冲突与玩法构想，建议启动全案策划推演',
      payload: { ...rawPayload, userPrompt: finalUserPrompt },
      verdict: 'proposal_ready',
      intercepted: false,
      guidance:
        '已为您生成待确认的立项提案（propose_stage）。请在回复中精炼呈现故事亮点与可打磨方向，邀请创作者继续补充，或点击确认按钮启动全案推演，严禁抢跑声称已启动。',
    };
  }

  return {
    action: 'chat_only',
    summary: rawSignal.summary || '继续创作交流探讨',
    verdict: 'chat_only',
    intercepted: false,
    guidance: '本轮属于创作交流、澄清或待补充构想阶段，请直接自然作答，无需承诺启动或修改任何流水线任务。',
  };
}

/**
 * 工厂函数：构造绑定实时工程与对话上下文的中枢意图决策工具 (SSOT)
 */
export function createRouterIntentTool(runtimeCtx?: RouterIntentToolContext) {
  const ctx = hydrateRouterContext(runtimeCtx);
  const dynamicSchema = buildDynamicRouterIntentSchema(ctx);
  return createTool({
    id: EMIT_ROUTER_INTENT_TOOL_ID,
    description: buildCohesiveToolDescription(runtimeCtx),
    inputSchema: dynamicSchema,
    execute: async ({ context }) => {
      return evaluateRouterIntentFunnel(runtimeCtx, context as any);
    },
  });
}

/**
 * 静态默认导出（供无运行时上下文场景及容器自省兼容使用）
 */
export const emitRouterIntentTool = createRouterIntentTool();

function isFunnelResultObject(val: unknown): val is RouterIntentFunnelResult {
  return Boolean(
    val &&
      typeof val === 'object' &&
      'verdict' in val &&
      'action' in val &&
      typeof (val as any).action === 'string'
  );
}

/**
 * 从 AI SDK streamText 的全量 steps 中提取最终有效路由器提案（单一提取出口）
 * 优先消费经过第 0 步工具 `execute` 校验后的 `toolResults`；
 * 若某路径仅有 `toolCalls` 而缺 `toolResults`，兜底执行同一 `evaluateRouterIntentFunnel`。
 */
export function extractRouterIntentFromSteps(
  steps: ReadonlyArray<{
    toolCalls?: Array<{ toolCallId?: string; toolName?: string; args?: any }>;
    toolResults?: Array<{ toolCallId?: string; toolName?: string; result?: any; args?: any }>;
  }> | undefined,
  runtimeCtx?: RouterIntentToolContext
): ExtractedRouterProposal | undefined {
  if (!Array.isArray(steps) || steps.length === 0) return undefined;

  const candidates: any[] = [];
  for (const step of steps) {
    const resultById = new Map<string, any>();
    for (const tr of step.toolResults || []) {
      if (tr?.toolName === EMIT_ROUTER_INTENT_TOOL_ID && tr.toolCallId) {
        resultById.set(tr.toolCallId, tr.result ?? tr.args);
      }
    }

    for (const tc of step.toolCalls || []) {
      if (tc?.toolName !== EMIT_ROUTER_INTENT_TOOL_ID) continue;
      const resolved = (tc.toolCallId && resultById.get(tc.toolCallId)) ?? tc.args;
      if (resolved !== undefined) {
        candidates.push(resolved);
      }
    }
  }

  for (let i = candidates.length - 1; i >= 0; i--) {
    const rawCandidate = candidates[i];
    const funnelResult: RouterIntentFunnelResult | undefined = isFunnelResultObject(rawCandidate)
      ? rawCandidate
      : (() => {
          const parsed = resolveToolArgs<RouterIntentInput>(rawCandidate, RouterIntentSchema);
          return parsed ? evaluateRouterIntentFunnel(runtimeCtx, parsed) : undefined;
        })();

    if (!funnelResult) continue;
    if (funnelResult.action === 'chat_only') return undefined;

    return {
      action: funnelResult.action === 'start_pipeline' ? 'propose_stage' : funnelResult.action,
      ...(funnelResult.targetStage ? { targetStage: funnelResult.targetStage } : {}),
      ...(funnelResult.taskId ? { taskId: funnelResult.taskId } : {}),
      summary: funnelResult.summary,
      ...(funnelResult.payload && Object.keys(funnelResult.payload).length > 0
        ? { payload: funnelResult.payload }
        : {}),
    };
  }

  return undefined;
}
