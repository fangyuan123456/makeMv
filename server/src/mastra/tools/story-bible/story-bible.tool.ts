/**
 * mastra/tools/story-bible/story-bible.tool.ts
 * 故事世界观圣经推演 Mastra Tool (Story Bible Tool SSOT)
 *
 * 核心特性与架构法典硬约束：
 * 1. createTool 标准微内核封装，ID: 'story-bible-generator'；
 * 2. requireApproval: true 强制开启人在回路，保障创作者裁决授权；
 * 3. 严格 Fail-Fast 门禁：空构思 (idea) 刚性拦截，绝不隐式降级；
 * 4. P1-1 DAG 完整性刚性校验：主键唯一、分支无悬空指针、终局收束；
 * 5. SSOT 双向落盘：ProjectStore 黑板、项目聚合根标题、本地物理文件与会话备忘录白板同步。
 */

import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { createTool } from '@mastra/core/tools';
import { WorkflowStage } from '../../../types/index.js';
import { ProjectStore } from '../../../project-store/ProjectStore.js';
import type { IProjectStateStore } from '../../../project-store/IProjectStateStore.js';
import { LLMRegistry } from '../../../llm/LLMRegistry.js';
import { atomicWriteJsonSync, atomicWriteStringSync } from '../../../utils/atomicFile.js';
import {
  StoryBibleInputSchema,
  StoryBibleOutputSchema,
  StorySpineSchema,
  type StorySpineOutput,
  PivotPointsSchema,
  type PivotPointsOutput,
  StoryGraphSchema,
  type StoryGraphOutput,
  CharacterProfilesListSchema,
  type CharacterProfilesListOutput,
  type StoryBibleArtifact,
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

const PROJECT_ID_REGEX = /^[a-zA-Z0-9_\-]+$/;

function exportToLocalDisk(projectId: string, artifact: StoryBibleArtifact, projectStore: IProjectStateStore): void {
  const projectDir = projectStore.getProjectDir(projectId);
  const narrativeDir = path.join(projectDir, 'narrative');
  if (!fs.existsSync(narrativeDir)) {
    fs.mkdirSync(narrativeDir, { recursive: true });
  }

  // 1. JSON 物理文件导出 (使用系统级 atomicWriteJsonSync)
  const jsonPath = path.join(narrativeDir, 'story_bible.json');
  atomicWriteJsonSync(jsonPath, artifact);

  // 2. Markdown 排版文档导出
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
* **建议时长**: ${act.targetDurationSec || 60}秒
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

  const mdPath = path.join(narrativeDir, 'story_bible.md');
  atomicWriteStringSync(mdPath, mdContent);
}

export const storyBibleTool = createTool({
  id: 'story-bible-generator',
  description: '推演网状剧情世界观、黄金三幕主干、互动抉择矩阵、DAG剧情拓扑图与全剧角色小传档案',
  inputSchema: StoryBibleInputSchema,
  outputSchema: StoryBibleOutputSchema,
  requireApproval: true, // 核心：标记需要人类创作者确认授权方可执行
  execute: async (params) => {
    try {
      // 1. 入参校验与解析
      const parsed = StoryBibleInputSchema.safeParse(params);
      if (!parsed.success) {
        return {
          success: false,
          error: `参数校验失败: ${parsed.error.issues.map((i) => `${i.path.join('.') || 'root'}: ${i.message}`).join('; ')}`,
        };
      }

      const { projectId, sessionId, userFeedback } = parsed.data;

      // 2. 校验 projectId 合法性
      if (!projectId || !PROJECT_ID_REGEX.test(projectId.trim())) {
        return {
          success: false,
          error: `非法的 projectId: [${projectId}]，仅支持字母、数字、下划线与中划线`,
        };
      }

      // 3. 读取 ProjectStore SSOT
      const projectStore = ProjectStore.getInstance();
      const project = projectStore.getProject(projectId);
      if (!project) {
        return {
          success: false,
          error: `未找到项目: [${projectId}]，请先创建项目后再推演世界观`,
        };
      }

      // 4. 源头治理：严格 Fail-Fast 校验 idea，严禁假收敛与隐式兜底伪数据
      const idea = (parsed.data.idea || project.meta?.idea || '').trim();
      if (!idea) {
        return {
          success: false,
          error: '推演故事圣经必须提供明确的故事构思 (idea)，严禁空参数假跑',
        };
      }

      const style = (parsed.data.style || project.meta?.style || '电影质感，高品质影视光影').trim();

      // 5. 自动提取白板中的刚性要求与禁忌红线
      let effectiveConstraints: string[] = [];
      if (sessionId) {
        const session = projectStore.getSession(projectId, sessionId);
        if (session?.scratchpad?.userConstraints && session.scratchpad.userConstraints.length > 0) {
          effectiveConstraints = session.scratchpad.userConstraints;
        }
      }

      const llm = LLMRegistry.get();

      // Step 1: 推演黄金三幕戏剧骨架 (Story Spine)
      const spinePrompt = buildStorySpinePrompt(idea, style, effectiveConstraints, userFeedback);
      const spine = await llm.generateObject<StorySpineOutput>(
        spinePrompt,
        StorySpineSchema,
        STORY_SPINE_SYSTEM_PROMPT,
        {
          stage: 'story_spine',
          projectId,
          temperature: 0.4,
        }
      );

      if (!spine || !Array.isArray(spine.goldenSpine) || spine.goldenSpine.length < 3) {
        return {
          success: false,
          error: '故事黄金三幕骨架推演失败，幕次数量必须 >= 3 幕',
        };
      }

      // Step 2: 推演核心分支抉择点矩阵 (Pivot Points)
      const pivotPrompt = buildPivotPointsPrompt(spine, userFeedback);
      const pivots = await llm.generateObject<PivotPointsOutput>(
        pivotPrompt,
        PivotPointsSchema,
        PIVOT_POINTS_SYSTEM_PROMPT,
        {
          stage: 'pivot_points',
          projectId,
          temperature: 0.3,
        }
      );

      if (!pivots || !Array.isArray(pivots.macroPivotPoints) || pivots.macroPivotPoints.length < 1) {
        return {
          success: false,
          error: '核心互动抉择点矩阵推演失败，宏观抉择点数量必须 >= 1',
        };
      }

      for (const p of pivots.macroPivotPoints) {
        if (!Array.isArray(p.choices) || p.choices.length < 2) {
          return {
            success: false,
            error: `抉择点 [${p.id}] 选项数量不足，必须至少包含 2 个互斥选项`,
          };
        }
      }

      // Step 3: 编译网状剧情拓扑图 (Story Graph DAG)
      const graphPrompt = buildStoryGraphPrompt(spine, pivots, userFeedback);
      const graph = await llm.generateObject<StoryGraphOutput>(
        graphPrompt,
        StoryGraphSchema,
        STORY_GRAPH_SYSTEM_PROMPT,
        {
          stage: 'story_graph',
          projectId,
          temperature: 0.3,
        }
      );

      if (!graph || !Array.isArray(graph.nodes) || graph.nodes.length < 3) {
        return {
          success: false,
          error: '网状剧情拓扑编译失败，全网节点数量必须 >= 3',
        };
      }

      if (!graph.rootNodeId || typeof graph.rootNodeId !== 'string') {
        return {
          success: false,
          error: '拓扑图根节点 rootNodeId 缺失或非法',
        };
      }

      // P1-1 主键唯一性断言
      const nodeIds = new Set<string>();
      for (const n of graph.nodes) {
        if (!n.id || typeof n.id !== 'string') {
          return { success: false, error: '拓扑节点 ID 缺失或非法' };
        }
        if (nodeIds.has(n.id)) {
          return {
            success: false,
            error: `拓扑节点 ID 重复冲突: [${n.id}]，违反全局主键唯一性契约`,
          };
        }
        nodeIds.add(n.id);
      }

      if (!nodeIds.has(graph.rootNodeId)) {
        return {
          success: false,
          error: `根节点 rootNodeId [${graph.rootNodeId}] 不存在于拓扑节点清单中`,
        };
      }

      // 悬空分支引用刚性校验
      for (const n of graph.nodes) {
        if (Array.isArray(n.choices)) {
          for (const choice of n.choices) {
            if (choice.targetNodeId && !nodeIds.has(choice.targetNodeId)) {
              return {
                success: false,
                error: `节点 [${n.id}] 的分支选项指向了不存在的悬空目标节点: [${choice.targetNodeId}]`,
              };
            }
          }
        }
      }

      // 终局节点断言
      const endingNodes = graph.nodes.filter((n) => n.isEnding);
      if (endingNodes.length === 0) {
        return {
          success: false,
          error: '网状剧情拓扑缺少终局收束，全图必须包含至少一个终局节点 (isEnding: true)',
        };
      }

      // Step 4: 推演核心角色小传档案 (Character Profiles)
      const charPrompt = buildCharacterProfilesPrompt(spine, graph, userFeedback);
      const charactersOutput = await llm.generateObject<CharacterProfilesListOutput>(
        charPrompt,
        CharacterProfilesListSchema,
        CHARACTER_PROFILES_SYSTEM_PROMPT,
        {
          stage: 'character_profiles',
          projectId,
          temperature: 0.5,
        }
      );

      const characters = charactersOutput?.characters || [];
      if (characters.length === 0) {
        return {
          success: false,
          error: '核心角色档案推演失败，未产生有效角色数据',
        };
      }

      const characterNames = characters.map((c) => c.name);

      // 整合最终世界观圣经产物
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

      // 持久化至 ProjectStore 状态黑板 (自动归档快照并注入 __meta)
      projectStore.setArtifact(projectId, WorkflowStage.NARRATIVE_DESIGN, artifact, {
        skill: 'story-bible-generator',
      });

      // 项目聚合根标题同步
      project.title = artifact.title;
      projectStore.saveProject(project);

      // 导出至本地工程 narrative/ 目录
      exportToLocalDisk(projectId, artifact, projectStore);

      // 反向同步更新会话备忘录白板 (Scratchpad Memory)
      if (sessionId) {
        const charactersSummary = characters
          .map((c) => `- ${c.name} (${c.role}): ${c.appearance}，动机: ${c.motivation}`)
          .join('\n');
        const storySpine = spine.goldenSpine
          .map((act) => `第${act.act}幕 [${act.name}]: ${act.summary}`)
          .join('\n');

        projectStore.updateScratchpad(projectId, sessionId, {
          themeAndStyle: `${artifact.theme} | ${artifact.style}`,
          logline: artifact.logline,
          charactersSummary,
          storySpine,
        });
      }

      const summary = `🎬《${artifact.title}》故事世界观圣经推演完成！包含 ${artifact.goldenSpine.length} 幕黄金戏剧骨架、${artifact.characters.length} 位核心角色小传与 ${artifact.storyGraph.nodes.length} 个网状互动剧情节点，结局总数：${artifact.storyGraph.endingsCount} 个。`;

      return {
        success: true,
        data: artifact,
        summary,
      };
    } catch (err: any) {
      return {
        success: false,
        error: err?.message || String(err),
      };
    }
  },
});
