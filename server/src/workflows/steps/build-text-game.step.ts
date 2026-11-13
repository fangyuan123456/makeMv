/**
 * workflows/steps/build-text-game.step.ts
 * 步骤二：文游 (TextGame) 扩写装配 - 基于 Mastra 官方 createStep 规范
 *
 * 单一事实来源 (SSOT)：
 * 严格直读 Stage 1 Step 4 最终交付产物 `prd.md` + `story.md`（或同进程内 `planner_prd`），
 * 零回溯读取 Step 2/3 过程产物，缺失交付文件立即 Fail-Fast 阻断。
 */

import { createStep } from '@mastra/core/workflows';
import { z } from 'zod';
import {
  runTextGameWorkflow,
  runLookdevWorkflow,
  convertScenesToTextGameArtifact,
  TextGameArtifactSchema,
  type TextGameArtifact,
  type GlobalEntities,
} from '../../agents/text-game/index.js';
import { StoryGraphSvgRenderer } from '../../media/index.js';
import type { GDDArtifact } from '../../agents/planner/schema.js';
import {
  UniversalPrdSpecSchema,
  type UniversalPrdSpec,
  type PrdUiPageSpec,
} from '../../agents/planner/steps/prd-synthesis/schema.js';
import { parsePrdEmbeddedJson } from '../../agents/planner/steps/topology-validation/validator.js';
import { ProjectStore } from '../../project-store/ProjectStore.js';
import {
  STAGE,
  PLANNER_STEP,
  TEXT_GAME_STEP,
  readArtifactFile,
  writeArtifactFile,
} from '../../project-store/artifact-fs.js';
import { createProgressReporter } from '../../workflow-engine/progress.js';

export const buildTextGameStepInputSchema = z.object({
  projectId: z.string(),
  taskId: z.string().optional(),
});

export const buildTextGameStepOutputSchema = z.object({
  projectId: z.string(),
  textGame: TextGameArtifactSchema,
});

export type BuildTextGameStepInput = z.infer<typeof buildTextGameStepInputSchema>;
export type BuildTextGameStepOutput = z.infer<typeof buildTextGameStepOutputSchema>;

function parsePrdMarkdownHeaderMeta(prdMarkdown: string): {
  genre?: string;
  premiseAndPerspective?: string;
  outOfFlowSummary?: string;
  gameplayAndVictorySummary?: string;
  uiPagesSummary: PrdUiPageSpec[];
} {
  const genre = prdMarkdown.match(/题材[：:]\s*([^）\)\r\n]+)/)?.[1]?.trim();
  const premiseAndPerspective = prdMarkdown.match(/-\s*\*\*背景与视角\*\*[：:]\s*([^\r\n]+)/)?.[1]?.trim();
  const outOfFlowSummary = prdMarkdown.match(/-\s*\*\*流外状态\*\*[：:]\s*([^\r\n]+)/)?.[1]?.trim();
  const gameplayMatch = prdMarkdown.match(/-\s*\*\*怎么玩与胜负条件\*\*[：:]\s*([^\r\n]+)/)?.[1]?.trim();
  const gameplayAndVictorySummary = gameplayMatch?.replace(/（精确条件以上方.*$/, '').trim();

  const uiPagesSummary: PrdUiPageSpec[] = [];
  const uiSectionMatch = prdMarkdown.split(/^##\s*5\.\s*游戏界面与功能/m)[1];
  if (uiSectionMatch) {
    for (const line of uiSectionMatch.split(/\r?\n/)) {
      const m = line.match(/^-\s*\*\*([^*]+)\*\*[：:]\s*(.+)$/);
      if (m) {
        uiPagesSummary.push({ page: m[1].trim(), features: m[2].trim() });
      }
    }
  }

  return {
    genre,
    premiseAndPerspective,
    outOfFlowSummary,
    gameplayAndVictorySummary,
    uiPagesSummary,
  };
}

/**
 * 纯函数从 Step 4 交付文件 `prd.md` 解析并强校验 `UniversalPrdSpec`
 */
