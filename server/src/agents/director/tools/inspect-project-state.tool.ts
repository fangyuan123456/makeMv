/**
 * mastra/tools/director/inspect-project-state.tool.ts
 * AI 总导演项目状态与资产按需查阅工具 (Inspect Project State Tool SSOT)
 * 
 * 核心特性：
 * 1. 按需精确查阅项目全景白板、已落盘视听资产与审查官门禁，消灭上下文盲区；
 * 2. 增加 projectId 自动自愈容错，遭遇异常返回受控结构，不击穿 SSE 管道。
 */

import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { ProjectStore } from '../../../project-store/ProjectStore.js';
import { ContextAssembler } from '../context-assembler.js';
import { WorkflowStage } from '../../../types/index.js';

export const InspectProjectStateInputSchema = z.object({
  projectId: z.string().optional().describe('项目唯一标识 ID (若未传自动从当前活跃项目补齐)'),
  scope: z.enum([
    'overview',
    'whiteboard',
    'narrative',
    'characters',
    'scenes',
    'storyboards',
    'gate_status',
  ]).default('overview').describe('需要查阅的项目状态维度范围'),
});

export const InspectProjectStateOutputSchema = z.object({
  success: z.boolean(),
  projectId: z.string(),
  currentStage: z.string(),
  scope: z.string(),
  content: z.string(),
  error: z.string().optional(),
  rawArtifact: z.any().optional(),
});

