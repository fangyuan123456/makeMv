import fs from 'fs';
import path from 'path';
import { BaseAgent, AgentContext, AgentResult } from '../base/index.js';
import { WorkflowStage } from '../../types/workflow.js';
import { SceneScriptArtifact } from './types.js';
import { episodeService } from './episode.service.js';

export class SceneScriptAgent extends BaseAgent<SceneScriptArtifact> {
  readonly stage = WorkflowStage.SCENE_SCRIPT;

  async execute(context: AgentContext): Promise<AgentResult<SceneScriptArtifact>> {
    const { session, userFeedback } = context;

    const existingArtifact = session.stageArtifacts[
      WorkflowStage.SCENE_SCRIPT
    ] as SceneScriptArtifact | undefined;

    let parsedFeedback: any = null;
    if (userFeedback) {
      try {
        parsedFeedback = typeof userFeedback === 'string' ? JSON.parse(userFeedback) : userFeedback;
      } catch {
        parsedFeedback = { instruction: userFeedback };
      }
    }

    const epNum = Number(parsedFeedback?.episodeNumber || existingArtifact?.activeEpisodeNumber || 1);
    const result = await episodeService.expandEpisode(context, existingArtifact, epNum);

    // 导出易读的电影级分场剧本 Markdown 文档
    if (result.artifact?.episodes && result.artifact.episodes.length > 0) {
      try {
        const scriptsDir = path.join(context.projectDir, 'scripts');
        fs.mkdirSync(scriptsDir, { recursive: true });

        let md = `# ${session.title || '互动影游剧本 (Screenplay)'}\n\n`;

        for (const ep of result.artifact.episodes) {
          md += `## 第 ${ep.episodeNumber} 集：${ep.title || '正片'}\n`;
          if (ep.logline) md += `> **梗概**: ${ep.logline}\n\n`;

          if (ep.scenes && ep.scenes.length > 0) {
            for (const sc of ep.scenes) {
              md += `### 场次 ${sc.sceneId}：${sc.location} (${sc.space || '内'}/${sc.time || '日'})\n`;
              if (sc.characters && sc.characters.length > 0) {
                md += `**登场角色**: ${sc.characters.join('、')}\n\n`;
              }

              if (sc.items && sc.items.length > 0) {
                for (const item of sc.items) {
                  if (item.type === 'action' && item.action) {
                    md += `▲ ${item.action.description}\n\n`;
                  } else if (item.type === 'dialogue' && item.dialogue) {
                    const emo = item.dialogue.emotionPrompt ? `（${item.dialogue.emotionPrompt}）` : '';
                    md += `**${item.dialogue.character}**${emo}：${item.dialogue.text}\n\n`;
                  }
                }
              }

              if (sc.choices && sc.choices.length > 0) {
                md += `#### 【互动决策分支】\n`;
                for (const ch of sc.choices) {
                  md += `- 选项：\`${ch.choiceText}\` ➔ 跳转至 [场次 ${ch.targetSceneId}]\n`;
                }
                md += '\n';
              }
            }
          }
          if (ep.cliffhanger) {
            md += `> **本集悬念尾声**: ${ep.cliffhanger}\n\n`;
          }
        }

        fs.writeFileSync(path.join(scriptsDir, 'screenplay.md'), md, 'utf-8');
      } catch (err) {
        console.warn('[SceneScriptAgent] Failed to write screenplay.md:', err);
      }
    }

    return result;
  }
}
