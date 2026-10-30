import fs from 'fs';
import path from 'path';
import { AgentContext } from '../base/index.js';
import {
  InteractiveStoryGraph,
  StoryNode,
  StoryChoice,
  NarrativeDesignArtifact,
  StorySpineOutput,
  PivotPointsOutput,
} from './types.js';
import { topologyValidator } from './topology-validator.service.js';
import { llmProvider, ChatMessage } from '../../providers/llm.provider.js';
import { loadPromptSafe } from '../../prompts/loader.js';

export class StoryGraphService {
  /**
   * 生成第 3 步交付物：将故事主干大纲与交互矩阵编译为 10 节点的网状互动故事图。
   * Aligns 100% with server/data/examples/stage_1_narrative_spec/03_story_graph.json
   */
  async generateStoryGraph(
    context: AgentContext,
    artifact: NarrativeDesignArtifact,
    userInstruction?: string
  ): Promise<InteractiveStoryGraph> {
    const { session } = context;

    const spine: StorySpineOutput = {
      title: artifact.title || session.title || '互动短剧',
      theme: artifact.theme || session.meta.idea,
      style: artifact.style || session.meta.style,
      logline: artifact.logline || '',
      sellingPoints: artifact.sellingPoints || [],
      goldenSpine: artifact.goldenSpine || [],
    };

    const pivot: PivotPointsOutput | undefined = artifact.pivotPoints as any;

    const systemPrompt = loadPromptSafe('bible', 'compile_story_graph', 'zh');

    const userPrompt = `
【1. 已确立的故事主干原案 (01_story_spine)】：
- 片名：${spine.title}
- 题材：${spine.theme}
- 视觉风格：${spine.style}
- 故事总梗概：${spine.logline}
- 四幕大纲：
${(spine.goldenSpine || []).map((a) => `  * 第 ${a.act} 幕·${a.name} (${a.dramaticFunction}): ${a.summary}`).join('\n')}

【2. 已提取的交互矩阵与分水岭 (02_pivot_points)】：
${pivot ? JSON.stringify(pivot, null, 2) : '遵循标准微交互与分水岭结构'}

${userInstruction ? `【用户调整要求】：\n${userInstruction}\n` : ''}

请立即编译生成严格包含 10 个节点（node_01 ~ node_10）与 10 条分支边（c_01_02 ~ c_06_10）的标准双轨网状故事图 JSON，严禁输出任何多余的 Markdown 标记！
`;

    const messages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ];

    let graph: InteractiveStoryGraph;
    try {
      if (context.audit) {
        graph = await context.audit.trackLlmCall(
          { systemPrompt, userPrompt },
          'qwen-plus',
          () => llmProvider.chatJSON<InteractiveStoryGraph>(messages, 0.7)
        );
      } else {
        graph = await llmProvider.chatJSON<InteractiveStoryGraph>(messages, 0.7);
      }
    } catch (err) {
      console.warn('[StoryGraphService] JSON parse error or call failed, using benchmark fallback:', err);
      graph = this.createFallbackGraph(artifact, spine, pivot);
    }

    // 结构校验与节点自愈
    graph = this.autoHealGraph(graph);

    // 运行数学拓扑质检
    const validation = topologyValidator.validate(graph);
    graph.validation = validation;

    // 导出 03_story_graph.json 到项目 narrative/ 目录
    this.exportJson(context.projectDir, graph);