export function parseUniversalPrdFromMarkdown(prdMarkdown: string): UniversalPrdSpec {
  const parsedJson = parsePrdEmbeddedJson(prdMarkdown);
  if (!parsedJson.ok || !parsedJson.data || typeof parsedJson.data !== 'object') {
    throw new Error(
      `[BuildTextGameStep] prd.md 缺少合法的第 3 章结构化 JSON 契约: ${!parsedJson.ok ? parsedJson.error : '无效对象'}`
    );
  }

  const raw = parsedJson.data as Record<string, any>;
  const meta = parsePrdMarkdownHeaderMeta(prdMarkdown);
  const gameTitle =
    typeof raw.gameTitle === 'string' && raw.gameTitle.trim() ? raw.gameTitle.trim() : '互动影游';

  const candidateSpec = {
    ...raw,
    gameTitle,
    genre: typeof raw.genre === 'string' && raw.genre.trim() ? raw.genre.trim() : meta.genre || '互动影游',
    playerIdentity:
      typeof raw.playerIdentity === 'string' && raw.playerIdentity.trim()
        ? raw.playerIdentity.trim()
        : '第一视角亲历者',
    premiseAndPerspective:
      typeof raw.premiseAndPerspective === 'string' && raw.premiseAndPerspective.trim()
        ? raw.premiseAndPerspective.trim()
        : meta.premiseAndPerspective || `《${gameTitle}》互动影游。`,
    outOfFlowSummary:
      typeof raw.outOfFlowSummary === 'string' && raw.outOfFlowSummary.trim()
        ? raw.outOfFlowSummary.trim()
        : meta.outOfFlowSummary || '无',
    gameplayAndVictorySummary:
      typeof raw.gameplayAndVictorySummary === 'string' && raw.gameplayAndVictorySummary.trim()
        ? raw.gameplayAndVictorySummary.trim()
        : meta.gameplayAndVictorySummary || '按段观看视频并在播完后做出抉择，推进至结局。',
    uiPagesSummary:
      Array.isArray(raw.uiPagesSummary) && raw.uiPagesSummary.length > 0
        ? raw.uiPagesSummary
        : meta.uiPagesSummary.length > 0
          ? meta.uiPagesSummary
          : [
              { page: '主页', features: '开始/继续游戏、功能入口' },
              { page: '播放页', features: '全屏播片、字幕、播完互动浮层、暂停入口' },
              { page: '暂停与设置', features: '继续、重看本段、返回主页、音量/字幕开关' },
            ],
  };

  const result = UniversalPrdSpecSchema.safeParse(candidateSpec);
  if (!result.success) {
    throw new Error(
      `[BuildTextGameStep] prd.md 结构化契约校验失败: ${result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`
    );
  }
  return result.data;
}

export interface PlannerDeliverables {
  prd: UniversalPrdSpec;
  storyMarkdown: string;
  title: string;
}

/**
 * 统一读取 Stage 1 Step 4 交付物（prd.md + story.md），
 * A1 资源线与游戏线都从这里取同一份策划案，避免两条路各读一套导致漂移。
 */
export function loadPlannerDeliverables(projectId: string): PlannerDeliverables {
  const store = ProjectStore.getInstance();
  const prdMarkdownOnDisk = readArtifactFile(projectId, 'delivery', STAGE.planner, PLANNER_STEP.prd, 'prd.md');
  const storyMarkdownOnDisk = readArtifactFile(projectId, 'delivery', STAGE.planner, PLANNER_STEP.prd, 'story.md');

  const prdArtifact = store.getArtifact<any>(projectId, 'planner_prd');
  const rawPrdObj =
    prdArtifact && typeof prdArtifact === 'object'
      ? prdArtifact.prd && typeof prdArtifact.prd === 'object'
        ? prdArtifact.prd
        : prdArtifact
      : null;
  const inMemoryPrd: UniversalPrdSpec | null =
    rawPrdObj && Array.isArray(rawPrdObj.clips) && Array.isArray(rawPrdObj.wiring)
      ? UniversalPrdSpecSchema.parse(rawPrdObj)
      : null;

  const gddArtifact = store.getArtifact<GDDArtifact | string>(projectId, 'gdd');
  const gddObj = gddArtifact && typeof gddArtifact === 'object' ? (gddArtifact as GDDArtifact) : null;

  const effectivePrdMarkdown =
    prdMarkdownOnDisk ||
    (typeof prdArtifact === 'string' ? prdArtifact : null) ||
    gddObj?.markdown ||
    (typeof gddArtifact === 'string' ? gddArtifact : null);

  if (!inMemoryPrd && !effectivePrdMarkdown) {
    throw new Error(`[BuildTextGameStep] 项目 [${projectId}] 缺少 Stage 1 Step 4 交付产物 prd.md，无法生成文游`);
  }

  const prd: UniversalPrdSpec = inMemoryPrd || parseUniversalPrdFromMarkdown(effectivePrdMarkdown!);
  const storyMarkdown = storyMarkdownOnDisk || gddObj?.storyMarkdown || '';
  if (!storyMarkdown.trim()) {
    throw new Error(`[BuildTextGameStep] 项目 [${projectId}] 缺少 Stage 1 Step 4 交付产物 story.md，无法生成文游`);
  }

  const project = store.getProject(projectId);
  const title = prd.gameTitle || project?.meta?.title || gddObj?.title || '互动短剧';
  return { prd, storyMarkdown, title };
}

