/**
 * skills/storyboard/StoryboardSkill.ts
 * 视听分镜头切分技能包 (Storyboard Skill SSOT)
 *
 * 核心机制（法典 3.1 彻底的系统级通用性与零硬编码准则）：
 * 1. 彻底消灭 scenes.slice(0, 8) 截断，采用全量按批次 Chunking 分块推演；
 * 2. 独立纯中文 prompt.ts 模板体系驱动，规约景别、机位、运镜与构图；
 * 3. 产物双向落盘：ProjectStore 状态黑板 + 本地工程 storyboard/ 物理文件。
 */

import fs from 'fs';
import path from 'path';
import { BaseSkill } from '../BaseSkill.js';
import type { SkillManifest, SkillContext } from '../types.js';
import { WorkflowStage } from '../../types/index.js';
import { ProjectStore } from '../../project-store/ProjectStore.js';
import { LLMRegistry } from '../../llm/LLMRegistry.js';
import { STORYBOARD_SYSTEM_PROMPT, buildStoryboardPrompt } from './prompt.js';

export interface StoryboardParams {
  userFeedback?: string;
}

export interface StoryboardShotItem {
  shotId: string;
  nodeId: string; // 🌟 唯一法定剧情节点标识 (SSOT，如 node_1, node_2)
  shotNumber: number;
  shotScale: '特写' | '近景' | '中景' | '全景' | '大远景' | string;
  cameraMovement: string;
  durationSec: number;
  visualComposition: string;
  audioPrompt?: string;
}

export interface StoryboardArtifact {
  title: string;
  shots: StoryboardShotItem[];
  totalShots: number;
  estimatedTotalDurationSec: number;
  createdAt: string;
}

export class StoryboardSkill extends BaseSkill<StoryboardParams, StoryboardArtifact> {
  public readonly manifest: SkillManifest = {
    name: 'storyboard',
    displayName: '导演视听分镜头表切分',
    description: '将分场剧本逐场拆解为包含景别、机位运动、建议时长与画面构图细节的工业级分镜头表',
    category: 'storyboard',
    targetStage: WorkflowStage.STORYBOARD,
    parameters: {
      userFeedback: { type: 'string', description: '景别偏好或节奏调整要求' },
    },
  };

