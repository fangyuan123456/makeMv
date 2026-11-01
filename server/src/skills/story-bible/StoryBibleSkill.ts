/**
 * skills/story-bible/StoryBibleSkill.ts
 * 故事世界观圣经推演技能包 (Story Bible Skill SSOT)
 *
 * 核心机制：
 * 1. 继承 BaseSkill，纯数据流执行；
 * 2. 依次推演：戏剧黄金主干 ➔ 互动抉择矩阵 ➔ 网状剧情拓扑 ➔ 核心角色档案；
 * 3. 产物双向落盘：ProjectStore 状态黑板 + 本地工程 narrative/ 物理文件；
 * 4. 自动回写同步会话备忘录白板 (Scratchpad Memory)。
 */

import fs from 'fs';
import path from 'path';
import { BaseSkill } from '../BaseSkill.js';
import type { SkillManifest, SkillContext } from '../types.js';
import { WorkflowStage } from '../../types/index.js';
import { ProjectStore } from '../../project-store/ProjectStore.js';
import { SessionStore } from '../../chat/session/SessionStore.js';
import { LLMRegistry } from '../../llm/LLMRegistry.js';
import type {
  StoryBibleParams,
  StoryBibleArtifact,
} from './types.js';
import {
  StorySpineSchema,
  type StorySpineOutput,
  PivotPointsSchema,
  type PivotPointsOutput,
  StoryGraphSchema,
  type StoryGraphOutput,
  CharacterProfilesListSchema,
  type CharacterProfilesListOutput,
} from './schema.js';
import {
  STORY_SPINE_SYSTEM_PROMPT,
  buildStorySpinePrompt,
  PIVOT_POINTS_SYSTEM_PROMPT,
  buildPivotPointsPrompt,
  STORY_GRAPH_SYSTEM_PROMPT,
  buildStoryGraphPrompt,
  CHARACTER_PROFILES_SYSTEM_PROMPT,
  buildCharacterProfilesPrompt,
} from './prompt.js';

export class StoryBibleSkill extends BaseSkill<StoryBibleParams, StoryBibleArtifact> {
  public readonly manifest: SkillManifest = {
    name: 'story-bible',
    displayName: '故事世界观圣经推演',
    description: '深度推演网状剧情世界观、黄金三幕主干、互动抉择矩阵、DAG剧情拓扑图与全剧角色小传档案',
    category: 'narrative',
    targetStage: WorkflowStage.NARRATIVE_DESIGN,
    parameters: {
      idea: { type: 'string', description: '故事核心灵感或构思' },
      style: { type: 'string', description: '影调视觉风格' },
      userFeedback: { type: 'string', description: '临时补充要求' },
    },
  };

