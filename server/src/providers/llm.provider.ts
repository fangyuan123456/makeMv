import OpenAI from 'openai';
import { config } from '../config/index.js';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export class LLMProvider {
  private client: OpenAI | null = null;
  private model: string;
  private mockMode: boolean;

  constructor() {
    this.model = config.llm.model;
    this.mockMode = config.mockMode || !config.llm.apiKey;

    if (!this.mockMode && config.llm.apiKey) {
      this.client = new OpenAI({
        apiKey: config.llm.apiKey,
        baseURL: config.llm.baseUrl,
      });
    }
  }

  async chat(messages: ChatMessage[], temperature: number = 0.7): Promise<string> {
    if (this.mockMode || !this.client) {
      return this.generateMockResponse(messages);
    }

    try {
      const response = await this.client.chat.completions.create({
        model: this.model,
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
        temperature,
      });

      return response.choices[0]?.message?.content || '';
    } catch (err: any) {
      console.warn(`[LLM] API call failed: ${err.message}. Falling back to mock generator.`);
      return this.generateMockResponse(messages);
    }
  }

  /**
   * Helper that prompts the LLM to output valid JSON and extracts it reliably.
   */
  async chatJSON<T>(messages: ChatMessage[], temperature: number = 0.3): Promise<T> {
    const raw = await this.chat(messages, temperature);
    return this.parseJSON<T>(raw);
  }

  private parseJSON<T>(raw: string): T {
    let clean = raw.trim();

    // Strip markdown code fences if present
    const jsonMatch = clean.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (jsonMatch) {
      clean = jsonMatch[1].trim();
    }

    try {
      return JSON.parse(clean) as T;
    } catch {
      // Find outermost braces or brackets
      const firstBrace = clean.indexOf('{');
      const lastBrace = clean.lastIndexOf('}');
      if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
        let sliced = clean.slice(firstBrace, lastBrace + 1);

        try {
          return JSON.parse(sliced) as T;
        } catch {
          // Attempt automatic JSON repair:
          // 1. Remove JS single-line comments
          sliced = sliced.replace(/\/\/[^\n\r]*/g, '');
          // 2. Remove trailing commas before closing braces/brackets
          sliced = sliced.replace(/,\s*([\]}])/g, '$1');

          try {
            return JSON.parse(sliced) as T;
          } catch (err: any) {
            throw new Error(`Failed to parse LLM response as JSON: ${err.message}\nRaw text: ${raw.slice(0, 300)}...`);
          }
        }
      }
      throw new Error(`Failed to extract JSON object from LLM response.\nRaw text: ${raw.slice(0, 300)}...`);
    }
  }


  private generateMockResponse(messages: ChatMessage[]): string {
    const sysMsg = messages[0]?.content || '';
    const lastMsg = messages[messages.length - 1]?.content || '';

    // 1. Storyboard stage
    if (sysMsg.includes('分镜') || lastMsg.includes('分镜头列表')) {
      return JSON.stringify(
        {
          episodeNumber: 1,
          shots: [
            {
              shotId: 'S001',
              unitId: 'U01',
              sceneId: 'E01_S01',
              shotType: '全景',
              duration: 4,
              cameraAngle: '平视机位',
              cameraMovement: '固定机位，大雨从画面上方倾泻',
              charactersInShot: ['沈墨', '陆天齐'],
              visualContent: '大雨中废弃货柜码头，两人相对而立，黄色的集装箱在雨幕中若隐若现',
              dialogueOrAction: '大雨倾盆，货柜灯光将两人的身影拉长。',
              imagePrompt: 'Cinematic wide establishing shot, dark rainy industrial port shipping containers at night, two men standing facing each other under amber streetlights, puddles on ground, high resolution, 4k, photorealistic',
              videoPrompt: 'Static wide camera angle with rain falling heavily, reflection shimmers on the wet concrete ground, subtle silhouettes shifting',
            },
            {
              shotId: 'S002',
              unitId: 'U02',
              sceneId: 'E01_S01',
              shotType: '中景',
              duration: 4,
              cameraAngle: '微仰角度过肩机位',
              cameraMovement: '缓慢推向陆天齐面部',
              charactersInShot: ['陆天齐'],
              visualContent: '陆天齐手持黑伞冷笑，眼神充满压迫感',
              dialogueOrAction: '陆天齐：沈墨，你以为你还有翻盘的机会吗？把公章交出来。',
              imagePrompt: 'Medium shot of a ruthless young businessman holding a black umbrella in torrential rain, harsh side lighting, confident smirk, wet tailored suit, cinematic masterpiece',
              videoPrompt: 'Slow zoom in on the man talking with arrogant expression, rain dripping from umbrella rim, atmospheric mist behind him',
            },
            {
              shotId: 'S003',
              unitId: 'U03',
              sceneId: 'E01_S01',
              shotType: '特写',
              duration: 4,
              cameraAngle: '平视机位',
              cameraMovement: '镜头微移，聚焦沈墨冷峻双眸',
              charactersInShot: ['沈墨'],
              visualContent: '沈墨雨水顺着脸颊滑落，嘴角扬起一丝深不可测的冷笑',
              dialogueOrAction: '沈墨：天齐，你跟了我五年，还是没学会怎么看底牌。',
              imagePrompt: 'Dramatic close up of a sharp-eyed detective in rain, raindrops glistening on his cheeks, dark moody blue lighting, cinematic film grain, 8k',
              videoPrompt: 'Camera holds steady on the man as he slowly speaks with razor sharp confidence, water drops trickling down jawline',
            },
          ],
        },
        null,
        2
      );
    }

    // 2. Character design stage
    if (sysMsg.includes('美术总监') || lastMsg.includes('美术概念') || lastMsg.includes('角色与场景美术概念')) {
      return JSON.stringify(
        {
          characters: [
            {
              id: 'char_1',
              name: '沈墨',
              age: '32岁',
              role: '男主角 / 商业智囊',
              personality: '冷静阴沉，处变不惊',
              appearancePrompt: '32-year-old handsome East Asian man, sharp eyes, wet hair, realistic, cinematic lighting',
              clothingPrompt: 'dark tailored trench coat, wet from rain',
            },
            {
              id: 'char_2',
              name: '陆天齐',
              age: '30岁',
              role: '反派副手 / 篡位者',
              personality: '狂妄自大，内心偏执',
              appearancePrompt: '30-year-old East Asian male, sneering expression, slicked-back hair, harsh rim lighting',
              clothingPrompt: 'expensive Italian suit, black leather gloves holding an umbrella',
            },
          ],
          settings: [
            {
              id: 'set_1',
              location: '废弃工业码头货柜区',
              space: '外',
              atmospherePrompt: 'Rainy industrial shipping dock, towering cargo containers, puddle reflections',
              lightingPrompt: 'Moody cinematic chiaroscuro, sodium amber lamps, deep blue night mist',
            },
          ],
        },
        null,
        2
      );
    }

    // 3. Script generation stage
    if (sysMsg.includes('编剧') || lastMsg.includes('剧本') || lastMsg.includes('第1集')) {
      return JSON.stringify(
        {
          title: '逆转之夜 (Night of Reversal)',
          theme: '悬疑商战 / 互动抉择',
          style: '电影质感，冷色调，高对比度光影',
          episodes: [
            {
              episodeNumber: 1,
              title: '绝地审判',
              logline: '昔日商业巨贾被昔日副手在废弃码头质问，生死存亡仅在一念之间。',
              scenes: [
                {
                  sceneId: 'E01_S01',
                  title: '码头雨夜对决',
                  time: '夜',
                  space: '外',
                  location: '废弃工业码头货柜区',
                  characters: ['沈墨', '陆天齐'],
                  items: [
                    {
                      id: 'item_1',
                      type: 'action',
                      action: { description: '大雨倾盆，货柜灯光将两人的身影拉长。' },
                    },
                    {
                      id: 'item_2',
                      type: 'dialogue',
                      dialogue: {
                        character: '陆天齐',
                        emotionPrompt: '冷笑嘲讽',
                        text: '沈墨，你以为你还有翻盘的机会吗？把公章交出来。',
                      },
                    },
                    {
                      id: 'item_3',
                      type: 'dialogue',
                      dialogue: {
                        character: '沈墨',
                        emotionPrompt: '眼神阴鸷，毫无惧色',
                        text: '天齐，你跟了我五年，还是没学会怎么看底牌。',
                      },
                    },
                  ],
                  choices: [
                    {
                      id: 'choice_1',
                      choiceText: '拿出录音笔摊牌',
                      targetSceneId: 'E01_S02_A',
                      description: '沈墨揭露反派罪证',
                    },
                    {
                      id: 'choice_2',
                      choiceText: '佯装示弱，伺机夺枪',
                      targetSceneId: 'E01_S02_B',
                      description: '沈墨近身搏击',
                    },
                  ],
                },
              ],
            },
          ],
          characterNames: ['沈墨', '陆天齐'],
          locations: ['废弃工业码头货柜区'],
        },
        null,
        2
      );
    }

    return JSON.stringify({
      status: 'ok',
      mock: true,
      message: 'Generated by FMV-Agent LLM Mock Provider',
    });
  }
}

export const llmProvider = new LLMProvider();