export const inspectProjectStateTool = createTool({
  id: 'inspect-project-state',
  description: '按需查阅指定项目的当前生命周期阶段、已就绪的视听资产详情、创作白板事实或审查官门禁报告。',
  inputSchema: InspectProjectStateInputSchema,
  outputSchema: InspectProjectStateOutputSchema,
  execute: async (params: any) => {
    try {
      const raw = (params && typeof params === 'object' && 'context' in params && params.context) ? params.context : params;
      const store = ProjectStore.getInstance();

      let effectiveProjectId = raw?.projectId;
      if (!effectiveProjectId) {
        const activeProjects = store.listProjects();
        if (activeProjects.length > 0) {
          effectiveProjectId = activeProjects[0].projectId;
        } else {
          return {
            success: false,
            projectId: '',
            currentStage: 'unknown',
            scope: raw?.scope || 'overview',
            content: '查阅失败：系统中暂无已初始化的项目',
            error: 'No active project found',
          };
        }
      }

      const parsed = InspectProjectStateInputSchema.safeParse({
        ...raw,
        projectId: effectiveProjectId,
      });

      if (!parsed.success) {
        return {
          success: false,
          projectId: effectiveProjectId,
          currentStage: 'unknown',
          scope: raw?.scope || 'overview',
          content: `查阅参数错误: ${parsed.error.message}`,
          error: parsed.error.message,
        };
      }

      const { projectId, scope } = parsed.data;
      const project = store.getProject(projectId!);

      if (!project) {
        return {
          success: false,
          projectId: projectId!,
          currentStage: 'unknown',
          scope,
          content: `未检索到项目 [${projectId}] 的数据记录`,
          error: 'Project not found',
        };
      }

      const currentStage = project.currentStage;
      let content = '';
      let rawArtifact: any = undefined;

      switch (scope) {
        case 'overview': {
          const assembled = ContextAssembler.getInstance().assemble(projectId!);
          content = [
            `【项目全景概览】: ${assembled.projectName} (ID: ${projectId})`,
            `- 当前阶段: ${assembled.currentStage}`,
            `- 创意核心: ${assembled.creativeIdea || '未填写'}`,
            `- 视觉影调: ${assembled.style || '未设定'}`,
            `\n【资产就绪态势】:\n${assembled.assetsSummary}`,
            `\n【质检门禁态势】:\n${assembled.criticGatesSummary}`,
          ].join('\n');
          break;
        }

        case 'whiteboard': {
          const whiteboard = (project.meta?.whiteboard as Record<string, any>) || {};
          const userConstraints = project.meta?.userConstraints || [];
          content = [
            `【创作白板与创作者偏好】:`,
            `- 初始创意/灵感: ${project.meta?.idea || '未设定'}`,
            `- 视觉风格: ${project.meta?.style || whiteboard.visual_tone || '未设定'}`,
            `- 核心主角: ${whiteboard.protagonist || '未设定'}`,
            `- 故事前提/核心设定: ${whiteboard.premise || '未设定'}`,
            `- 创作者禁忌/硬约束: ${userConstraints.join('；') || whiteboard.taboos || '无'}`,
            `- 题材基调: ${whiteboard.genre_tone || '未设定'}`,
            `- 叙事主线: ${whiteboard.narrative_threads || '未设定'}`,
            `- 目标受众: ${whiteboard.target_audience || '未设定'}`,
            `- 交互母带形态: ${whiteboard.interactive_form || '未设定'}`,
          ].join('\n');
          rawArtifact = whiteboard;
          break;
        }

        case 'narrative': {
          const narrative = store.getArtifact<any>(projectId!, WorkflowStage.NARRATIVE_DESIGN);
          if (!narrative) {
            content = '叙事架构 (Story Bible) 尚未生成。';
          } else {
            rawArtifact = narrative;
            const endings = narrative.storyGraph?.endingsCount ?? '未知';
            const spineStr = Array.isArray(narrative.goldenSpine)
              ? narrative.goldenSpine.map((a: any) => typeof a === 'string' ? a : `幕${a.act || ''} [${a.name || ''}]: ${a.summary || ''}`).join('；')
              : (narrative.goldenSpine || '无');
            content = [
              `【故事大纲与叙事架构】:`,
              `- 片名: ${narrative.title || project.title}`,
              `- 一句话大纲 (Logline): ${narrative.logline || '无'}`,
              `- 黄金戏剧骨架: ${spineStr}`,
              `- 叙事拓扑: 根节点 ${narrative.storyGraph?.rootNodeId || '未知'}，共 ${endings} 个结局收敛点`,
              `- 登场角色: ${(narrative.characters || []).map((c: any) => `${c.name}(${c.role || '配角'})`).join('、') || '暂无'}`,
            ].join('\n');
          }
          break;
        }

        case 'characters': {
          const portraits = store.getArtifact<any>(projectId!, WorkflowStage.CHARACTER_DESIGN);
          if (!portraits || !Array.isArray(portraits.characters) || portraits.characters.length === 0) {
            content = '角色视觉定妆尚未生成。';
          } else {
            rawArtifact = portraits;
            const items = portraits.characters.map((c: any, idx: number) => {
              const status = c.imageUrl ? `已定妆 (${c.imageUrl})` : '待渲染';
              return `  ${idx + 1}. 【${c.name}】状态: ${status}\n     外貌特征/视觉Prompt: ${c.visualPrompt || c.appearance || '无'}`;
            });
            content = `【角色视觉定妆资产库 (共 ${portraits.characters.length} 人)】:\n${items.join('\n')}`;
          }
          break;
        }

        case 'scenes': {
          const script = store.getArtifact<any>(projectId!, WorkflowStage.SCENE_SCRIPT);
          if (!script || !Array.isArray(script.scenes) || script.scenes.length === 0) {
            content = '分场文学剧本尚未生成。';
          } else {
            rawArtifact = script;
            const items = script.scenes.map((sc: any, idx: number) => {
              const id = sc.sceneId || `scene_${idx + 1}`;
              return `  ${idx + 1}. [${id}] 【${sc.location || '内景'}】 氛围: ${sc.atmosphere || '正常'}\n     剧情摘要: ${sc.summary || sc.content || '无'}`;
            });
            content = `【分场文学剧本 (共 ${script.scenes.length} 场戏)】:\n${items.join('\n')}`;
          }
          break;
        }

        case 'storyboards': {
          const storyboard = store.getArtifact<any>(projectId!, WorkflowStage.STORYBOARD);
          if (!storyboard || !Array.isArray(storyboard.shots) || storyboard.shots.length === 0) {
            content = '分镜头台本尚未生成。';
          } else {
            rawArtifact = storyboard;
            const items = storyboard.shots.slice(0, 15).map((sh: any, idx: number) => {
              const id = sh.shotId || `shot_${idx + 1}`;
              return `  ${idx + 1}. [${id}] 景别: ${sh.shotSize || '中景'}, 运镜: ${sh.cameraMovement || '固定'}, 时长: ${sh.durationSec || 3}s\n     画面: ${sh.visualComposition || '无'}`;
            });
            content = `【分镜头台本 (共 ${storyboard.shots.length} 镜，展示前 15 镜)】:\n${items.join('\n')}`;
          }
          break;
        }

        case 'gate_status': {
          const review = store.getArtifact<any>(projectId!, 'critic_review');
          if (!review) {
            content = '独立审查官尚未执行质检审计。';
          } else {
            rawArtifact = review;
            const dims = review.dimensionScores ? JSON.stringify(review.dimensionScores) : '未记录';
            content = [
              `【独立审查官质检报告】:`,
              `- 当前门禁判定: ${review.gateDecision || 'WARN'}`,
              `- 综合质量评分: ${review.overallScore ?? '未评分'}/100`,
              `- 四维审计细则: ${dims}`,
              `- 核心阻断风险点: ${review.blockingIssues?.join('；') || '无刚性阻断项'}`,
              `- 导演优化备忘建议: ${review.suggestions?.join('；') || '无'}`,
            ].join('\n');
          }
          break;
        }
      }

      return {
        success: true,
        projectId: projectId!,
        currentStage,
        scope,
        content,
        rawArtifact,
      };
    } catch (err: any) {
      console.warn('[inspectProjectStateTool] 查阅执行受控捕获:', err);
      return {
        success: false,
        projectId: '',
        currentStage: 'unknown',
        scope: 'overview',
        content: `查阅项目状态异常: ${err.message || '未知异常'}`,
        error: err.message,
      };
    }
  },
});