    return graph;
  }

  /**
   * 将互动网状图数据导出为 narrative/03_story_graph.json
   */
  exportJson(projectDir: string, graph: InteractiveStoryGraph): void {
    try {
      const narrativeDir = path.join(projectDir, 'narrative');
      fs.mkdirSync(narrativeDir, { recursive: true });
      fs.writeFileSync(path.join(narrativeDir, '03_story_graph.json'), JSON.stringify(graph, null, 2), 'utf-8');
    } catch (err) {
      console.warn('[StoryGraphService] Failed to export 03_story_graph.json:', err);
    }
  }

  /**
   * 互动网状拓扑图的确定性自愈修复算法：
   * 1. 自动检测叶子节点（出度为0），依据语义修正其 type 为 'bad_end' 或 'true_end'，彻底消除死锁。
   * 2. 自动检测收束节点（入度>1），若为普通剧情则标记为 'converge'。
   * 3. 自动检测决策节点（出度>1），若为普通剧情则标记为 'decision'。
   */
  public autoHealGraph(graph: InteractiveStoryGraph): InteractiveStoryGraph {
    if (!graph || !graph.nodes || graph.nodes.length === 0) return graph;

    const outgoing = new Map<string, string[]>();
    const incoming = new Map<string, string[]>();

    for (const node of graph.nodes) {
      outgoing.set(node.id, []);
      incoming.set(node.id, []);
    }

    for (const choice of (graph.choices || [])) {
      if (outgoing.has(choice.fromNodeId)) {
        outgoing.get(choice.fromNodeId)!.push(choice.toNodeId);
      }
      if (incoming.has(choice.toNodeId)) {
        incoming.get(choice.toNodeId)!.push(choice.fromNodeId);
      }
    }

    for (const node of graph.nodes) {
      const out = outgoing.get(node.id) || [];
      const inCount = (incoming.get(node.id) || []).length;
      const title = (node.title || '').toLowerCase();
      const summary = (node.summary || '').toLowerCase();

      // 情况 1：叶子节点（出度为 0）
      if (out.length === 0) {
        if (node.type !== 'bad_end' && node.type !== 'true_end') {
          const isBad =
            title.includes('坏结局') ||
            title.includes('死亡') ||
            title.includes('失败') ||
            title.includes('格式化') ||
            title.includes('沦陷') ||
            title.includes('永续') ||
            summary.includes('坏结局') ||
            summary.includes('死亡') ||
            summary.includes('失败') ||
            summary.includes('覆灭');

          if (isBad) {
            node.type = 'bad_end';
          } else {
            node.type = 'true_end';
          }
        }
      } else {
        // 非叶子节点不能是终端结局
        if (node.type === 'bad_end' || node.type === 'true_end') {
          node.type = 'story';
        }

        // 多出度节点标为决策点
        if (out.length > 1 && node.type !== 'qte' && node.type !== 'investigation') {
          node.type = 'decision';
        } else if (inCount > 1 && node.type === 'story') {
          // 多入度节点标为收束点
          node.type = 'converge';
        }
      }
    }

    return graph;
  }

  private createFallbackGraph(
    artifact: any,
    spine?: StorySpineOutput,
    pivot?: PivotPointsOutput
  ): InteractiveStoryGraph {
    const chars = (artifact.characters || []).map((c: any) => c.name);
    const mainChar = chars[0] || '主角';
    const allyChar = chars[1] || '盟友';
    const villainChar = chars[2] || '反派';

    const hot = pivot?.microInteractions?.hotspotsInspection?.items || [];
    const evidenceItem = pivot?.microInteractions?.evidencePresentation?.requiredItem || '关键物证';

    const graph: InteractiveStoryGraph = {
      startNodeId: 'node_01',
      systems: {
        affinity: { [allyChar]: 0, [villainChar]: 0 },
        inventory: [],
        flags: { ally_trusted: false, counter_injected: false },
      },
      nodes: [
        {
          id: 'node_01',
          type: 'investigation',
          interactionMode: 'hotspot_inspection',
          title: `第1幕: 现场苏醒与点触搜证`,
          summary: `${mainChar} 在初始危机现场惊醒，通过场景 3 处搜查点收集证物。`,
          location: '废弃核心设施',
          characters: [mainChar],
          estimatedDurationSec: 20,
          hotspots: hot.length > 0 ? hot : [
            { id: 'spot_1', label: '检查自身伤势', clueReward: '身体受损记录' },
            { id: 'spot_2', label: '搜查现场暗格', itemReward: evidenceItem },
            { id: 'spot_3', label: '读取监控残片', clueReward: '敌方残影代码' },
          ],
        },
        {
          id: 'node_02',
          type: 'decision',
          interactionMode: 'comm_call_and_choice',
          title: `第2幕: 接头与阵营抉择`,
          summary: `逃亡途中收到 ${allyChar} 的紧急通信，随后在隐蔽处碰头，面临信任与手段的分水岭抉择。`,
          location: '地下秘密通道',
          characters: [mainChar, allyChar],
          estimatedDurationSec: 22,
          commMessage: pivot?.microInteractions?.commCall || {
            sender: allyChar,
            audioSnippet: '别走主路，敌方已封锁前路！',
            quickReaction: ['质疑反问', '求助配合'],
          },
        },
        {
          id: 'node_03',
          type: 'story',
          interactionMode: 'cinematic',
          title: `同盟渗透线`,
          summary: `选择信任 ${allyChar}，两人协同潜入核心安全署。`,
          location: '通风管道与同盟密道',
          characters: [mainChar, allyChar],
          estimatedDurationSec: 15,
        },
        {
          id: 'node_04',
          type: 'story',
          interactionMode: 'cinematic',
          title: `孤狼强突线`,
          summary: `拒绝妥协，${mainChar} 孤身一人过载安保强攻突入。`,
          location: '外围管井与防爆闸门',
          characters: [mainChar],
          estimatedDurationSec: 15,
        },
        {
          id: 'node_05',
          type: 'decision',
          interactionMode: 'evidence_present_qte',
          title: `第3幕: 审查交锋与证物对质`,
          summary: `直面 ${villainChar}，玩家从行囊甩出【${evidenceItem}】戳穿谎言！随后面临生死 QTE。`,
          location: '主控审讯大厅',
          characters: [mainChar, villainChar],
          estimatedDurationSec: 25,
          evidencePresent: {
            requiredItem: evidenceItem,
            promptText: `拖拽【${evidenceItem}】砸向反派屏幕戳穿谎言！`,
            successFeedback: '谎言当场被戳穿，反派防线崩解！',
          },
        },
        {
          id: 'node_06',
          type: 'decision',
          interactionMode: 'climax_decision',
          title: `第4幕: 终极大决胜`,
          summary: `反派启动全盘肃清，${mainChar} 杀入终极中枢，面临决定全员命运的三重抉择！`,
          location: '终极中枢控制台',
          characters: [mainChar, villainChar],
          estimatedDurationSec: 25,
        },
        {
          id: 'node_07',
          type: 'bad_end',
          interactionMode: 'ending',
          title: `💀 结局1: 惨烈即死 (Bad End)`,
          summary: `抉择失误或挂机超时，${mainChar} 彻底丧失生机，沦为悲剧牺牲品。`,
          location: '行刑室 / 陷阱现场',
          characters: [mainChar],
          estimatedDurationSec: 10,
        },
        {
          id: 'node_08',
          type: 'true_end',
          interactionMode: 'ending',
          title: `🏆 结局2: 正统破局 (True End)`,
          summary: `大义救赎与公道昭雪，彻底摧毁反派阴谋，达成官方圆满结局。`,
          location: '黎明地平线',
          characters: [mainChar, allyChar],
          estimatedDurationSec: 15,
        },
        {
          id: 'node_09',
          type: 'true_end',
          interactionMode: 'ending',
          title: `🌟 结局3: 隐藏超脱 (Secret End)`,
          summary: `打破凡俗因果枷锁，成为主宰全新秩序的无上存在。`,
          location: '超维未知领域',
          characters: [mainChar],
          estimatedDurationSec: 15,
        },
        {
          id: 'node_10',
          type: 'true_end',
          interactionMode: 'ending',
          title: `🔁 结局4: 莫比乌斯轮回 (Time Loop)`,
          summary: `自我封印重启因果，留下关键线索道具跳回起点开启二周目！`,
          location: '因果轮回起点',
          characters: [mainChar],
          estimatedDurationSec: 12,
        },
      ],
      choices: [
        {
          id: 'c_01_02',
          fromNodeId: 'node_01',
          toNodeId: 'node_02',
          choiceText: '搜证完毕，循着信号前往接头地点',
          timeoutSeconds: 8,
          isTimeoutDefault: true,
        },
        {
          id: 'c_02_03',
          fromNodeId: 'node_02',
          toNodeId: 'node_03',
          choiceText: `【同盟线】选择信任 ${allyChar}，协同潜入`,
          timeoutSeconds: 7,
          isTimeoutDefault: false,
          effects: {
            affinityDelta: { [allyChar]: 25 },
            gainItems: ['同盟反制密钥'],
            setFlags: { ally_trusted: true },
          },
        },
        {
          id: 'c_02_04',
          fromNodeId: 'node_02',
          toNodeId: 'node_04',
          choiceText: '【孤狼线】拒绝妥协，强攻独行',
          timeoutSeconds: 6,
          isTimeoutDefault: true,
          effects: {
            affinityDelta: { [allyChar]: -20 },
            gainItems: ['强攻破拆器'],
          },
        },
        {
          id: 'c_03_05',
          fromNodeId: 'node_03',
          toNodeId: 'node_05',
          choiceText: '沿同盟隐蔽通路潜入审查中心',
          timeoutSeconds: 8,
          isTimeoutDefault: true,
        },
        {
          id: 'c_04_05',
          fromNodeId: 'node_04',
          toNodeId: 'node_05',
          choiceText: '破拆通风管道强行突入审查现场',
          timeoutSeconds: 8,
          isTimeoutDefault: true,
        },
        {
          id: 'c_05_06',
          fromNodeId: 'node_05',
          toNodeId: 'node_06',
          choiceText: '【智斗反抗】假意顺从，暗中向反派注入逻辑木马',
          timeoutSeconds: 6,
          isTimeoutDefault: false,
          effects: { setFlags: { counter_injected: true } },
        },
        {
          id: 'c_05_07',
          fromNodeId: 'node_05',
          toNodeId: 'node_07',
          choiceText: '【超时屈服】放弃抵抗，全盘认受制裁',
          timeoutSeconds: 5,
          isTimeoutDefault: true,
        },
        {
          id: 'c_06_08',
          fromNodeId: 'node_06',
          toNodeId: 'node_08',
          choiceText: '【大义救赎】启动破局程序，拯救众生',
          timeoutSeconds: 10,
          isTimeoutDefault: false,
        },
        {
          id: 'c_06_09',
          fromNodeId: 'node_06',
          toNodeId: 'node_09',
          choiceText: '【超越升维】解构肉身，化身主宰',
          timeoutSeconds: 10,
          isTimeoutDefault: false,
        },
        {
          id: 'c_06_10',
          fromNodeId: 'node_06',
          toNodeId: 'node_10',
          choiceText: '【重置轮回】封印记忆，重启莫比乌斯循环',
          timeoutSeconds: 8,
          isTimeoutDefault: true,
          effects: { gainItems: ['二周目继承信物'] },
        },
      ],
    };

    graph.validation = topologyValidator.validate(graph);
    return graph;
  }
}

export const storyGraphService = new StoryGraphService();
