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

    // -1. 优先命中 Web Game Developer 编程智能体 (直出完整 HTML5 游戏代码)
    if (
      promptText.includes('web-game-developer') ||
      promptText.includes('HTML5 游戏程序 (game.html)') ||
      promptText.includes('game.html') ||
      promptText.includes('全栈 HTML5 游戏开发专家')
    ) {
      const mockHtml = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <title>深海逆光：临界博弈 - 互动影游</title>
  <style>
    body { background: #0a0d14; color: #fff; font-family: sans-serif; display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 100vh; }
    .viewport { width: 800px; height: 450px; background: #000; position: relative; border-radius: 8px; overflow: hidden; }
    .card { width: 800px; background: rgba(20,25,35,0.9); padding: 20px; border-radius: 8px; margin-top: 16px; }
    .choice-btn { background: #192231; border: 1px solid #00f3ff; color: #fff; padding: 10px 16px; border-radius: 4px; margin-top: 8px; cursor: pointer; display: block; width: 100%; text-align: left; }
  </style>
</head>
<body>
  <div class="viewport" id="visualViewport" data-node-id="node_start" data-shot-id="shot_node_start" data-video-prompt="Slow camera motion, 4k">
    <img id="staticVisualImg" src="/media/mock_proj/keyframes/node_start.png" style="width:100%;height:100%;object-fit:cover;" onerror="this.style.background='#111';" />
    <video id="videoPlayer" style="display:none;"></video>
  </div>
  <div class="card">
    <h2 id="sceneTitle">雨夜审讯室对峙</h2>
    <p id="narrativeText">暴雨抽打着铁窗，维克托将黄铜子弹按入铁桌。</p>
    <div id="choicesContainer">
      <button class="choice-btn" onclick="alert('进入下一幕')">1. 公事公办出示巡查记录</button>
    </div>
  </div>
  <script>
    console.log('Mock Web Game Loaded');
  </script>
</body>
</html>`;
      return {
        text: mockHtml,
        finishReason: 'stop',
        usage: { promptTokens: 30, completionTokens: 120 },
        rawCall: { rawPrompt: options.prompt, rawSettings: {} },
      };
    }

    const schemaStr = options.mode && 'schema' in options.mode ? JSON.stringify(options.mode.schema) : '';

    // -0.85 优先命中分幕自包含切片打包工序 (ScenePackaging)
    if (
      schemaStr.includes('nextSceneJson') ||
      schemaStr.includes('targetVideoClipName') ||
      promptText.includes('nextSceneJson') ||
      promptText.includes('targetVideoClipName') ||
      promptText.includes('scene-packaging-agent') ||
      promptText.includes('SingleSceneJson') ||
      promptText.includes('SingleSceneJson 数组')
    ) {
      mockObject = {
        scenes: [
          {
            sceneId: 'S1',
            level: 1,
            title: '暴雨走廊的狭路相逢',
            targetVideoClipName: 'S1.mp4',
            estimatedDurationSeconds: 8,
            entityIds: ['char_lin_xun', 'char_viktor', 'item_brass_bullet'],
            visualAnchor: {
              endFrameMoment: '雨夜走廊尾帧定格：维克托机械手按在加密公文包锁扣上，夜雀眼神沉稳直视扫描光束，脚边积水旁落着黄铜特种子弹。',
              cameraAngle: '特写机位微俯，慢速推进',
              lighting: '冷雨反光与暖暗警戒灯光对比',
              promptZh: '雨夜合金走廊尾帧单幅电影画面，维克托手按加密公文包锁扣，与身着黑色战术风衣的夜雀对视，地上积水旁可见黄铜特种子弹，紧张对峙氛围。',
              promptEn: 'cinematic dark corridor end-frame shot, security chief pressing hand on briefcase lock, undercover agent facing him tensely, brass bullet on wet floor, moody lighting, high detail',
            },
            screenplay: {
              storyContext: '凌晨三点旧城基地走廊，维克托拦住携带绝密名单的夜雀并启动义眼扫描。',
              videoActionDescription: '镜头推近维克托的手部与夜雀微颤的眼神。',
              dialogues: [
                { speaker: '维克托', line: '凌晨三点带这种重加密箱子，心率可别露馅。', emotion: '冷峻' },
              ],
            },
            interaction: {
              choices: [
                { choiceId: 'c_S1_to_S2', text: '继续推进', nextSceneJson: 'S2.json' },
              ],
              isEnding: false,
            },
          },
          {
            sceneId: 'S2',
            level: 2,
            title: '锁扣试探与临机抉择',
            targetVideoClipName: 'S2.mp4',
            estimatedDurationSeconds: 8,
            entityIds: ['char_lin_xun', 'char_viktor'],
            visualAnchor: {
              endFrameMoment: '锁扣试探尾帧定格：维克托机械手伸向公文包锁扣，夜雀右手扣住随身钥匙、左手袖口暗藏反制暗器。',
              cameraAngle: '中近景过肩双人构图',
              lighting: '冷蓝警戒灯与阴影交错',
              promptZh: '合金走廊中近景尾帧画面，夜雀手握铜制钥匙准备递出，袖口微动暗藏反击态势，维克托伸手准备索取钥匙。',
              promptEn: 'medium close-up confrontation in dark metal corridor, agent holding brass key while security chief reaches out, tense suspense, high detail',
            },
            screenplay: {
              storyContext: '维克托下令开启公文包查验，你必须当机立断。',
              videoActionDescription: '视线在钥匙与后腰之间瞬时权衡。',
              dialogues: [
                { speaker: '维克托', line: '把箱子打开，让我亲眼看看里面的单据。', emotion: '压迫' },
              ],
            },
            interaction: {
              choices: [
                { choiceId: 'I_S2_A', text: '主动递出随身钥匙，语气平静公事公办', nextSceneJson: 'S3.json' },
                { choiceId: 'I_S2_B', text: '反手拔出微型消音手枪试图背刺突围', nextSceneJson: 'S2.1.json' },
              ],
              isEnding: false,
            },
          },
          {
            sceneId: 'S2.1',
            level: 2,
            title: '暴雨喋血',
            targetVideoClipName: 'S2.1.mp4',
            estimatedDurationSeconds: 6,
            entityIds: ['char_lin_xun', 'char_viktor'],
            visualAnchor: {
              endFrameMoment: '走廊警报红光尾帧定格：维克托机械臂抬起举枪压制，夜雀单膝受制于积水走廊。',
              cameraAngle: '低角度近景张力构图',
              lighting: '警报红光闪烁映照雨幕',
              promptZh: '暴雨走廊尾帧画面，维克托机械臂反击制服夜雀，警卫合围走廊，红光警报闪烁。',
              promptEn: 'dramatic action confrontation end-frame in corridor, red warning lights, high contrast tension shadows, high detail',
            },
            screenplay: {
              storyContext: '拔枪试图突围被防暴卫兵与维克托瞬间制服。',
              videoActionDescription: '装甲抬起与电弧闪烁定格在名单芯片跌落瞬间。',
              dialogues: [
                { speaker: '维克托', line: '冲动的拔枪，就是你的自白。', emotion: '残酷' },
              ],
            },
            interaction: {
              choices: [],
              isEnding: true,
              endingType: 'BE',
              endingTitle: '暴雨喋血',
              verdict: '在绝对的力量压制前，冲动的拔枪不过是自掘坟墓的哀鸣。',
              rewindTargetScene: 'S2.json',
            },
          },
          {
            sceneId: 'S3',
            level: 3,
            title: '破晓放行',
            targetVideoClipName: 'S3.mp4',
            estimatedDurationSeconds: 8,
            entityIds: ['char_lin_xun'],
            visualAnchor: {
              endFrameMoment: '破晓尾帧定格：旧城合金防爆闸门升起，林巡压低帽檐踏出闸口迎向晨光。',
              cameraAngle: '中景平视，闸门升起迎来天光',
              lighting: '破晓晨光刺破雨夜阴霾',
              promptZh: '旧城合金闸门升起尾帧画面，林巡身着黑色战术风衣走出闸门，破晓晨光洒在肩头。',
              promptEn: 'medium end-frame shot, agent walking out heavy gate into breaking dawn sunlight after rain, atmospheric natural lighting, high detail',
            },
            screenplay: {
              storyContext: '成功解除嫌疑并视所持情报触发真结局或普通通关。',
              videoActionDescription: '闸门缓缓开启，主角压低帽檐步入晨光。',
              dialogues: [
                { speaker: '林巡', line: '这一关，总算过来了。', emotion: '沉稳' },
              ],
            },
            interaction: {
              choices: [],
              isEnding: true,
              endingType: 'HE',
              endingTitle: '普通通关：破晓放行',
              verdict: '顺利解除盘查脱身，但错失了带出情报的机会。',
            },
          },
        ],
        summary: 'Mock 打包 S1 / S2 / S2.1 / S3 共 4 幕场景完成',
      };
    }

    // -0.9 优先命中全局角色与道具定妆提示词提取工序 (GlobalEntities)
    else if (
      schemaStr.includes('artStyle') ||
      schemaStr.includes('appearanceSummary') ||
      promptText.includes('artStyle') ||
      promptText.includes('核心角色定妆') ||
      promptText.includes('concept-art-director') ||
      promptText.includes('Concept Art Director')
    ) {
      mockObject = {
        artStyle: '近未来暗黑写实影视质感，电影胶片颗粒与冷暖霓虹对比光影，高精度服装与金属纹理',
        characters: [
          {
            characterId: 'char_lin_xun',
            name: '林巡',
            identity: '代号“夜雀”的双面卧底特工',
            appearanceSummary: '26岁青年，眼神冷峻深邃，右额留有暗色植入接口伤痕，身着黑色旧式战术风衣',
            promptZh: '角色定妆照，单人正面全身站姿，26岁青年男性卧底特工，冷峻深邃眼神，右额暗色神经接口伤痕，身着黑色旧式战术风衣与深色长裤作战靴，纯中性浅灰无缝工作室背景，无场景无文字',
            promptEn: 'character turnaround portrait, 26yo undercover male agent, sharp jawline, tactical trench coat, neutral light gray seamless background, full body, no text',
          },
          {
            characterId: 'char_viktor',
            name: '维克托',
            identity: '财阀安保主管，冷血机械义体人',
            appearanceSummary: '52岁强悍中年，右眼为冰蓝色军规义眼，黑色军用大衣，机械右臂',
            promptZh: '角色定妆照，单人正面全身站姿，52岁强悍中年男子，右眼冰蓝色军规义眼，面带刀削般冷酷神情，身着黑色军用长风衣，机械右臂外露金属关节，纯中性浅灰无缝工作室背景，无场景无文字',
            promptEn: 'character turnaround portrait, 52yo commanding antagonist with glowing blue cybernetic eye, mechanical right arm, dark military coat, neutral light gray seamless background, full body, no text',
          },
        ],
        items: [
          {
            itemId: 'item_brass_bullet',
            name: '黄铜特种子弹',
            description: '刻有秘密代号的关键信物',
            appearanceSummary: '做旧黄铜弹壳，弹身刻有微缩编号与细微划痕',
            promptZh: '道具定妆特写，单枚做旧黄铜特种子弹居中展示，弹壳金属质感细腻，表面刻有微缩代号划痕，纯中性浅灰无缝工作室背景，无手部无人物无杂物',
            promptEn: 'macro prop look-dev close-up of a single tarnished brass bullet engraved with secret code, neutral light gray seamless studio background, centered, no hands, no text',
          },
        ],
      };
    }

    if (mockObject) {
      return {
        text: JSON.stringify(mockObject),
        finishReason: 'stop',
        usage: { promptTokens: 25, completionTokens: 80 },
        rawCall: { rawPrompt: options.prompt, rawSettings: {} },
      };
    }

    // -0.8 优先命中全案策划案汇总工序 (PRD Synthesis -> PrdEnhancementOutput)
    if (
      schemaStr.includes('interactionPatches') ||
      schemaStr.includes('endingEnhancements') ||
      promptText.includes('game-designer-agent') ||
      promptText.includes('PrdEnhancementOutput')
    ) {
      mockObject = {
        genre: '赛博朋克 / 谍战博弈 / 竖屏互动影游',
        playerIdentity: '代号“夜雀”的双面特工',
        premiseAndPerspective: '凌晨三点旧城基地合金走廊遭遇机械主管突击盘查，你以“夜雀”第一视角在心率危机与抉择中求生。',
        outOfFlowSummary: '后台维护 `calmLevel`（心率稳定度，初始 50）与 `intelCount`（情报数，初始 0，收集后可解锁真结局）。',
        gameplayAndVictorySummary: '视频播完后先稳定心率收集情报，再做关键抉择；收集情报并脱身达成真结局 TE，拔枪硬拼则陷入 BE。',
        uiPagesSummary: [
          { page: '主页', features: '开始/继续游戏、故事线选集、结局图鉴、设置' },
          { page: '播放页', features: '9:16 全屏播视频、字幕、播完互动浮层、暂停入口' },
          { page: '暂停与设置', features: '继续播放、重看本段、返回主页、音量与字幕开关' },
          { page: '故事线与图鉴', features: '分支节点快照重玩、多结局收集展示' },
        ],
        initialState: {
          calmLevel: 50,
          intelCount: 0,
        },
        interactionPatches: [
          {
            interactionId: 'I_S1',
            kind: 'HOLD',
            timeoutSec: 8,
            config: { durationSec: 1.5 },
            defaultOutcomeKey: 'TIMEOUT',
            outcomePatches: [
              {
                key: 'SUCCESS',
                stateChange: { add: { calmLevel: 15, intelCount: 1 } },
                feedback: '心率稳至 72，顺手记住公文包加密特征（情报 +1）',
              },
            ],
          },
          {
            interactionId: 'I_S2',
            kind: 'CHOICE',
            timeoutSec: 10,
            defaultOutcomeKey: 'B',
            outcomePatches: [
              { key: 'A', stateChange: { add: { calmLevel: -10 } } },
              { key: 'B', stateChange: { add: { calmLevel: 10 } } },
            ],
          },
        ],
        branchTransitions: [],
        endingEnhancements: [
          {
            sourceClipId: 'S3',
            endingId: 'END_S3_TE',
            endingType: 'TE',
            title: '真结局：深海破晓',
            isVictory: true,
            summary: '心率平稳过关且带出核心情报，成功潜入黎明。',
            condition: 'intelCount >= 1',
          },
          {
            sourceClipId: 'S3',
            endingId: 'END_S3_HE',
            endingType: 'HE',
            title: '普通通关：破晓放行',
            isVictory: true,
            summary: '顺利解除盘查脱身，但错失了带出情报的机会。',
            condition: null,
          },
        ],
      };
      return {
        text: JSON.stringify(mockObject),
        finishReason: 'stop',
        usage: { promptTokens: 40, completionTokens: 200 },
        rawCall: { rawPrompt: options.prompt, rawSettings: {} },
      };
    }

    // -0.7 优先命中分支剧本单切口推演工序 (Single Branch Derivation)
    if (
      schemaStr.includes('branchTitle') ||
      promptText.includes('branch-dramatist-agent') ||
      promptText.includes('单一分支切口') ||
      promptText.includes('戏剧冲突总监')
    ) {
      mockObject = {
        branchTitle: '暴雨喋血',
        narrativeText:
          '夜雀眼底寒光骤闪，反手抽出了藏在后腰的微型消音手枪，枪口精准顶向维克托的颈动脉机械接缝。然而维克托仿佛早有预料，右臂的重型装甲猛然向后撞击，狂暴的液压推力瞬间震碎了夜雀的腕骨！两名防暴卫兵的电击长矛自阴影中闪电刺出，高压电弧贯穿了夜雀的双肩，将他死死钉在冰冷潮湿的合金墙面上。维克托慢条斯理地转过身，咬着雪茄，将那枚闪烁着微光的潜伏者名单芯片捏碎在金属靴底。',
        resolutionType: 'ENDING',
        endingType: 'BE',
        endingTitle: '暴雨喋血',
        verdict: '在绝对的力量压制前，冲动的拔枪不过是自掘坟墓的哀鸣。',
        rewindTargetClipId: 'S2',
      };
      return {
        text: JSON.stringify(mockObject),
        finishReason: 'stop',
        usage: { promptTokens: 30, completionTokens: 120 },
        rawCall: { rawPrompt: options.prompt, rawSettings: {} },
      };
    }

    // -0.6A 优先命中 Step 2A · 原位 Patch 插入互动标签
    if (
      !schemaStr.includes('matchCutAnchor') &&
      !promptText.includes('FilmAdapter') &&
      (
        (schemaStr.includes('insertAfter') && schemaStr.includes('patches')) ||
        promptText.includes('InteractionTagPatchPlan')
      )
    ) {
      if (promptText.includes('冷光机械眼死死咬住夜雀的瞳孔。')) {
        mockObject = {
          title: '深海逆光：临界博弈',
          endingTitle: '破晓放行',
          patches: [
            {
              tagId: 'I1',
              clipTitle: '暴雨走廊的狭路相逢',
              insertAfter: '冷光机械眼死死咬住夜雀的瞳孔。',
              category: 'ACTION',
            },
            {
              tagId: 'I2',
              clipTitle: '锁扣试探与临机抉择',
              insertAfter: '维克托的声音像砂纸划过铁皮。',
              category: 'CHOICE',
            },
          ],
        };
      } else if (promptText.includes('警报红灯在积水的防弹玻璃上映出猩红冷光。')) {
        mockObject = {
          title: '深海逆光：临界博弈',
          endingTitle: '锁扣试探与临机抉择',
          patches: [
            {
              tagId: 'I1',
              clipTitle: '暴雨走廊的狭路相逢',
              insertAfter: '警报红灯在积水的防弹玻璃上映出猩红冷光。',
              category: 'CHOICE',
            },
          ],
        };
      } else {
        mockObject = {
          title: '深海逆光：临界博弈',
          endingTitle: '主干终局',
          patches: [],
        };
      }
      return {
        text: JSON.stringify(mockObject),
        finishReason: 'stop',
        usage: { promptTokens: 25, completionTokens: 60 },
        rawCall: { rawPrompt: options.prompt, rawSettings: {} },
      };
    }

    // -0.6B 优先命中 Step 2C · 逐标签并发实现物理分段后的单个互动玩法
    if (
      !schemaStr.includes('matchCutAnchor') &&
      !promptText.includes('FilmAdapter') &&
      (
        (schemaStr.includes('actionType') && schemaStr.includes('feedback') && !schemaStr.includes('mainlineChoice')) ||
        promptText.includes('ActionGameplay')
      )
    ) {
      mockObject = {
        actionType: 'HOLD',
        prompt: '长按屏幕平复过载生物心跳',
        feedback: '生物心率逐步回稳，目光恢复镇定',
      };
      return {
        text: JSON.stringify(mockObject),
        finishReason: 'stop',
        usage: { promptTokens: 20, completionTokens: 50 },
        rawCall: { rawPrompt: options.prompt, rawSettings: {} },
      };
    }

    if (
      !schemaStr.includes('matchCutAnchor') &&
      !promptText.includes('FilmAdapter') &&
      (
        (schemaStr.includes('mainlineChoice') && schemaStr.includes('conflictSummary') && !schemaStr.includes('actionType')) ||
        promptText.includes('ChoiceGameplay')
      )
    ) {
      mockObject = {
        conflictSummary: '公事公办周旋 vs 拔枪殊死一搏',
        mainlineChoice: '主动递出随身钥匙，语气平静公事公办',
        branchChoice: '反手拔出微型消音手枪试图背刺突围',
      };
      return {
        text: JSON.stringify(mockObject),
        finishReason: 'stop',
        usage: { promptTokens: 25, completionTokens: 60 },
        rawCall: { rawPrompt: options.prompt, rawSettings: {} },
      };
    }

    // -0.5 优先命中黄金主干剧本工序 (Spine Script)
    if (
      schemaStr.includes('spineScript') ||
      promptText.includes('黄金主干剧情') ||
      promptText.includes('Spine Script') ||
      promptText.includes('screenwriter-agent')
    ) {
      mockObject = {
        title: '深海逆光：临界博弈',
        spineScript:
          '凌晨三点，旧城基地的合金走廊内暴雨如注，警报红灯在积水的防弹玻璃上映出猩红冷光。\n\n夜雀将装有潜伏者绝密名单的加密公文包贴在身侧，快步穿过排风管道区，却在转角处迎面撞上了带着两名防暴卫兵的肃清主管维克托。\n\n金属靴踩在水坑里的声音戛然而止。维克托那只粗大的机械铁手毫无征兆地按死在公文包的锁扣上，冷光机械眼死死咬住夜雀的瞳孔。\n\n“凌晨三点，在封锁区带这种重加密箱子……夜雀，你是嫌自己义眼太亮，想让我亲手帮你抠出来吗？”\n\n维克托的声音像砂纸划过铁皮。夜雀后背渗出冷汗，但面部肌肉没有丝毫颤抖，反而顺势侧身，主动递出随身钥匙，语气平静而公事公办：“我是按例行规程去巡查阻断剂配额。公文包里全是密封单据，主管请便。”\n\n这番毫不遮掩的从容让维克托眼神闪烁了一下。他粗暴地夺过钥匙，哼了一声，转身走向墙边的排风口掏出雪茄点火。\n\n打火机的脆响掩盖了拉链的轻微滑动声。维克托背对着夜雀吞云吐雾，排风口的狂风在狭窄走廊里吹出刺耳的风哨，给夜雀留出了仅有三秒钟的视野盲区。\n\n夜雀的军用义眼飞速计算着微动作轨迹。趁着维克托吐出第一口浓烈白烟的刹那，夜雀指尖无声微颤，以毫秒级的精密度将怀里早已备好的空白配额单滑入夹层，同时将那张记载着全城地下潜伏者名单的微缩芯片抽回袖口。\n\n整个过程行云流水，快过雪茄火星的一次明灭。\n\n维克托转过身，将空钥匙扔还给夜雀，随意翻了翻夹层里的假文件，在放行单上粗暴地盖下了电子公章。\n\n“算你识相。滚吧。”\n\n要塞沉重的合金防爆闸门缓缓升起。黎明的第一抹破晓晨光刺破暴雨云层，洒在湿漉漉的停机坪上。夜雀压低风衣帽檐，带着完整的名单隐入了晨光中的车流与雨幕之中。',
      };
      return {
        text: JSON.stringify(mockObject),
        finishReason: 'stop',
        usage: { promptTokens: 30, completionTokens: 120 },
        rawCall: { rawPrompt: options.prompt, rawSettings: {} },
      };
    }

    // 0. 优先基于强类型 Schema 精准判定 (Schema SSOT)
    if (
      schemaStr.includes('startNodeId') ||
      schemaStr.includes('nodes') ||
      promptText.includes('Pi Agent') ||
      promptText.includes('TextGame') ||
      promptText.includes('专属建造工具箱') ||
      promptText.includes('write_game_node')
    ) {
      // 命中 TextGame 产物 (包含全部 7 个文学演出节点)
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
    } else if (
      // 1. 影游切片需求 (FilmAdapter)
      promptText.includes('FilmAdapter') ||
      promptText.includes('分镜') ||
      promptText.includes('影视切片')
    ) {
      mockObject = {
        schemaVersion: '1.0.0',
        projectTitle: '深海逆光：临界博弈 (Film Spec Mock)',
        clips: [
          {
            clipId: 'S1',
            sourceNodeId: 'S1',
            targetDurationSec: 5.0,
            shotType: 'CLOSE_UP',
            visualPrompt:
              'close-up shot inside moody steel corridor, commanding security officer pressing hand onto encrypted briefcase lock, tense standoff atmosphere, natural depth of field',
            audioDialogue: '维克托冷冷道：“凌晨三点带这种重加密箱子，证明给我看。”',
            audioAmbience: 'rain drumming outside metal corridor, low ambient drone',
            matchCutAnchor: '维克托按住锁扣手部微动，顺向切夜雀沉静瞳孔特写',
          },
        ],
      };
    } else if (
      // 2. 文游内容 (TextGame Nodes / Pi Agent)
      promptText.includes('Pi Agent') ||
      promptText.includes('专属建造工具箱') ||
      promptText.includes('write_game_node')
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
              locationName: '雨夜安保审讯室',
              entityNames: ['维克托', '0.38 动能黄铜子弹'],
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
    } else if (
      // 3. 剧组造型与通告簿 (Production Bible 动态解构)
      promptText.includes('ProductionBible') ||
      promptText.includes('造型与通告簿') ||
      promptText.includes('视觉与叙事资产解构')
    ) {
      mockObject = {
        title: '深海逆光：临界博弈',
        entities: [
          {
            name: '林巡',
            summary: '26岁潜伏卧底，冷静克制，微表情管理大师',
            visualPrompt:
              '1man, 26yo Asian undercover agent, cold focused eyes, slight scar near temple, disheveled dark hair, distressed dark tactical trenchcoat, moody cinematic lighting, 8k',
          },
          {
            name: '维克托',
            summary: '52岁财阀安保主管，冷酷审讯官',
            visualPrompt:
              '1man, 52yo commanding security chief, glowing blue cybernetic eye, tailored dark wool military coat, holding lit cigar, intense menacing glare, chiaroscuro lighting, 8k',
          },
          {
            name: '军规义体搜查猎犬 K-9',
            summary: '门外警戒巡查的重度义体化杜宾犬',
            visualPrompt:
              'cybernetic Doberman hound, matte titanium armor plating, glowing orange dual sensor eyes, exhaling light vapor, rainy concrete floor, photorealistic',
          },
          {
            name: '带血的联络员名单',
            summary: '任务核心掉包目标，夹在公文包内侧',
            visualPrompt:
              'classified paper document with encrypted typography, dark dry blood stain on corner, partially exposed from leather briefcase',
          },
        ],
        locations: [
          {
            name: '雨夜安保审讯室',
            atmosphere: '水泥防爆封闭室，冷轧铁桌，窗外暴雨与深蓝冷霓虹，冷白荧光吊灯直射桌心',
            visualPrompt:
              'brutalist underground interrogation room, dark brushed metal table in center, barred window with heavy rain and neon cyberpunk city lights outside, dim teal lighting, 8k',
          },
        ],
        keyMoments: [
          {
            theme: '子弹推至眼前的突击测谎',
            lines: [
              {
                speaker: '维克托',
                line: '“林巡，证明你的芯片里没有爬满抵抗军的蠕虫。”',
                action: '右手将黄铜子弹按入铁桌推向前，义眼冷蓝光斑锁定颈动脉',
                subtext: '看你心率能撑多久',
              },
              {
                speaker: '林巡',
                line: '“维克托主管，我是按规程巡查阻断剂配额。签批记录在终端随时可调。”',
                action: '双手平放膝上，呼吸维持在每分钟十二次',
                subtext: '表面服从，试探你到底掌握了多少实证',
              },
            ],
          },
        ],
      };
    } else {
      // 3. 策划案 (GDD PRD)
      mockObject = {
        schemaVersion: '3.0.0',
        title: '代号：夜雀 (Mock Test GDD)',
        genre: '赛博潜伏互动文游',
        hook: '一个伪装成财阀清道夫的黑客，在最后一夜面临同伴处决的极限抉择。',
        playerRole: '双面间谍卧底',
        coreLoop: '潜伏搜证 ➔ 心理对质 ➔ 致命决断',
        markdown: `# 《代号：夜雀》互动影游策划案 (GDD PRD)\n\n## 1. 核心玩法与心流循环\n潜伏搜证 ➔ 心理对质 ➔ 致命决断\n\n## 2. 全局状态机\n- suspicion: 初始 30, 达到 80 处决\n- sanity: 初始 100`,
        globalStateMachine: {
          philosophy: '心理博弈与信息差隐瞒',
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
        beatOutline: [
          {
            beatId: 'beat_01_interrogation',
            act: '第一幕·建立危机',
            title: '雨夜审讯室',
            gameplayTask: '搜检审讯室热点（子弹/档案柜/通讯器），限时整理不在场证据',
            dramaticGoal: '在机械测谎枪口下隐藏真实身份并获取信任',
            keyConflicts: '林巡 vs 维克托冰冷测谎',
            branchExpectations: [
              { intent: '公事公办顺从', targetBeatId: 'beat_02_clever' },
              { intent: '保持沉默对峙', targetBeatId: 'beat_02_brave' },
            ],
          },
          {
            beatId: 'beat_02_clever',
            act: '第二幕·中点反转',
            title: '巧妙周旋',
            gameplayTask: '调阅终端日志进行证据匹配试错，拼合口供链',
            dramaticGoal: '调阅终端日志印证口供，顺利解除嫌疑',
            keyConflicts: '调档证据与测谎仪判定',
            isEnding: true,
            endingTheme: '结局 TE: 巧妙周旋',
          },
          {
            beatId: 'beat_02_brave',
            act: '第二幕·中点反转',
            title: '破晓潜行',
            gameplayTask: '心率稳定 QTE 抗压，在倒计时内完成放行流程',
            dramaticGoal: '凭借极度克制的心率抗住压迫，促使主管放行',
            keyConflicts: '意志对决',
            isEnding: true,
            endingTheme: '结局 HE: 破晓潜行',
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
          {
            nodeId: 'node_end_brave',
            title: '结局 HE: 破晓潜行',
            summary: '维克托收起枪支放行，主角从容撤离。',
            choices: [],
          },
          {
            nodeId: 'node_end_clever',
            title: '结局 TE: 巧妙周旋',
            summary: '调阅终端日志印证口供，顺利解除嫌疑。',
            choices: [],
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
    const hasToolResult = options.prompt.some((m) => m.role === 'tool');
    const regularMode = options.mode?.type === 'regular' ? (options.mode as any) : undefined;
    const routerToolDef = regularMode?.tools?.find((t: any) => t?.name === 'emit_router_intent');
    const hasRouterTool = Boolean(routerToolDef);

    // 提取最新一条用户消息文本与所有对话/系统文本，决定模拟哪个路由意图
    const promptText = options.prompt
      .map((m) =>
        typeof m.content === 'string'
          ? m.content
          : Array.isArray(m.content)
            ? m.content.map((p: any) => ('text' in p && typeof p.text === 'string' ? p.text : '')).join('')
            : ''
      )
      .join('\n');

    let lastUserText = '';
    for (let i = options.prompt.length - 1; i >= 0; i--) {
      const msg = options.prompt[i];
      if (msg.role === 'user') {
        if (typeof msg.content === 'string') {
          lastUserText = msg.content;
        } else if (Array.isArray(msg.content)) {
          lastUserText = msg.content
            .map((p: any) => ('text' in p && typeof p.text === 'string' ? p.text : ''))
            .join('');
        }
        break;
      }
    }

    if (!hasToolResult && hasRouterTool) {
      const toolDesc = String(routerToolDef?.description || '');
      const combinedContext = `${toolDesc}\n${promptText}`;
      const cancelledMatch =
        /taskId=([^\s|]+)[\s|]+阶段=([^\s|]+)[\s|]+状态=(?:cancelled|failed)/.exec(combinedContext) ||
        /taskId:\s*([^\s|]+)\s*\|\s*阶段:\s*([^\s|]+)[^|\n]*(?:\|[^|\n]*)*\|\s*状态:\s*(?:cancelled|failed)/.exec(
          combinedContext
        );

      const isPureChat = lastUserText.includes('你是谁') || lastUserText.includes('随便聊聊');
      const isResume =
        Boolean(cancelledMatch) &&
        (lastUserText.includes('继续') || lastUserText.includes('恢复'));
      const isApprove =
        !isResume &&
        (lastUserText.includes('同意') ||
          lastUserText.includes('进入下一步') ||
          lastUserText.includes('生成文游'));

      const toolArgs = isPureChat
        ? {
            action: 'chat_only',
            summary: '解答创作者关于系统功能的咨询',
          }
        : isResume && cancelledMatch
          ? {
              contextAnalysis: `检测到对话与账本中存在已停止/中断的任务 ${cancelledMatch[1]}，识别为恢复意图`,
              action: 'resume_task',
              targetStage: cancelledMatch[2] === 'build_text_game' ? 'build_text_game' : 'plan_gdd',
              taskId: cancelledMatch[1],
              summary: `恢复中断任务 ${cancelledMatch[1]} 继续执行`,
            }
          : isApprove
            ? {
                action: 'approve_stage',
                targetStage: 'build_text_game',
                summary: '已确认当前方案，建议推进至下一工序装配互动文游',
                payload: JSON.stringify({ userPrompt: lastUserText }),
              }
            : {
                action: 'propose_stage',
                targetStage: 'plan_gdd',
                summary: '已提炼核心戏剧冲突与玩法构想，建议启动全案策划推演',
                payload: JSON.stringify({ userPrompt: lastUserText || '设计一个互动影游' }),
              };

      const stream = new ReadableStream<LanguageModelV1StreamPart>({
        start(controller) {
          controller.enqueue({
            type: 'tool-call',
            toolCallType: 'function',
            toolCallId: `mock_call_${Date.now()}`,
            toolName: 'emit_router_intent',
            args: JSON.stringify(toolArgs),
          });
          controller.enqueue({
            type: 'finish',
            finishReason: 'tool-calls',
            usage: { promptTokens: 15, completionTokens: 25 },
          });
          controller.close();
        },
      });

      return {
        stream,
        rawCall: { rawPrompt: options.prompt, rawSettings: {} },
      };
    }

    let toolVerdict = '';
    for (let i = options.prompt.length - 1; i >= 0; i--) {
      const msg = options.prompt[i];
      if (msg.role === 'tool' && Array.isArray(msg.content)) {
        for (const part of msg.content as any[]) {
          if (part?.type === 'tool-result' && part?.result && typeof part.result === 'object') {
            toolVerdict = String(part.result.verdict || '');
            break;
          }
        }
        if (toolVerdict) break;
      }
    }

    const text =
      toolVerdict === 'missing_premise'
        ? '当前项目还没有形成任何故事构想或待确认提案（尚未启动推演），请先告诉我您想创作的题材、主角或核心冲突。'
        : toolVerdict === 'resume_task_ready'
          ? '收到，已定位刚才中断的任务并为您恢复执行，接下来会沿用原任务记录从上次已完成的步骤继续推进。'
          : toolVerdict === 'missing_task_id'
            ? '当前未能定位需要恢复的目标 taskId，请明确指定要恢复的任务记录。'
            : toolVerdict === 'task_not_found'
              ? '未找到您指定的 taskId 任务记录，请核对当前项目历史任务后再试。'
              : toolVerdict === 'task_already_succeeded'
                ? '该任务已经执行完成，无需重复恢复。'
                : toolVerdict === 'already_running'
                  ? '当前已有任务正在执行中，请等待完成或先停止后再恢复其他任务。'
                  : toolVerdict === 'already_completed'
                    ? '阶段二互动文游已经装配完成，您可以直接在右侧试玩，或告诉我需要局部修改的内容。'
                    : toolVerdict === 'no_pending_approval'
                      ? '当前阶段一策划案已存在，暂无处于挂起待审批状态的阶段推进任务；如需调整请告诉我具体修改意见。'
                      : toolVerdict === 'downgraded_modify_to_start_pipeline'
                        ? '当前尚未立项产出，已将您的设想整理为待确认立项提案，请确认后启动推演。'
                        : '你好！我是中枢路由总控 RouterAgent。我已为您梳理核心设定与冲突张力，随时可以确认下方提议卡片开工，或继续补充细节。';
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
