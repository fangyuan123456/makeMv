/**
 * llm/MockLLMService.ts
 * 离线高保真大模型模拟服务 (支持单元测试沙箱与确定性推演)
 */

import type { LLMService, LLMOptions } from './LLMService.js';

export class MockLLMService implements LLMService {
  private customHandlers: Map<string, (prompt: string, schema: any, options?: LLMOptions) => any> = new Map();
  private customStageData: Map<string, any> = new Map();

  public hasVisionCapability(): boolean {
    return true;
  }

  /**
   * 注册指定阶段的自定义数据桩 (覆盖默认推演产物)
   */
  public setStageData(stage: string, data: any): void {
    this.customStageData.set(stage, data);
  }

  /**
   * 注册指定阶段的动态生成处理器
   */
  public setStageHandler(stage: string, handler: (prompt: string, schema: any, options?: LLMOptions) => any): void {
    this.customHandlers.set(stage, handler);
  }

  /**
   * 清理所有自定义桩与处理器
   */
  public resetCustomHandlers(): void {
    this.customHandlers.clear();
    this.customStageData.clear();
  }

  public async generateText(prompt: string, systemPrompt?: string, options?: LLMOptions): Promise<string> {
    const stage = options?.stage;
    if (stage && this.customStageData.has(stage)) {
      const data = this.customStageData.get(stage);
      return typeof data === 'string' ? data : JSON.stringify(data);
    }
    return JSON.stringify({ success: true, message: 'Mock LLM Response' });
  }

