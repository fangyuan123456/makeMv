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
import {
  KeyframeBatchOutputSchema,
  type KeyframeItem,
  type KeyframeReferenceArtifact,
  type KeyframeBatchOutput,
} from './schema.js';

export interface KeyframeReferenceParams {
  userFeedback?: string;
  targetShotId?: string;
  isRefinement?: boolean;
  isMock?: boolean;
}

export { type KeyframeItem, type KeyframeReferenceArtifact } from './schema.js';

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

    // 🌟 单镜靶向过滤 (Targeted Refinement SSOT)：若指定了 targetShotId，仅推演与渲染该镜头
    const targetShotId = params.targetShotId;
    const shotsToProcess = targetShotId
      ? shots.filter((s: any) => s.shotId === targetShotId)
      : shots;

    if (shotsToProcess.length === 0) {
      throw new Error(`未在既有分镜表中找到指定修改的目标镜头 [${targetShotId}]`);
    }

    await this.notifyProgress(
      context,
      35,
      targetShotId
        ? `正在为指定镜头 [${targetShotId}] 靶向推演首帧纯中文生图提示词...`
        : `正在为全剧 ${shots.length} 个分镜头推演影视级首帧纯中文生图提示词...`
    );

    const llm = LLMRegistry.get();
    // 🌟 全量分块批处理 (Chunking)，彻底消灭 slice(0, 10) 硬编码截断
    const CHUNK_SIZE = 6;
    const promptsMap = new Map<string, string>();

    for (let i = 0; i < shotsToProcess.length; i += CHUNK_SIZE) {
      const chunk = shotsToProcess.slice(i, i + CHUNK_SIZE);
      const chunkIndex = Math.floor(i / CHUNK_SIZE) + 1;
      const totalChunks = Math.ceil(shotsToProcess.length / CHUNK_SIZE);

      await this.notifyProgress(
        context,
        35 + Math.round((i / shotsToProcess.length) * 25),
        `正在推演分镜首帧提示词批次 (${chunkIndex}/${totalChunks}): 镜头 ${i + 1} ~ ${Math.min(i + CHUNK_SIZE, shotsToProcess.length)}`
      );

      const prompt = buildKeyframeReferencePrompt(style, charactersAnchorContext, chunk, params.userFeedback);
      const kfResult = await llm.generateObject<KeyframeBatchOutput>(
        prompt,
        KeyframeBatchOutputSchema,
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

    await this.notifyProgress(
      context,
      65,
      targetShotId
        ? `正在靶向渲染指定镜头 [${targetShotId}] 物理首帧图...`
        : `正在批量渲染生成 ${shotsToProcess.length} 张物理分镜参考图...`
    );

    const ratio = project?.meta?.videoRatio || '16:9';

    // 🌟 3路并发控制与原子断点落盘 (仅渲染待处理镜头 shotsToProcess)
    const newlyRenderedShots = await asyncPool<any, KeyframeItem>(
      3,
      shotsToProcess,
      async (s: any) => {
        const kfPrompt = promptsMap.get(s.shotId) || `${s.visualComposition}，${s.shotScale}，${s.cameraMovement}，电影质感，超清8K`;
        // 🌟 100% 意图透传：将推演得到的专业提示词透传给物理渲染器，并携带 isMock 防扣费标记
        const physicalImageUrl = await VisualMediaRenderer.renderKeyframeImage(
          projectId,
          s.shotId,
          ratio,
          kfPrompt,
          { isMock: params.isMock }
        );

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

    // 🌟 靶向单镜重做与增量合并 (按 shotId 替换，绝不破坏既有资产)
    const existingArtifact = store.getArtifact<KeyframeReferenceArtifact>(projectId, WorkflowStage.KEYFRAME_REFERENCE);
    let mergedShots: KeyframeItem[] = [];

    if (targetShotId && existingArtifact && Array.isArray(existingArtifact.shots)) {
      const updateMap = new Map(newlyRenderedShots.map((s) => [s.shotId, s]));
      mergedShots = existingArtifact.shots.map((oldShot) => updateMap.get(oldShot.shotId) || oldShot);
      for (const freshShot of newlyRenderedShots) {
        if (!mergedShots.some((s) => s.shotId === freshShot.shotId)) {
          mergedShots.push(freshShot);
        }
      }
    } else {
      mergedShots = newlyRenderedShots;
    }

    const artifact: KeyframeReferenceArtifact = {
      shots: mergedShots,
      totalKeyframes: mergedShots.length,
      completedKeyframes: mergedShots.filter((s) => s.imageUrl).length,
      isRefinement: Boolean(targetShotId || params.isRefinement),
      targetShotId,
      createdAt: existingArtifact?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    // 写入状态黑板 (SSOT)
    store.setArtifact(projectId, WorkflowStage.KEYFRAME_REFERENCE, artifact);

    if (project) {
      store.saveProject(project);
    }

    // 本地持久化
    this.exportToLocalDisk(projectId, artifact);

    const summary = targetShotId
      ? `🎯 镜头 [${targetShotId}] 高清首帧基准图靶向微调完成！既有全片分镜资产已增量合并保全。`
      : `🖼️ 全剧 ${artifact.completedKeyframes} 张分镜头高清首帧基准图渲染完成！机位画幅 (${ratio}) 已锁定，物种与人设特征已锚定。`;

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
