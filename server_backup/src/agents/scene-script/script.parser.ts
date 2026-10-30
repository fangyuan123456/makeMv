import { llmProvider, ChatMessage } from '../../providers/llm.provider.js';
import { SceneScriptArtifact, ScriptEpisode, ScriptScene } from './types.js';

export async function parseScriptWithLLM(
  scriptMarkdown: string,
  meta?: { title?: string; theme?: string; style?: string }
): Promise<Partial<SceneScriptArtifact>> {
  const systemPrompt = `你是一个顶级专业电影与互动短剧剧本结构化解析器。
你的唯一任务是分析输入的中文剧本文本，精准将其拆解转化为严格的结构化 JSON。
不要输出任何 Markdown 标记或多余文字，只输出符合格式的合法 JSON。

【JSON输出结构规范】：
{
  "title": "剧本标题（若未明示则从内容提炼）",
  "characterNames": ["角色1", "角色2"],
  "locations": ["场景地点1", "场景地点2"],
  "episodes": [
    {
      "episodeNumber": 1,
      "title": "集标题",
      "logline": "一句话核心剧情",
      "scenes": [
        {
          "sceneId": "scene_001",
          "title": "场景标题",
          "time": "日 / 夜 / 黄昏 / 晨",
          "space": "内 / 外",
          "location": "具体地点",
          "characters": ["本场出现的角色名"],
          "items": [
            {
              "id": "item_1",
              "type": "action",
              "action": { "description": "动作与环境描写的具体内容" }
            },
            {
              "id": "item_2",
              "type": "dialogue",
              "dialogue": {
                "character": "说话人角色名",
                "emotionPrompt": "语气情绪英文描述，例如: (coldly and suspiciously)",
                "text": "台词对白内容"
              }
            }
          ],
          "choices": [
            {
              "id": "c_1",
              "choiceText": "互动选项内容（如有）",
              "targetSceneId": "scene_002"
            }
          ]
        }
      ]
    }
  ]
}`;

  const userPrompt = `
【待解析剧本文本】：
${scriptMarkdown}

请严格遵守以上结构输出纯净 JSON。`;

  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ];

  try {
    const parsed = await llmProvider.chatJSON<any>(messages, 0.1);
    return {
      title: parsed?.title || meta?.title || '未命名剧作',
      characterNames: Array.isArray(parsed?.characterNames) ? parsed.characterNames : [],
      locations: Array.isArray(parsed?.locations) ? parsed.locations : [],
      episodes: Array.isArray(parsed?.episodes) ? parsed.episodes : [],
    };
  } catch (err) {
    console.warn('[parseScriptWithLLM] Fallback due to parse error:', err);
    return {
      title: meta?.title || '剧本',
      characterNames: [],
      locations: [],
      episodes: [
        {
          episodeNumber: 1,
          title: '第一幕',
          logline: '剧本内容',
          scenes: [
            {
              sceneId: 'scene_001',
              title: '默认场景',
              time: '日',
              space: '内',
              location: '未知地点',
              characters: [],
              items: [
                {
                  id: 'item_1',
                  type: 'action',
                  action: { description: scriptMarkdown.slice(0, 300) },
                },
              ],
            },
          ],
        },
      ],
    };
  }
}
