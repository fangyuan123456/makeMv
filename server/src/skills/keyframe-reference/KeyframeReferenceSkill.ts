/**
 * skills/keyframe-reference/KeyframeReferenceSkill.ts
 * 分镜首帧参考图渲染技能包 (Keyframe Reference Skill SSOT)
 *
 * 核心机制（法典 0.2 全链路特征透传 & 3.1 零硬编码准则）：
 * 1. 彻底消灭 shots.slice(0, 10) 截断，采用全量按批次 Chunking 分块推演；
 * 2. 强制绑定 Stage 2 角色定妆视觉锚点，杜绝物种漂移与人设脱轨；
 * 3. 将大模型推演的影视提示词全量透传给 VisualMediaRenderer 真实渲染；
 * 4. 产物双向落盘：ProjectStore 状态黑板 + 本地工程 keyframes/ 物理文件。
 */

import fs from 'fs';
import path from 'path';
import { BaseSkill } from '../BaseSkill.js';
import type { SkillManifest, SkillContext } from '../types.js';
import { WorkflowStage } from '../../types/index.js';
import { ProjectStore } from '../../project-store/ProjectStore.js';
import { LLMRegistry } from '../../llm/LLMRegistry.js';
import { VisualMediaRenderer } from '../../media/VisualMediaRenderer.js';
import { asyncPool } from '../../utils/concurrency.js';
import { KEYFRAME_REFERENCE_SYSTEM_PROMPT, buildKeyframeReferencePrompt } from './prompt.js';

export interface KeyframeReferenceParams {
  userFeedback?: string;
}

export interface KeyframeItem {
  shotId: string;
  shotNumber: number;
  prompt: string;
  imageUrl: string;
  remoteImageUrl?: string; // 🌟 云端有效首帧图片原链 (24小时有效，供公网视频模型直连)
  aspectRatio: string;
  status: 'rendered' | 'ready';
}

export interface KeyframeReferenceArtifact {
  shots: KeyframeItem[];
  totalKeyframes: number;
  completedKeyframes: number;
  createdAt: string;
}

export class KeyframeReferenceSkill extends BaseSkill<KeyframeReferenceParams, KeyframeReferenceArtifact> {
  public readonly manifest: SkillManifest = {
    name: 'keyframe-reference',
    displayName: '分镜头首帧高清参考图批量渲染',
    description: '将分镜头构图转化为 16:9 高清影视参考图，作为动态视频生成的基准首帧画面',
    category: 'keyframe',
    targetStage: WorkflowStage.KEYFRAME_REFERENCE,
    parameters: {
      userFeedback: { type: 'string', description: '画面质感或打光偏好' },
    },
  };

