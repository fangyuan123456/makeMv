/**
 * skills/scene-script/SceneScriptSkill.ts
 * 分场多分支剧本扩写技能包 (Scene Script Skill SSOT)
 */

import fs from 'fs';
import path from 'path';
import { BaseSkill } from '../BaseSkill.js';
import type { SkillManifest, SkillContext } from '../types.js';
import { WorkflowStage } from '../../types/index.js';
import { ProjectStore } from '../../project-store/ProjectStore.js';
import { LLMRegistry } from '../../llm/LLMRegistry.js';
import { SCENE_SCRIPT_SYSTEM_PROMPT, buildSceneScriptPrompt } from './prompt.js';

export interface SceneScriptParams {
  userFeedback?: string;
}

export interface DialogueLine {
  speaker: string;
  line: string;
  parenthetical?: string;
}

export interface ScriptSceneNode {
  nodeId: string;
  act: number;
  sceneTitle: string;
  location: string;
  timeOfDay: string;
  actionSummary: string;
  dialogues: DialogueLine[];
  interactionMoment?: string;
}

export interface SceneScriptArtifact {
  title: string;
  scenes: ScriptSceneNode[];
  totalScenes: number;
  createdAt: string;
}

export class SceneScriptSkill extends BaseSkill<SceneScriptParams, SceneScriptArtifact> {
  public readonly manifest: SkillManifest = {
    name: 'scene-script',
    displayName: '全剧分场多分支剧本扩写',
    description: '基于故事世界观拓扑与定妆角色，推演全剧各交互节点的戏剧冲突、场景环境、角色台词与关键抉择点',
    category: 'script',
    targetStage: WorkflowStage.SCENE_SCRIPT,
    parameters: {
      userFeedback: { type: 'string', description: '台词语气或戏剧冲突调整要求' },
    },
  };

  protected async run(
    context: SkillContext<SceneScriptParams>
  ): Promise<{ data: SceneScriptArtifact; summary: string }> {
    const { projectId, params, abortSignal } = context;
    const store = ProjectStore.getInstance();
    const project = store.getProject(projectId);

    await this.notifyProgress(context, 15, '正在读取网状剧情节点拓扑图与角色小传...');

    const narrative = store.getArtifact<any>(projectId, WorkflowStage.NARRATIVE_DESIGN);
    const nodes = narrative?.storyGraph?.nodes || [];

    if (nodes.length === 0) {
      throw new Error('缺少前序剧情节点数据，请先执行第一阶段【叙事架构】生成网状剧情图谱');
    }

    await this.notifyProgress(context, 35, `正在全量扩写 ${nodes.length} 个剧情节点的多分支剧本与对白...`);

    const llm = LLMRegistry.get();
    const title = narrative.title || project?.title || '互动影游剧本';
    const theme = narrative.theme || '未知主题';
    const characters = narrative.characters || [];

    const schema = {
      type: 'object',
      properties: {
        scenes: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              nodeId: { type: 'string' },
              act: { type: 'number' },
              sceneTitle: { type: 'string' },
              location: { type: 'string' },
              timeOfDay: { type: 'string' },
              actionSummary: { type: 'string' },
              dialogues: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    speaker: { type: 'string' },
                    line: { type: 'string' },
                    parenthetical: { type: 'string' },
                  },
                  required: ['speaker', 'line'],
                },
              },
              interactionMoment: { type: 'string' },
            },
            required: ['nodeId', 'sceneTitle', 'location', 'timeOfDay', 'actionSummary', 'dialogues'],
          },
        },
      },
      required: ['scenes'],
    };

    // 🌟 全量分块批处理 (Chunking)，每批次最多 5 个节点，彻底避免单次大文本超限或截断
    const CHUNK_SIZE = 5;
    const allScenes: ScriptSceneNode[] = [];

    for (let i = 0; i < nodes.length; i += CHUNK_SIZE) {
      const chunk = nodes.slice(i, i + CHUNK_SIZE);
      const chunkIndex = Math.floor(i / CHUNK_SIZE) + 1;
      const totalChunks = Math.ceil(nodes.length / CHUNK_SIZE);

      await this.notifyProgress(
        context,
        35 + Math.round((i / nodes.length) * 45),
        `正在推演分场剧本批次 (${chunkIndex}/${totalChunks}): 节点 ${i + 1} ~ ${Math.min(i + CHUNK_SIZE, nodes.length)}`
      );

      const prompt = buildSceneScriptPrompt(title, theme, characters, chunk, params.userFeedback);
      const result = await llm.generateObject<{ scenes: ScriptSceneNode[] }>(
        prompt,
        schema,
        SCENE_SCRIPT_SYSTEM_PROMPT,
        {
          stage: 'scene_script',
          abortSignal,
          temperature: 0.6,
        }
      );

      if (result.scenes && result.scenes.length > 0) {
        allScenes.push(...result.scenes);
      }
    }

    const artifact: SceneScriptArtifact = {
      title,
      scenes: allScenes,
      totalScenes: allScenes.length,
      createdAt: new Date().toISOString(),
    };

    // 写入状态黑板并推进项目阶段
    store.setArtifact(projectId, WorkflowStage.SCENE_SCRIPT, artifact);
    if (project) {
      project.currentStage = WorkflowStage.STORYBOARD;
      store.saveProject(project);
    }

    // 本地持久化
    this.exportToLocalDisk(projectId, artifact);

    const summary = `📝 全剧 ${artifact.totalScenes} 场戏剧本正文与角色对白全量扩写完成！各交互分支与戏剧张力已就绪，项目已推进至【视听分镜】工序。`;

    return {
      data: artifact,
      summary,
    };
  }

  private exportToLocalDisk(projectId: string, artifact: SceneScriptArtifact): void {
    try {
      const store = ProjectStore.getInstance();
      const projectDir = store.getProjectDir(projectId);
      const scriptDir = path.join(projectDir, 'script');
      if (!fs.existsSync(scriptDir)) {
        fs.mkdirSync(scriptDir, { recursive: true });
      }

      fs.writeFileSync(
        path.join(scriptDir, 'scene_scripts.json'),
        JSON.stringify(artifact, null, 2),
        'utf-8'
      );

      let md = `# 《${artifact.title}》全剧分场多分支剧本集\n\n> **生成时间**: ${artifact.createdAt}\n> **全剧总场次**: ${artifact.totalScenes} 场\n\n---\n\n`;
      for (const s of artifact.scenes) {
        md += `## 第 ${s.act || 1} 幕 · 场次 [${s.nodeId}]: ${s.sceneTitle}\n`;
        md += `* **时空地点**: ${s.location} · ${s.timeOfDay}\n`;
        md += `* **情境动作**: ${s.actionSummary}\n`;
        if (s.interactionMoment) {
          md += `* **互动时刻**: ⚠️ ${s.interactionMoment}\n`;
        }
        md += `\n### 对白文本\n`;
        for (const d of s.dialogues || []) {
          md += `> **${d.speaker}**${d.parenthetical ? ` *(${d.parenthetical})*` : ''}：${d.line}\n>\n`;
        }
        md += `\n---\n\n`;
      }

      fs.writeFileSync(path.join(scriptDir, 'scene_scripts.md'), md, 'utf-8');
    } catch (err) {
      console.warn('[SceneScriptSkill] 本地落盘警告:', err);
    }
  }
}
