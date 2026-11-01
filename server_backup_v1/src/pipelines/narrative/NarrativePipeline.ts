/**
 * pipelines/narrative/NarrativePipeline.ts
 * 互动影游核心叙事设计总流水线 (Narrative Pipeline SSOT)
 *
 * 核心机制：
 * 1. 继承 StagePipeline，原生持有 projectId；
 * 2. 声明式串联 4 大微观工序 (story-spine ➔ pivot-points ➔ story-graph ➔ character-profiles)；
 * 3. 产物双向落盘：持久化至 ProjectStore 状态黑板与本地工程 narrative/ 物理目录。
 */

import fs from 'fs';
import path from 'path';
import { StagePipeline } from '../../agent-runtime/index.js';
import { ProjectStore } from '../../project-store/index.js';
import { WorkflowStage } from '../../types/index.js';
import { StorySpineStep } from './steps/story-spine/StorySpineStep.js';
import { PivotPointsStep } from './steps/pivot-points/PivotPointsStep.js';
import { StoryGraphStep } from './steps/story-graph/StoryGraphStep.js';
import { CharacterProfilesStep } from './steps/character-profiles/CharacterProfilesStep.js';
import type {
  NarrativeInput,
  NarrativeArtifact,
  StoryBible,
} from './types.js';

export interface PipelineResult<T = any> {
  success: boolean;
  data: T;
  summary: string;
  durationMs?: number;
}

export class NarrativePipeline extends StagePipeline {
  private readonly spineStep = new StorySpineStep();
  private readonly pivotPointsStep = new PivotPointsStep();
  private readonly storyGraphStep = new StoryGraphStep();
  private readonly characterProfilesStep = new CharacterProfilesStep();

  constructor(projectId?: string) {
    super('NarrativeDesignPipeline', projectId);
    this.addContextStep('StorySpineStep', 'spine', async (ctx) => {
      return this.spineStep.execute({
        idea: ctx.idea,
        style: ctx.style,
        userFeedback: ctx.userFeedback,
        abortSignal: ctx.abortSignal,
      });
    });
    this.addContextStep('PivotPointsStep', 'pivotPoints', async (ctx) => {
      return this.pivotPointsStep.execute({
        spine: ctx.spine,
        userFeedback: ctx.userFeedback,
        abortSignal: ctx.abortSignal,
      });
    });
    this.addContextStep('StoryGraphStep', 'storyGraph', async (ctx) => {
      return this.storyGraphStep.execute({
        spine: ctx.spine,
        pivots: ctx.pivotPoints,
        userFeedback: ctx.userFeedback,
        abortSignal: ctx.abortSignal,
      });
    });
    this.addContextStep('CharacterProfilesStep', 'characters', async (ctx) => {
      return this.characterProfilesStep.execute({
        spine: ctx.spine,
        graph: ctx.storyGraph,
        userFeedback: ctx.userFeedback,
        abortSignal: ctx.abortSignal,
      });
    });
  }

  public async execute(input: NarrativeInput): Promise<PipelineResult<NarrativeArtifact>> {
    const startMs = Date.now();
    const activeProjectId = input.projectId || this.projectId;
    if (!activeProjectId) {
      throw new Error('[NarrativePipeline] 执行缺少必须的 projectId');
    }
    this.setProjectId(activeProjectId);

    const ctx = await this.run({
      ...input,
      projectId: activeProjectId,
    });

    const spine = ctx.spine;
    const pivotPoints = ctx.pivotPoints;
    const storyGraph = ctx.storyGraph;
    const characters = ctx.characters;
    const characterNames = characters.map((c: any) => c.name);

    const bible: StoryBible = {
      title: spine.title,
      theme: spine.theme,
      style: spine.style,
      logline: spine.logline,
      sellingPoints: spine.sellingPoints,
      goldenSpine: spine.goldenSpine,
      characters,
      storyGraph,
    };

    const artifact: NarrativeArtifact = {
      title: spine.title,
      theme: spine.theme,
      style: spine.style,
      logline: spine.logline,
      sellingPoints: spine.sellingPoints,
      goldenSpine: spine.goldenSpine,
      pivotPoints,
      characters,
      characterNames,
      storyGraph,
      bible,
      createdAt: new Date().toISOString(),
    };

    const store = ProjectStore.getInstance();
    store.setArtifact(activeProjectId, WorkflowStage.NARRATIVE_DESIGN, artifact);

    this.exportToLocalDisk(activeProjectId, artifact);

    return {
      success: true,
      data: artifact,
      summary: `故事圣经与互动网状拓扑图编译就绪：《${artifact.title}》包含 ${artifact.characters.length} 位核心角色与 ${artifact.storyGraph.nodes.length} 个剧情节点`,
      durationMs: Date.now() - startMs,
    };
  }

  private exportToLocalDisk(projectId: string, artifact: NarrativeArtifact): void {
    try {
      const store = ProjectStore.getInstance();
      const projectDir = store.getProjectDir(projectId);
      const narrativeDir = path.join(projectDir, 'narrative');
      if (!fs.existsSync(narrativeDir)) {
        fs.mkdirSync(narrativeDir, { recursive: true });
      }

      fs.writeFileSync(
        path.join(narrativeDir, 'narrative_artifact.json'),
        JSON.stringify(artifact, null, 2),
        'utf-8',
      );

      const mdContent = `# 《${artifact.title}》故事世界观圣经 (Story Bible)

> **视觉影调风格**: ${artifact.style}  
> **核心哲学立意**: ${artifact.theme}  
> **生成时间**: ${artifact.createdAt}

---

## 一句话大纲 (Logline)
${artifact.logline}

---

## 核心商业看点与卖点 (Selling Points)
${artifact.sellingPoints.map((s) => `- ${s}`).join('\n')}

---

## 黄金戏剧骨架 (Three-Act Spine)
${artifact.goldenSpine
  .map(
    (act) => `### 第 ${act.act} 幕：${act.name}
${act.summary}
* **悬念断点**: ${act.cliffhanger || '无'}
`,
  )
  .join('\n')}

---

## 核心角色小传档案 (Character Dossiers)
${artifact.characters
  .map(
    (c) => `### ${c.name} (${c.role})
* **性别/年龄**: ${c.gender || '未知'} / ${c.age || '未知'}
* **外貌特写**: ${c.appearance}
* **性格特征**: ${c.personality}
* **核心动机**: ${c.motivation}
* **人物弧光**: ${c.arc || '暂无'}
`,
  )
  .join('\n')}

---

## 互动网状拓扑图概览 (Interactive Story Graph)
* **根节点**: \`${artifact.storyGraph.rootNodeId}\`
* **结局总数**: ${artifact.storyGraph.endingsCount}
* **剧情节点数**: ${artifact.storyGraph.nodes.length}
`;

      fs.writeFileSync(path.join(narrativeDir, 'story_bible.md'), mdContent, 'utf-8');
    } catch (err) {
      console.warn('[NarrativePipeline] 导出本地 Markdown 交付物警告:', err);
    }
  }
}