  protected async run(
    context: SkillContext<KeyframeReferenceParams>
  ): Promise<{ data: KeyframeReferenceArtifact; summary: string }> {
    const { projectId, params, abortSignal } = context;
    const store = ProjectStore.getInstance();
    const project = store.getProject(projectId);

    await this.notifyProgress(context, 15, '正在读取导演视听分镜镜头构图与机位数据...');

    const storyboardArtifact = store.getArtifact<any>(projectId, WorkflowStage.STORYBOARD);
    const shots = storyboardArtifact?.shots || [];

    if (shots.length === 0) {
      throw new Error('缺少前序分镜数据，请先执行前置工序【视听分镜】');
    }

    const narrative = store.getArtifact<any>(projectId, WorkflowStage.NARRATIVE_DESIGN);
    const style = narrative?.style || project?.meta?.style || '电影质感，冷色调，高对比度光影';

    // 🌟 全链路特征透传（防人设/物种漂移）：强制读取 Stage 2 角色定妆视觉锚点资产
    const charArtifact = store.getArtifact<any>(projectId, WorkflowStage.CHARACTER_DESIGN);
    const charList = charArtifact?.characters || [];
    let charactersAnchorContext = '';
    if (charList.length > 0) {
      charactersAnchorContext = `【全剧核心角色定妆视觉锚点 (强制严格对齐，严禁人设与物种漂移)】：\n` +
        charList.map((c: any) => `- 【${c.name}】(${c.role}): 外貌服装【${c.appearance}】，视觉锚点提示词【${c.visualPrompt}】`).join('\n') + '\n\n';
    }

    await this.notifyProgress(context, 35, `正在为全剧 ${shots.length} 个分镜头推演影视级首帧纯中文生图提示词...`);

    const llm = LLMRegistry.get();
    const schema = {
      type: 'object',
      properties: {
        keyframes: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              shotId: { type: 'string' },
              prompt: { type: 'string' },
            },
            required: ['shotId', 'prompt'],
          },
        },
      },
      required: ['keyframes'],
    };

    // 🌟 全量分块批处理 (Chunking)，彻底消灭 slice(0, 10) 硬编码截断
    const CHUNK_SIZE = 6;
    const promptsMap = new Map<string, string>();

    for (let i = 0; i < shots.length; i += CHUNK_SIZE) {
      const chunk = shots.slice(i, i + CHUNK_SIZE);
      const chunkIndex = Math.floor(i / CHUNK_SIZE) + 1;
      const totalChunks = Math.ceil(shots.length / CHUNK_SIZE);

      await this.notifyProgress(
        context,
        35 + Math.round((i / shots.length) * 25),
        `正在推演分镜首帧提示词批次 (${chunkIndex}/${totalChunks}): 镜头 ${i + 1} ~ ${Math.min(i + CHUNK_SIZE, shots.length)}`
      );

      const prompt = buildKeyframeReferencePrompt(style, charactersAnchorContext, chunk, params.userFeedback);
      const kfResult = await llm.generateObject<{ keyframes: Array<{ shotId: string; prompt: string }> }>(
        prompt,
        schema,
        KEYFRAME_REFERENCE_SYSTEM_PROMPT,
        {
          stage: 'keyframe_prompt_spec',
          abortSignal,
          temperature: 0.3,
        }
      );

      for (const kf of kfResult.keyframes || []) {
        promptsMap.set(kf.shotId, kf.prompt);
      }
    }

    await this.notifyProgress(context, 65, `正在批量渲染生成 ${shots.length} 张物理分镜参考图...`);

    const ratio = project?.meta?.videoRatio || '16:9';

    // 🌟 3路并发控制与原子断点落盘
    const renderedShots = await asyncPool<any, KeyframeItem>(
      3,
      shots,
      async (s: any) => {
        const kfPrompt = promptsMap.get(s.shotId) || `${s.visualComposition}，${s.shotScale}，${s.cameraMovement}，电影质感，超清8K`;
        // 🌟 100% 意图透传：将推演得到的专业提示词透传给物理渲染器
        const physicalImageUrl = await VisualMediaRenderer.renderKeyframeImage(projectId, s.shotId, ratio, kfPrompt);

        return {
          shotId: s.shotId,
          shotNumber: s.shotNumber,
          prompt: kfPrompt,
          imageUrl: physicalImageUrl,
          aspectRatio: ratio,
          status: 'rendered',
        };
      },
      (completed, total, item) => {
        const percent = 65 + Math.round((completed / total) * 30);
        this.notifyProgress(context, percent, `正在并发渲染分镜首帧图 (${completed}/${total}): ${item.shotId}`);
      }
    );

    const artifact: KeyframeReferenceArtifact = {
      shots: renderedShots,
      totalKeyframes: renderedShots.length,
      completedKeyframes: renderedShots.length,
      createdAt: new Date().toISOString(),
    };

    // 写入状态黑板并推进项目阶段
    store.setArtifact(projectId, WorkflowStage.KEYFRAME_REFERENCE, artifact);
    if (project) {
      project.currentStage = WorkflowStage.VIDEO_PRODUCTION;
      store.saveProject(project);
    }

    // 本地持久化
    this.exportToLocalDisk(projectId, artifact);

    const summary = `🖼️ 全剧 ${artifact.completedKeyframes} 张分镜头高清首帧基准图渲染完成！机位画幅 (${ratio}) 已锁定，物种与人设特征已锚定，项目推进至【视频生成】阶段。`;

    return {
      data: artifact,
      summary,
    };
  }

  private exportToLocalDisk(projectId: string, artifact: KeyframeReferenceArtifact): void {
    try {
      const store = ProjectStore.getInstance();
      const projectDir = store.getProjectDir(projectId);
      const kfDir = path.join(projectDir, 'keyframes');
      if (!fs.existsSync(kfDir)) {
        fs.mkdirSync(kfDir, { recursive: true });
      }

      fs.writeFileSync(
        path.join(kfDir, 'keyframe_references.json'),
        JSON.stringify(artifact, null, 2),
        'utf-8'
      );

      let md = `# 全剧分镜头高清首帧参考图清单 (Keyframe Gallery)\n\n> **生成时间**: ${artifact.createdAt}\n> **首帧图总数**: ${artifact.completedKeyframes} 张\n\n---\n\n`;
      for (const s of artifact.shots) {
        md += `### 镜头 [${s.shotId}] #${s.shotNumber}\n`;
        md += `* **物理图片路径**: \`${s.imageUrl}\`\n`;
        md += `* **生图提示词**: \`${s.prompt}\`\n\n`;
      }

      fs.writeFileSync(path.join(kfDir, 'keyframe_gallery.md'), md, 'utf-8');
    } catch (err) {
      console.warn('[KeyframeReferenceSkill] 本地落盘警告:', err);
    }
  }
}