  protected async run(
    context: SkillContext<StoryBibleParams>
  ): Promise<{ data: StoryBibleArtifact; summary: string }> {
    const { projectId, sessionId, params, abortSignal, userConstraints } = context;
    const projectStore = ProjectStore.getInstance();
    const project = projectStore.getProject(projectId);

    // 确定入参（优先 params，其次 project.meta，严格执行源头 Fail-Fast 阻断）
    const idea = (params.idea || project?.meta?.idea || '').trim();
    if (!idea) {
      throw new Error('推演故事圣经必须提供明确的故事构思 (idea)，严禁空参数假跑');
    }
    const style = (params.style || project?.meta?.style || '电影质感，高品质影视光影').trim();
    const userFeedback = params.userFeedback?.trim();

    // 自动提取全局备忘录白板中的刚性禁忌与约束 (SSOT)
    let effectiveConstraints = userConstraints;
    if ((!effectiveConstraints || effectiveConstraints.length === 0) && sessionId) {
      const session = SessionStore.getInstance().getSession(projectId, sessionId);
      effectiveConstraints = session?.scratchpad?.userConstraints;
    }

    const llm = LLMRegistry.get();

    // 1. 推演黄金戏剧主干 (Story Spine) - 20%
    await this.notifyProgress(context, 10, '正在构思黄金三幕戏剧冲突与哲学立意...');
    const spinePrompt = buildStorySpinePrompt(idea, style, effectiveConstraints, userFeedback);
    const spine = await llm.generateObject<StorySpineOutput>(
      spinePrompt,
      StorySpineSchema,
      STORY_SPINE_SYSTEM_PROMPT,
      {
        stage: 'story_spine',
        abortSignal,
        temperature: 0.4,
      }
    );

    // 2. 推演互动抉择矩阵 (Pivot Points) - 45%
    await this.notifyProgress(context, 35, '正在设计全片核心道德困境与互动抉择矩阵...');
    const pivotPrompt = buildPivotPointsPrompt(spine, userFeedback);
    const pivots = await llm.generateObject<PivotPointsOutput>(
      pivotPrompt,
      PivotPointsSchema,
      PIVOT_POINTS_SYSTEM_PROMPT,
      {
        stage: 'pivot_points',
        abortSignal,
        temperature: 0.3,
      }
    );

    // 3. 编译网状剧情拓扑图 (Story Graph DAG) - 70%
    await this.notifyProgress(context, 60, '正在编译有向无环 (DAG) 网状互动剧情节点...');
    const graphPrompt = buildStoryGraphPrompt(spine, pivots, userFeedback);
    const graph = await llm.generateObject<StoryGraphOutput>(
      graphPrompt,
      StoryGraphSchema,
      STORY_GRAPH_SYSTEM_PROMPT,
      {
        stage: 'story_graph',
        abortSignal,
        temperature: 0.3,
      }
    );

    // 4. 推演核心角色小传档案 (Character Profiles) - 90%
    await this.notifyProgress(context, 80, '正在雕琢全剧核心角色心理动机与视觉外貌特写...');
    const charPrompt = buildCharacterProfilesPrompt(spine, graph, userFeedback);
    const charactersOutput = await llm.generateObject<CharacterProfilesListOutput>(
      charPrompt,
      CharacterProfilesListSchema,
      CHARACTER_PROFILES_SYSTEM_PROMPT,
      {
        stage: 'character_profiles',
        abortSignal,
        temperature: 0.5,
      }
    );

    const characters = charactersOutput.characters || [];
    const characterNames = characters.map((c) => c.name);

    // 5. 整合最终故事世界观圣经产物
    const artifact: StoryBibleArtifact = {
      title: spine.title,
      theme: spine.theme,
      style: spine.style,
      logline: spine.logline,
      sellingPoints: spine.sellingPoints,
      goldenSpine: spine.goldenSpine,
      pivotPoints: pivots,
      characters,
      characterNames,
      storyGraph: graph,
      createdAt: new Date().toISOString(),
    };

    // 6. 持久化至 ProjectStore 状态黑板与推进项目阶段
    projectStore.setArtifact(projectId, WorkflowStage.NARRATIVE_DESIGN, artifact);
    if (project) {
      project.title = artifact.title;
      project.currentStage = WorkflowStage.CHARACTER_DESIGN;
      projectStore.saveProject(project);
    }

    // 7. 导出至磁盘物理工程目录
    this.exportToLocalDisk(projectId, artifact);

    // 8. 实时同步更新会话备忘录白板 (Scratchpad Memory)
    if (sessionId) {
      const sessionStore = SessionStore.getInstance();
      const charactersSummary = characters
        .map((c) => `- ${c.name} (${c.role}): ${c.appearance}，动机: ${c.motivation}`)
        .join('\n');
      const storySpine = spine.goldenSpine
        .map((act) => `第${act.act}幕 [${act.name}]: ${act.summary}`)
        .join('\n');

      sessionStore.updateScratchpad(projectId, sessionId, {
        themeAndStyle: `${artifact.theme} | ${artifact.style}`,
        logline: artifact.logline,
        charactersSummary,
        storySpine,
      });
    }

    const summary = `🎬《${artifact.title}》故事世界观圣经已编译完成！包含 ${artifact.goldenSpine.length} 幕黄金戏剧骨架、${artifact.characters.length} 位核心角色小传与 ${artifact.storyGraph.nodes.length} 个网状互动剧情节点，结局总数：${artifact.storyGraph.endingsCount} 个。项目已推进至【角色定妆】阶段。`;

    return {
      data: artifact,
      summary,
    };
  }

  /**
   * 将产物以 Markdown 格式持久化至本地工程
   */
  private exportToLocalDisk(projectId: string, artifact: StoryBibleArtifact): void {
    try {
      const store = ProjectStore.getInstance();
      const projectDir = store.getProjectDir(projectId);
      const narrativeDir = path.join(projectDir, 'narrative');
      if (!fs.existsSync(narrativeDir)) {
        fs.mkdirSync(narrativeDir, { recursive: true });
      }

      fs.writeFileSync(
        path.join(narrativeDir, 'story_bible.json'),
        JSON.stringify(artifact, null, 2),
        'utf-8'
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
`
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
`
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
      console.warn('[StoryBibleSkill] 导出本地 Markdown 交付物警告:', err);
    }
  }
}