export interface LookdevPhaseOutput {
  projectId: string;
  entities: GlobalEntities;
}

/** A1 产物的登记名：确认门禁与中断恢复都靠它判断「A1 是否已跑过」 */
export const LOOKDEV_DRAFT_ARTIFACT = 'lookdev_draft';

/**
 * A1 一个工序跑完：提取角色 / 道具定妆描述 + 绘制定妆母本图。
 * 产完立即返回，由阶段驱动挂起等待创作者确认（lookdev_approval）。
 */
export async function executeLookdevPhase(
  input: BuildTextGameStepInput
): Promise<LookdevPhaseOutput> {
  const { projectId, taskId = 'task_lookdev' } = input;
  const report = createProgressReporter(projectId, taskId);
  const { prd, storyMarkdown, title } = loadPlannerDeliverables(projectId);

  report(10, '正在提取角色 / 道具 / 场景母本说明并绘制母本图 (lookdev-extract → lookdev-render)...');

  const result = await runLookdevWorkflow(
    { projectId, title, prd, storyMarkdown, concurrency: 4, force: false },
    { onProgress: report }
  );
  const { entities } = result;

  ProjectStore.getInstance().setArtifact(projectId, LOOKDEV_DRAFT_ARTIFACT, {
    entities,
    renderedCount: result.renderedCount,
    reusedCount: result.reusedCount,
    failedCount: result.failedCount,
    updatedAt: new Date().toISOString(),
  });

  report(
    100,
    `定妆母本图已就绪：${entities.characters.length} 个角色 / ${entities.items.length} 件道具（新绘 ${result.renderedCount}、复用 ${result.reusedCount}、失败 ${result.failedCount}），等待创作者确认`
  );

  return { projectId, entities };
}

/**
 * 步骤二核心业务扩写装配逻辑 (原生驱动 runTextGameWorkflow，严格仅消费 Step 4 交付物)
 */
export async function executeBuildTextGameStep(
  input: BuildTextGameStepInput
): Promise<BuildTextGameStepOutput> {
  const { projectId, taskId = 'task_build_text_game' } = input;
  const store = ProjectStore.getInstance();
  const report = createProgressReporter(projectId, taskId);

  // 1. 单一事实来源：严格读取 Stage 1 Step 4 交付文件 prd.md 与 story.md（同进程允许直读内存对象）
  const { prd, storyMarkdown, title } = loadPlannerDeliverables(projectId);

  report(8, '正在启动阶段二互动文游装配流水线 (lookdev)...');

  // 2. 原生调度阶段二微内核流水线（严格仅传 Step 4 PRD 与 story.md，由 run.watch 实时上报 6 步进度）
  const pipelineOutput = await runTextGameWorkflow(
    {
      projectId,
      title,
      prd,
      storyMarkdown,
      concurrency: 4,
    },
    { onProgress: report }
  );

  report(95, '正在渲染故事拓扑图谱并收口可玩交付物...');

  // 3. 投影转换为 TextGameArtifact 存入黑板（完整保留 PRD 节点 ID、initialState、尾帧图与出场实体）
  const textGame = convertScenesToTextGameArtifact(
    title,
    pipelineOutput.scenes,
    pipelineOutput.script
  );
  store.setArtifact(projectId, 'text_game', textGame);

  // 4. 生成自主绘制纯 SVG 拓扑图谱，按阶段/工序编号落到交付目录
  try {
    const svg = StoryGraphSvgRenderer.renderToSvg(textGame);
    writeArtifactFile(projectId, 'delivery', STAGE.textGame, TEXT_GAME_STEP.codegen, 'story_graph.svg', svg);
  } catch (err) {
    console.warn(`[BuildTextGameStep] SVG 故事图谱渲染跳过:`, err);
  }

  report(100, `互动文游《${textGame.title}》分幕切片装配就绪，独立座舱即刻开启试玩！`);

  return {
    projectId,
    textGame,
  };
}

/**
 * Mastra 官方原生 Step 实例
 */
export const buildTextGameStep = createStep({
  id: 'build-text-game',
  description: '扩写装配可玩互动文游 (TextGame)',
  inputSchema: buildTextGameStepInputSchema,
  outputSchema: buildTextGameStepOutputSchema,
  execute: async ({ context, runId }) => {
    return await executeBuildTextGameStep({
      projectId: context.projectId,
      taskId: context.taskId || runId,
    });
  },
});