  public async generateObject<T>(
    prompt: string,
    schema: any,
    systemPrompt?: string,
    options?: LLMOptions
  ): Promise<T> {
    const stage = options?.stage;

    // 1. 优先使用自定义 handler
    if (stage && this.customHandlers.has(stage)) {
      const handler = this.customHandlers.get(stage)!;
      return handler(prompt, schema, options) as T;
    }

    // 2. 其次使用注入的 stageData
    if (stage && this.customStageData.has(stage)) {
      return this.customStageData.get(stage) as T;
    }

    // 3. 针对故事圣经 (StoryBible) 四大阶段提供确定性真实结构产物
    if (stage === 'story_spine') {
      return {
        title: '命运齿轮',
        theme: '自由意志与宿命抉择',
        style: '电影质感，蒸汽朋克与复古光影',
        logline: '钟表匠学徒阿诺偶然发现一枚能够逆转时间三分钟的古老怀表，卷入帝国钟楼的连环谋杀案中。',
        sellingPoints: ['时空微观循环解谜', '多线收束道德两难', '蒸汽朋克工业美学'],
        goldenSpine: [
          {
            act: 1,
            name: '开端：怀表遗失与宿命危机',
            summary: '帝国中央钟楼爆炸，师傅重伤垂危，阿诺在维修台上发现滴血的逆光怀表，指针竟开始逆行。',
            targetDurationSec: 60,
            cliffhanger: '怀表底盖刻着阿诺未来的笔迹：“不要相信大主教”。',
          },
          {
            act: 2,
            name: '中段：迷局穿梭与同门反目',
            summary: '阿诺凭借逆光怀表数次重回刺杀现场，却发现暗中操纵机械傀儡的元凶竟是挚友雷恩。',
            targetDurationSec: 90,
            cliffhanger: '大主教启动全城发条结界，全城居民心跳与中央时钟强制共振。',
          },
          {
            act: 3,
            name: '高潮与终局：打破永恒齿轮',
            summary: '在钟楼千米齿轮顶层，阿诺面临彻底砸碎核心齿轮还是牺牲自我融入时间熔炉的终极抉择。',
            targetDurationSec: 60,
            cliffhanger: '指针归零，世界迎来全新的破晓或永夜。',
          },
        ],
      } as T;
    }

    if (stage === 'pivot_points') {
      return {
        macroPivotPoints: [
          {
            id: 'pivot_1',
            act: 1,
            decisionMoment: '追击潜入师傅工坊的黑衣人，还是留下止血抢救师傅？',
            choices: [
              {
                choiceId: 'choice_1',
                text: '立刻启动怀表追击凶手',
                dramaticImpact: '提前截获凶手遗落的发条密钥，但师傅伤重陷入深度昏迷',
                targetAct: 2,
              },
              {
                choiceId: 'choice_2',
                text: '放弃追击，优先止血抢救',
                dramaticImpact: '师傅临终前道出钟楼最高权限密码，但凶手从容销毁了现场关键物证',
                targetAct: 2,
              },
            ],
          },
        ],
        microPivotPoints: [
          {
            id: 'micro_1',
            sceneName: '钟表工坊操作台',
            interactiveMechanic: '齿轮啮合校准 (QTE)',
            feedback: '指针咔哒归位，发出清脆发条嗡鸣',
          },
        ],
      } as T;
    }

    if (stage === 'story_graph') {
      return {
        rootNodeId: 'node_1',
        endingsCount: 2,
        estimatedBranches: 3,
        nodes: [
          {
            id: 'node_1',
            act: 1,
            title: '钟表工坊黎明',
            summary: '工坊内满地发条碎片，阿诺惊觉师傅倒在血泊中，神秘怀表闪烁微光。',
            location: '帝国下城区钟表工坊',
            characterNames: ['学徒阿诺', '工匠师傅托马斯'],
            isEnding: false,
            choices: [
              {
                targetNodeId: 'node_2',
                text: '逆转时间追击黑衣刺客',
                dramaticTension: '秒针倒走，空间开始玻璃样碎裂',
              },
              {
                targetNodeId: 'node_3',
                text: '止血抢救托马斯师傅',
                dramaticTension: '生死竞速，每秒钟都是师傅微弱的脉搏',
              },
            ],
          },
          {
            id: 'node_2',
            act: 2,
            title: '雾夜小巷追踪',
            summary: '阿诺在雨夜石板路上堵住刺客，揭开面罩发现竟是同门挚友雷恩。',
            location: '下城区发条回廊',
            characterNames: ['学徒阿诺', '雷恩'],
            isEnding: false,
            choices: [
              {
                targetNodeId: 'node_4',
                text: '拔刀与挚友对决，夺回核心齿轮',
                dramaticTension: '同门手足相残，火花四溅',
              },
            ],
          },
          {
            id: 'node_3',
            act: 2,
            title: '师傅的临终遗言',
            summary: '托马斯师傅握住阿诺的手，将帝国钟楼的暗门钥匙塞入阿诺掌心后闭上双眼。',
            location: '钟表工坊内室',
            characterNames: ['学徒阿诺', '工匠师傅托马斯'],
            isEnding: false,
            choices: [
              {
                targetNodeId: 'node_4',
                text: '登上钟楼暗门正面迎敌',
                dramaticTension: '背负师傅血仇与帝国命运登顶',
              },
            ],
          },
          {
            id: 'node_4',
            act: 3,
            title: '破晓钟声 (正义终局)',
            summary: '阿诺将怀表插入中央轴心，逆转了灾难发条，阳光重新洒满机械帝都。',
            location: '中央钟楼千米天台',
            characterNames: ['学徒阿诺', '大主教埃德温'],
            isEnding: true,
            endingType: 'good',
            choices: [],
          },
        ],
      } as T;
    }

    if (stage === 'character_profiles') {
      return {
        characters: [
          {
            name: '学徒阿诺',
            role: '男主角',
            gender: '男',
            age: 19,
            appearance: '右眼佩戴黄铜三联放大镜，深棕色凌乱短发，身穿满是齿轮油渍的牛皮工装背带裤与深蓝亚麻衬衫。',
            personality: '心细敏锐，执着坚韧，对机械机理极度痴迷，在绝境中具有孤注一掷的爆发力。',
            motivation: '解开父亲与师傅遗留的时间机关之谜，守护钟表帝都无辜的平民。',
            arc: '从懵懂求知的工坊小学徒，成长为肩负文明时间存亡的终极守钟人。',
            visualPromptKeywords: ['蒸汽朋克少年', '黄铜放大单片眼镜', '工装皮革背带裤', '专注坚毅眼神', '微距齿轮光影'],
          },
          {
            name: '雷恩',
            role: '对立面挚友',
            gender: '男',
            age: 21,
            appearance: '左臂为精密的蒸汽银制机械义肢，黑色高领防风风衣，眼神冰冷带着伤痕。',
            personality: '理性决绝，认为停滞的世界必须通过残酷的重构方能新生。',
            motivation: '夺取时间怀表复活死于大火的妹妹。',
            arc: '在执念与亲情的折磨中逐渐走向机械异化。',
            visualPromptKeywords: ['银质机械手臂', '黑色高领大衣', '冷酷英俊', '蒸汽烟雾弥漫'],
          },
        ],
      } as T;
    }

    if (stage?.startsWith('critic_audit')) {
      return {
        projectName: '测试项目',
        stageReviewed: stage,
        thoughtChain: '审查官思维链：全链路资产因果逻辑推演完成。',
        crossStageInsights: {
          characterConsistency: '角色动机一致',
          branchValidity: '分支具备有效戏剧代价',
          visualFeasibility: '视听画面具可拍性',
        },
        gateStatus: 'PASS',
        scores: {
          narrativeLogicScore: 88,
          characterDepthScore: 85,
          branchTensionScore: 82,
          visualFeasibilityScore: 86,
          overallScore: 85,
        },
        criticalFlaws: [],
        polishSuggestions: ['建议进一步丰富高潮场景的光影反差'],
        verdict: '全剧因果严密，准许放行。',
      } as T;
    }

    if (stage === 'director_router_decision') {
      return {
        thought: '创作者提出了关于故事世界观构建的设想，建议启动故事圣经工具进行推演。',
        reply: '收到您的创作构想！我已为您规划好黄金三幕与剧情网状分支，建议执行故事圣经工序。',
        intent: 'PROPOSE_ACTION',
        proposal: {
          skill: 'story-bible',
          actionType: 'FULL_GENERATION',
          label: '生成故事世界观与剧情拓扑圣经',
          description: '推演网状剧情分支、主角小传与黄金三幕戏剧骨架',
          targetStage: 'narrative_design',
          payload: { idea: '探索记忆碎片' },
        },
      } as T;
    }

    return {} as T;
  }

  public async generateTextWithImages(
    prompt: string,
    images: string[],
    systemPrompt?: string,
    options?: LLMOptions
  ): Promise<string> {
    return JSON.stringify({ passed: true, score: 95, issues: [] });
  }

  public async generateMultiTurn(
    systemPrompt: string,
    history: Array<{ role: 'user' | 'assistant'; content: string }>,
    options?: LLMOptions
  ): Promise<string> {
    return JSON.stringify({
      thought: 'Mock multi-turn finished',
      tool: 'finish',
      args: { summary: 'Mock execution completed successfully.' },
    });
  }

  public async generateMultiTurnStream(
    systemPrompt: string,
    history: Array<{ role: 'user' | 'assistant'; content: string }>,
    onToken: (token: string) => Promise<void> | void,
    options?: LLMOptions
  ): Promise<string> {
    const text = '【AI导演】：收到您的创作指示，我已基于当前视听语境完成阶段推敲。';
    await onToken(text);
    return text;
  }
}