  protected async run(
    context: SkillContext<StoryboardParams>
  ): Promise<{ data: StoryboardArtifact; summary: string }> {
    const { projectId, params, abortSignal } = context;
    const store = ProjectStore.getInstance();
    const project = store.getProject(projectId);

    await this.notifyProgress(context, 15, '正在读取分场剧本台词与场景情境...');

    const scriptArtifact = store.getArtifact<any>(projectId, WorkflowStage.SCENE_SCRIPT);
    const scenes = scriptArtifact?.scenes || [];

    if (scenes.length === 0) {
      throw new Error('缺少前序分场剧本数据，请先执行前置工序【分场剧本】');
    }

    await this.notifyProgress(context, 35, `正在为全剧 ${scenes.length} 场戏剧本全量规划专业视听机位分镜切分...`);

    const llm = LLMRegistry.get();
    const schema = {
      type: 'object',
      properties: {
        shots: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              shotId: { type: 'string' },
              nodeId: { type: 'string', description: '所属网状剧情节点 ID (如 node_1, node_2)' },
              shotNumber: { type: 'number' },
              shotScale: { type: 'string', enum: ['特写', '近景', '中景', '全景', '大远景'] },
              cameraMovement: { type: 'string' },
              durationSec: { type: 'number' },
              visualComposition: { type: 'string' },
              audioPrompt: { type: 'string' },
            },
            required: ['shotId', 'nodeId', 'shotNumber', 'shotScale', 'cameraMovement', 'durationSec', 'visualComposition'],
          },
        },
      },
      required: ['shots'],
    };

    // 🌟 全量分块批处理 (Chunking)，彻底消灭 slice(0, 8) 截断丢戏问题
    const CHUNK_SIZE = 5;
    const allShots: StoryboardShotItem[] = [];

    for (let i = 0; i < scenes.length; i += CHUNK_SIZE) {
      const chunk = scenes.slice(i, i + CHUNK_SIZE);
      const chunkIndex = Math.floor(i / CHUNK_SIZE) + 1;
      const totalChunks = Math.ceil(scenes.length / CHUNK_SIZE);

      await this.notifyProgress(
        context,
        35 + Math.round((i / scenes.length) * 45),
        `正在切分视听分镜批次 (${chunkIndex}/${totalChunks}): 场次 ${i + 1} ~ ${Math.min(i + CHUNK_SIZE, scenes.length)}`
      );

      const prompt = buildStoryboardPrompt(scriptArtifact.title || '互动影游', chunk, params.userFeedback);
      const result = await llm.generateObject<{ shots: StoryboardShotItem[] }>(
        prompt,
        schema,
        STORYBOARD_SYSTEM_PROMPT,
        {
          stage: 'storyboard_segmentation',
          abortSignal,
          temperature: 0.4,
        }
      );

      if (result.shots && result.shots.length > 0) {
        allShots.push(...result.shots);
      }
    }

    // 确保镜头全局编号全局连续自增
    const finalShots = allShots.map((s, idx) => ({
      ...s,
      shotId: s.shotId || `shot_${idx + 1}`,
      shotNumber: idx + 1,
      durationSec: s.durationSec || 4,
    }));

    const totalDuration = finalShots.reduce((acc, s) => acc + s.durationSec, 0);

    const artifact: StoryboardArtifact = {
      title: scriptArtifact.title || '互动影游分镜表',
      shots: finalShots,
      totalShots: finalShots.length,
      estimatedTotalDurationSec: totalDuration,
      createdAt: new Date().toISOString(),
    };

    // 写入状态黑板并推进项目阶段
    store.setArtifact(projectId, WorkflowStage.STORYBOARD, artifact);
    if (project) {
      project.currentStage = WorkflowStage.KEYFRAME_REFERENCE;
      store.saveProject(project);
    }

    // 本地持久化
    this.exportToLocalDisk(projectId, artifact);

    const summary = `📐 导演视听分镜表全量切分完成！全剧已拆解出 ${artifact.totalShots} 个电影镜头，预估总时长 ${artifact.estimatedTotalDurationSec} 秒，机位运动与构图已锁定，项目推进至【关键帧图】阶段。`;

    return {
      data: artifact,
      summary,
    };
  }

  private exportToLocalDisk(projectId: string, artifact: StoryboardArtifact): void {
    try {
      const store = ProjectStore.getInstance();
      const projectDir = store.getProjectDir(projectId);
      const sbDir = path.join(projectDir, 'storyboard');
      if (!fs.existsSync(sbDir)) {
        fs.mkdirSync(sbDir, { recursive: true });
      }

      fs.writeFileSync(
        path.join(sbDir, 'storyboard.json'),
        JSON.stringify(artifact, null, 2),
        'utf-8'
      );

      let md = `# 《${artifact.title}》导演视听分镜表\n\n> **镜头总数**: ${artifact.totalShots} 镜  \n> **预估成片时长**: ${artifact.estimatedTotalDurationSec} 秒\n\n---\n\n`;
      for (const s of artifact.shots) {
        md += `### 镜头 [${s.shotId}] #${s.shotNumber} (剧情节点: ${s.nodeId})\n`;
        md += `* **景别/运镜**: ${s.shotScale} · ${s.cameraMovement} · 时长: ${s.durationSec}s\n`;
        md += `* **画面构图细节**: ${s.visualComposition}\n`;
        if (s.audioPrompt) md += `* **环境声音设计**: ${s.audioPrompt}\n`;
        md += `\n`;
      }

      fs.writeFileSync(path.join(sbDir, 'storyboard.md'), md, 'utf-8');
    } catch (err) {
      console.warn('[StoryboardSkill] 本地落盘警告:', err);
    }
  }
}
