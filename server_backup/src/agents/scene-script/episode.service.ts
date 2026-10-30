import { AgentContext, AgentResult } from '../base/index.js';
import { WorkflowStage } from '../../types/workflow.js';
import { SceneScriptArtifact, ScriptEpisode, ScriptScene } from './types.js';
import { parseScriptWithLLM } from './script.parser.js';
import { llmProvider, ChatMessage } from '../../providers/llm.provider.js';
import { loadPromptSafe } from '../../prompts/loader.js';

export class EpisodeService {
  /**
   * Expands an outline episode into a full scene-by-scene script with dual-track output.
   */
  async expandEpisode(
    context: AgentContext,
    existingArtifact: SceneScriptArtifact | undefined,
    targetEpisodeNumber: number = 1
  ): Promise<AgentResult<SceneScriptArtifact>> {
    const { session, userFeedback } = context;

    // 若既有产物数据不全，读取前序叙事设计阶段的产物
    const narrativeArtifact = session.stageArtifacts[WorkflowStage.NARRATIVE_DESIGN] || {};

    const targetTitle = existingArtifact?.title || narrativeArtifact.title || session.title || '互动影游';
    const targetTheme = existingArtifact?.theme || narrativeArtifact.theme || session.meta.idea;
    const targetStyle = existingArtifact?.style || narrativeArtifact.style || session.meta.style;

    const episodes = existingArtifact?.episodes || narrativeArtifact.episodes || [];
    const targetEp = episodes.find((e: any) => e.episodeNumber === targetEpisodeNumber) || episodes[0] || {
      episodeNumber: targetEpisodeNumber,
      title: `第 ${targetEpisodeNumber} 集`,
      logline: '核心危机爆发',
    };

    const characters = narrativeArtifact.characters || [];
    const storyGraph = narrativeArtifact.storyGraph;

    const systemPrompt = loadPromptSafe('script', 'expand_episode', 'zh');

    const userPrompt = `
【故事总标题】：${targetTitle}
【全剧核心创意】：${targetTheme}
【视觉与情绪基调】：${targetStyle}
【当前详写分集】：第 ${targetEp.episodeNumber} 集《${targetEp.title}》
【本集核心大纲与断章钩子】：${targetEp.logline || ''} ${targetEp.cliffhanger ? `(钩子: ${targetEp.cliffhanger})` : ''}
【人物设定库】：
${characters.map((c: any) => `- ${c.name} (${c.role}): 性格「${c.personality || ''}」，外观「${c.appearance || ''}」`).join('\n')}
${storyGraph ? `【对应网状互动节点与线索】：\n${JSON.stringify(storyGraph.nodes.slice(0, 5).map((n: any) => ({ id: n.id, title: n.title, summary: n.summary })), null, 2)}\n` : ''}
${userFeedback ? `【用户特别要求】：\n${userFeedback}\n` : ''}

请务必输出纯正合法的 JSON，结构必须包含：
{
  "scriptMarkdown": "标准的中文影视长剧本文本...",
  "scenes": [
    {
      "sceneId": "scene_001",
      "title": "场景标题",
      "time": "日 / 夜",
      "space": "内 / 外",
      "location": "地点",
      "characters": ["角色名"],
      "items": [
        { "id": "it_1", "type": "action", "action": { "description": "动作描述" } },
        { "id": "it_2", "type": "dialogue", "dialogue": { "character": "角色", "emotionPrompt": "(语气英文)", "text": "对白" } }
      ],
      "choices": [
        { "id": "c_1", "choiceText": "分支选项", "targetSceneId": "scene_002" }
      ]
    }
  ]
}`;

    const messages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ];

    let scriptMarkdown = '';
    let extractedScenes: ScriptScene[] = [];

    try {
      const parsed = await llmProvider.chatJSON<{ scriptMarkdown: string; scenes: ScriptScene[] }>(messages, 0.7);
      scriptMarkdown = parsed.scriptMarkdown || '';
      extractedScenes = Array.isArray(parsed.scenes) ? parsed.scenes : [];
    } catch {
      scriptMarkdown = '';
    }

    if (!extractedScenes || extractedScenes.length === 0) {
      const llmParsed = await parseScriptWithLLM(scriptMarkdown, {
        title: targetTitle,
        theme: targetTheme,
        style: targetStyle,
      });
      extractedScenes = llmParsed.episodes?.[0]?.scenes || [];
    }

    const updatedEpisodes: ScriptEpisode[] = episodes.map((ep: any) => {
      if (ep.episodeNumber === targetEp.episodeNumber) {
        return {
          ...ep,
          status: 'completed',
          content: scriptMarkdown,
          scenes: extractedScenes,
        };
      }
      return ep;
    });

    if (!updatedEpisodes.some((ep) => ep.episodeNumber === targetEp.episodeNumber)) {
      updatedEpisodes.push({
        ...targetEp,
        status: 'completed',
        content: scriptMarkdown,
        scenes: extractedScenes,
      });
    }

    const allLocations = new Set<string>(existingArtifact?.locations || []);
    for (const sc of extractedScenes) {
      if (sc.location) allLocations.add(sc.location);
    }

    const updatedArtifact: SceneScriptArtifact = {
      title: targetTitle,
      theme: targetTheme,
      style: targetStyle,
      episodes: updatedEpisodes,
      characterNames: characters.map((c: any) => c.name),
      locations: Array.from(allLocations),
      activeEpisodeNumber: targetEpisodeNumber,
      scriptText: scriptMarkdown,
      rawText: scriptMarkdown,
      isLocked: false,
    };

    return {
      stage: WorkflowStage.SCENE_SCRIPT,
      artifact: updatedArtifact,
      requiresIntervention: true,
      stopPointTitle: `第 ${targetEp.episodeNumber} 集长文本剧本生成完成`,
      stopPointDescription: `已成功生成《${targetTitle}》第 ${targetEp.episodeNumber} 集《${targetEp.title}》完整剧本与 ${extractedScenes.length} 个结构化场次。`,
    };
  }
}

export const episodeService = new EpisodeService();
