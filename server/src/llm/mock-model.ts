/**
 * llm/mock-model.ts
 * 离线确定性 LanguageModelV1 驱动测试桩 (Mock Language Model SSOT)
 *
 * 核心规范：
 * 1. 0 延迟、0 费用、100% 离线确定性响应
 * 2. 严格实现 Vercel AI SDK 与 Mastra 原生规范的 LanguageModelV1
 * 3. 针对策划案 (GDD)、文游 (TextGame)、影游 (FilmSpec) 的 Zod 契约输出完美匹配的结构化数据
 */

import type {
  LanguageModelV1,
  LanguageModelV1CallOptions,
  LanguageModelV1StreamPart,
} from 'ai';

export class MockLanguageModel implements LanguageModelV1 {
  public readonly specificationVersion = 'v1' as const;
  public readonly provider = 'mock-provider';
  public readonly modelId = 'mock-model';
  public readonly defaultObjectGenerationMode = 'json' as const;
  public readonly supportsStructuredOutputs = true;

  public async doGenerate(options: LanguageModelV1CallOptions): Promise<{
    text?: string;
    finishReason: 'stop';
    usage: { promptTokens: number; completionTokens: number };
    rawCall: { rawPrompt: unknown; rawSettings: Record<string, unknown> };
  }> {
    let promptText = '';
    for (const msg of options.prompt) {
      if (typeof msg.content === 'string') {
        promptText += msg.content + '\n';
      } else if (Array.isArray(msg.content)) {
        for (const part of msg.content) {
          if ('text' in part && typeof part.text === 'string') {
            promptText += part.text + '\n';
          }
        }
      }
    }

    let mockObject: unknown;

    // 1. 影游切片需求 (FilmAdapter)
    if (
      promptText.includes('FilmAdapter') ||
      promptText.includes('分镜') ||
      promptText.includes('影视切片')
    ) {
      mockObject = {
        schemaVersion: '1.0.0',
        projectTitle: '代号：夜雀 (Film Spec Mock)',
        clips: [
          {
            clipId: 'CLIP_01_STANDOFF',
            sourceNodeId: 'node_start',
            targetDurationSec: 5.0,
            shotType: 'CLOSE_UP',
            visualPrompt:
              'cinematic film still, 52yo commanding man with glowing blue cybernetic eye pressing handgun on metal table, rainy neon backlight, masterpiece, 8k, photorealistic',
            audioDialogue: '维克托冷冷道：“林巡，证明给我看。”',
            audioAmbience: 'rain drumming on glass, low cello tension drone',
            matchCutAnchor: '维克托右手拍枪动作切点，顺向切林巡冷酷瞳孔特写',
          },
        ],
      };
    } else if (
      // 2. 文游内容 (TextGame Nodes / Pi Agent)
      promptText.includes('Pi Agent') ||
      promptText.includes('TextGame') ||
      promptText.includes('text-game') ||
      promptText.includes('图文交互游戏') ||
      promptText.includes('图文游戏') ||
      promptText.includes('专属建造工具箱') ||
      promptText.includes('write_game_node') ||
      promptText.includes('扩写') ||
      promptText.includes('游戏剧本') ||
      promptText.includes('分支剧情')
    ) {
      mockObject = {
        schemaVersion: '2.0.0',
        title: '深海逆光：临界博弈',
        startNodeId: 'node_start',
        nodes: [
          {
            id: 'node_start',
            title: '雨夜审讯室对峙',
            visual: {
              locationId: 'loc_interrogation_room',
              entityIds: ['char_viktor', 'prop_brass_bullet'],
              scenePrompt: '雨夜封闭水泥审讯室，窗外冷蓝暴雨，冷白吊灯直射铁桌',
              characterPrompt: '52岁维克托主管冷酷注视，冰蓝测谎义眼高频闪烁，右手按在黄铜子弹上',
              composition: 'POV第一人称平视视角，正对金属铁桌与维克托上半身',
              imagePromptEn:
                '1man, 52yo imposing security chief, glowing blue cybernetic eye, dark military coat, pressing brass bullet on steel table, rainy neon backlight through barred window, extreme suspense, masterpiece, 8k, photorealistic',
            },
            narrativeText:
              '暴雨猛烈抽打着铁窗。维克托慢条斯理地将一枚黄铜子弹按入冰冷的铁桌，推到你的面前。军规测谎义眼的冰蓝冷光高频震颤，死死锁定你的颈动脉跳动。\n\n“林巡，今晚第三下层机房失窃。我需要你证明，你的脑神经芯片里没有爬满抵抗军的蠕虫。”',
            choices: [
              {
                id: 'opt_silent',
                text: '公事公办：“我是按规程去巡查阻断剂配额”',
                targetNodeId: 'node_02a_briefcase',
                stateMutation: {
                  variables: { suspicion: -10, neural_overload: 10 },
                },
              },
              {
                id: 'opt_provoke',
                text: '反客为主：“抓内鬼抓到清道夫头上，看来主管你的晋升压力很大”',
                targetNodeId: 'node_02b_choke',
                stateMutation: {
                  variables: { suspicion: 25, courage: 15 },
                },
              },
              {
                id: 'opt_panic_silence',
                text: '心虚迟疑，冷汗顺着额角滑落（被动默认流）',
                targetNodeId: 'node_dead_execution',
                stateMutation: {
                  variables: { suspicion: 50 },
                },
              },
            ],
          },
          {
            id: 'node_02a_briefcase',
            title: '公文包视线盲区',
            narrativeText:
              '维克托从鼻腔喷出一股浓浊的雪茄烟雾，转身调阅终端日志。桌上的真皮公文包拉链半敞，带血的联络员名单正微露出一角。\n\n距离他回过头来，只有吐出下一口烟雾的四秒钟。',
            choices: [
              {
                id: 'opt_swap_list',
                text: '【微动作掉包】趁其吐烟背身瞬间，用预备的空白纸张调换名单',
                targetNodeId: 'node_end_ghost',
                stateMutation: {
                  variables: { neural_overload: 15, suspicion: 5 },
                  flags: { swapped_name_list: true },
                },
              },
              {
                id: 'opt_hesitate',
                text: '迟疑不决，手悬在半空僵住',
                targetNodeId: 'node_dead_execution',
                stateMutation: {
                  variables: { suspicion: 40 },
                },
              },
            ],
          },
          {
            id: 'node_02b_choke',
            title: '掐喉暴力审讯',
            narrativeText:
              '维克托被彻底激怒，机械右臂以肉眼难辨的速度暴起，猛然掐住你的咽喉将你按在桌上！撞锤手枪上膛的清脆金属咬合声紧贴着你的太阳穴。\n\n“清道夫，你真以为我不敢当场销毁你？！”',
            choices: [
              {
                id: 'opt_reveal_black_account',
                text: '【揭发黑账】“维克托，第三号码头走私终端的密钥，需要我当着安保频段念出来吗？”',
                requiredFlags: ['has_victor_black_account'],
                targetNodeId: 'node_end_takeover',
                stateMutation: {
                  variables: { suspicion: -30 },
                },
              },
              {
                id: 'opt_struggle_overload',
                text: '【绝境过载】强行启动义眼闪光超载致盲',
                targetNodeId: 'node_dead_melt',
                stateMutation: {
                  variables: { neural_overload: 70 },
                },
              },
            ],
          },
          {
            id: 'node_dead_execution',
            title: 'BE1: 审讯室当场处决',
            narrativeText:
              '测谎红灯长鸣爆闪！维克托冷冷道：“你的心率已经招认了一切。”撞锤击发，轰鸣震耳欲聋，视野堕入猩红与永恒黑暗。',
            choices: [],
          },
          {
            id: 'node_dead_melt',
            title: 'BE2: 神经熔断休克',
            narrativeText:
              '额角散热口喷出刺鼻白烟，高压电流瞬间烧穿视网膜。你在剧烈的抽搐中意识涣散，沦为冰冷停机坪上的废弃生化零件。',
            choices: [],
          },
          {
            id: 'node_end_ghost',
            title: 'HE: 幽灵破晓',
            narrativeText:
              '换岗铃声在破晓的雷雨中回荡。维克托收回雪茄，挥手示意放行。你扣上风衣走出安保大楼，带血的真名单安稳沉睡在衣袋夹层中，你化作阴影无声遁入雨夜。',
            choices: [],
          },
          {
            id: 'node_end_takeover',
            title: 'TE: 反客为主',
            narrativeText:
              '维克托脸上的傲慢瞬间瓦解，冷汗沿着机械接缝渗出。他缓缓松开手，咬牙将最高安保通行卡推进你的掌心：“林巡……今晚的事，一个字都别说出去。”攻守之势彻底逆转。',
            choices: [],
          },
        ],
      };
    } else {
      // 3. 策划案 (GDD)
      mockObject = {
        schemaVersion: '2.0.0',
        title: '代号：夜雀 (Mock Test GDD)',
        genre: '赛博潜伏互动文游',
        hook: '一个伪装成财阀清道夫的黑客，在最后一夜面临同伴处决的极限抉择。',
        playerRole: '双面间谍卧底',
        markdown: `# 《代号：夜雀》互动影游策划案 (GDD)\n\n## 1. 核心叙事支柱\n在暴雨倾盆的审讯室，清道夫林巡必须在机械测谎枪口下求生。\n\n## 2. 全局状态机\n- suspicion: 初始 30, 达到 80 处决\n- sanity: 初始 100`,
        globalStateMachine: {
          variables: {
            suspicion: { name: '怀疑度', initial: 30, min: 0, max: 100 },
            sanity: { name: '神经理智值', initial: 100, min: 0, max: 100 },
          },
          flags: {
            has_cipher_key: { name: '掌握密钥', initial: false },
          },
          inventory: ['fake_id_card'],
        },
        characters: [
          {
            characterId: 'char_lin_xun',
            name: '林巡',
            role: 'player',
            appearance: '26岁青年，右侧额发遮挡着植入接口伤痕，身穿仿旧仿生皮革风衣。',
            personality: '沉静克制，微表情管理大师，内心被同伴牺牲的罪疚折磨。',
          },
          {
            characterId: 'char_viktor',
            name: '维克托',
            role: 'antagonist',
            appearance: '52岁财阀安全主管，义体化改造率高达65%，右眼为冰蓝色军规测谎仪。',
            personality: '冷血猎犬，热衷于在精神上击溃猎物而非物理毁灭。',
          },
        ],
        flowchartNodes: [
          {
            nodeId: 'node_start',
            title: '雨夜审讯室',
            summary: '维克托当面将子弹按入弹巢，对主角突击测谎。',
            choices: [
              {
                choiceId: 'opt_silent',
                text: '保持沉默，注视枪口',
                requiredFlags: [],
                stateMutations: {
                  variables: { suspicion: 10 },
                },
                nextNodeId: 'node_end_brave',
              },
              {
                choiceId: 'opt_plea',
                text: '“我是去申领阻断剂”',
                requiredFlags: [],
                stateMutations: {
                  variables: { suspicion: -5 },
                },
                nextNodeId: 'node_end_clever',
              },
            ],
          },
        ],
      };
    }

    return {
      text: JSON.stringify(mockObject),
      finishReason: 'stop',
      usage: {
        promptTokens: 25,
        completionTokens: 80,
      },
      rawCall: {
        rawPrompt: options.prompt,
        rawSettings: {},
      },
    };
  }

  public async doStream(options: LanguageModelV1CallOptions): Promise<{
    stream: ReadableStream<LanguageModelV1StreamPart>;
    rawCall: { rawPrompt: unknown; rawSettings: Record<string, unknown> };
  }> {
    const text = '你好！我是中枢路由总控 RouterAgent。我已就绪，随时可以为您推敲互动影游的设定与世界观。';
    const stream = new ReadableStream<LanguageModelV1StreamPart>({
      start(controller) {
        controller.enqueue({ type: 'text-delta', textDelta: text });
        controller.enqueue({
          type: 'finish',
          finishReason: 'stop',
          usage: { promptTokens: 10, completionTokens: 20 },
        });
        controller.close();
      },
    });

    return {
      stream,
      rawCall: { rawPrompt: options.prompt, rawSettings: {} },
    };
  }
}
