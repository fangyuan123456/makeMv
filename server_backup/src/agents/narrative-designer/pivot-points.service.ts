import fs from 'fs';
import path from 'path';
import { AgentContext } from '../base/index.js';
import {
  StorySpineOutput,
  PivotPointsOutput,
  MacroPivotPoint,
  MicroInteractionsSpec,
} from './types.js';
import { llmProvider, ChatMessage } from '../../providers/llm.provider.js';
import { loadPromptSafe } from '../../prompts/loader.js';

export class PivotPointsService {
  /**
   * 生成第 2 步交付物：宏观与微观交互矩阵 (02_pivot_points)。
   * Aligns 100% with server/data/examples/stage_1_narrative_spec/02_pivot_points.md
   */
  async extractPivotPoints(
    context: AgentContext,
    spine: StorySpineOutput,
    userInstruction?: string
  ): Promise<PivotPointsOutput> {
    const systemPrompt = loadPromptSafe('bible', 'extract_pivot_points', 'zh');

    const userPrompt = `
【已确立的故事主干原案 (The Golden Spine)】：
- 片名：${spine.title}
- 题材：${spine.theme}
- 视觉风格：${spine.style}
- 故事总梗概 (Logline)：${spine.logline}
- 核心商业与互动卖点：
${(spine.sellingPoints || []).map((sp) => `  * ${sp}`).join('\n')}
- 黄金四幕戏剧大纲：
${(spine.goldenSpine || []).map((a) => `  * 第 ${a.act} 幕·${a.name} (${a.dramaticFunction}): ${a.summary}\n    冲突: ${a.coreConflict}\n    卡点: ${a.cliffhanger}`).join('\n')}

${userInstruction ? `【用户补充特别要求】：\n${userInstruction}\n` : ''}

请严格基于上述黄金主干，提取并输出完整合法的纯 JSON 格式交互矩阵与三大戏剧分水岭（包含 microInteractions 与 macroPivotPoints，分水岭2必须明确包含超时/放弃导致的 Bad End 走向）。
`;

    const messages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ];

    let pivotOutput: PivotPointsOutput;
    try {
      if (context.audit) {
        pivotOutput = await context.audit.trackLlmCall(
          { systemPrompt, userPrompt },
          'qwen-plus',
          () => llmProvider.chatJSON<PivotPointsOutput>(messages, 0.7)
        );
      } else {
        pivotOutput = await llmProvider.chatJSON<PivotPointsOutput>(messages, 0.7);
      }
    } catch (err) {
      console.warn('[PivotPointsService] LLM call or JSON parsing failed, using fallback:', err);
      pivotOutput = this.getBenchmarkFallback(spine);
    }

    if (!pivotOutput.macroPivotPoints || pivotOutput.macroPivotPoints.length === 0) {
      pivotOutput.macroPivotPoints = this.getBenchmarkFallback(spine).macroPivotPoints;
    }

    // 导出 02_pivot_points.md 文件
    this.exportMarkdown(context.projectDir, pivotOutput);

    return pivotOutput;
  }

  /**
   * 将交互分支点数据导出并持久化保存为 02_pivot_points.md。
   */
  exportMarkdown(projectDir: string, data: PivotPointsOutput): string {
    const md = this.formatToMarkdown(data);
    try {
      const narrativeDir = path.join(projectDir, 'narrative');
      fs.mkdirSync(narrativeDir, { recursive: true });
      fs.writeFileSync(path.join(narrativeDir, '02_pivot_points.md'), md, 'utf-8');
    } catch (err) {
      console.warn('[PivotPointsService] Failed to export 02_pivot_points.md:', err);
    }
    return md;
  }

  /**
   * 将 JSON 数据结构格式化为符合规范的易读 Markdown 文档。
   */
  formatToMarkdown(data: PivotPointsOutput): string {
    const micro = data.microInteractions;
    let md = `# 《${data.title}》交互形式矩阵 (Macro & Micro Interactions)\n\n`;
    md += `> **定位**: 定义本作中“宏观剧情分支（走哪条路）”与“沉浸式轻交互（摸什么、搜什么、怎么聊）”的完整交互体系。\n`;
    md += `> **设计哲学**: 用“不分叉的微交互”丰富手感与代入感（零额外视频成本），用“分水岭抉择”决定重大命运走向。\n\n`;
    md += `---\n\n`;

    md += `## 🎮 第一部分：不影响大剧情的【沉浸式微交互】(零视频分支成本)\n\n`;

    // 1. Hotspots
    if (micro.hotspotsInspection) {
      const h = micro.hotspotsInspection;
      md += `### 1. 场景点触搜证 (Hotspot Inspection) —— 置于第 ${h.actNumber || 1} 幕\n`;
      md += `- **触发情境**: ${h.context}\n`;
      md += `- **界面表现**: 画面定格为全景，场景中浮现 3 处带微光的呼吸热点圈：\n`;
      for (let i = 0; i < (h.items || []).length; i++) {
        const item = h.items[i];
        md += `  - **热点 ${i + 1} [${item.label}]**:\n`;
        md += `    - *交互动作*: ${item.action || '点击光点'}\n`;
        md += `    - *视听反馈*: ${item.feedback}`;
        if (item.itemReward) md += `，屏幕角落提示：*🎒 获得核心证物：【${item.itemReward}】*`;
        if (item.clueReward) md += `，解锁情报线索：*🔍【${item.clueReward}】*`;
        md += `\n`;
      }
      md += `- **收益**: 玩家亲手搜集线索，完全不增加分支视频成本，代入感拉满！\n\n`;
      md += `---\n\n`;
    }

    // 2. Comm Call
    if (micro.commCall) {
      const c = micro.commCall;
      md += `### 2. 拟真即时通讯 (Cyberpunk Comm / Phone OS) —— 置于第 ${c.actNumber || 2} 幕\n`;
      md += `- **触发情境**: ${c.context}\n`;
      md += `- **界面表现**: 弹出即时通讯悬浮窗与音频波动震动条：\n`;
      md += `  - **来电人**: \`${c.caller}\`\n`;
      md += `  - **对方语音**: “${c.incomingDialog}”\n`;
      md += `  - **玩家轻交互**: 弹出 3 秒快速态度气泡：\n`;
      for (const r of c.quickReactions || []) {
        md += `    \`[${r}]\`\n`;
      }
      md += `- **收益**: 强化紧迫感，塑造第一视角临场感，直接切入后续主线。\n\n`;
      md += `---\n\n`;
    }

    // 3. Emotional Reaction Wheel
    if (micro.emotionalReaction) {
      const e = micro.emotionalReaction;
      md += `### 3. 态度微反应轮盘 (Emotional Reaction Wheel) —— 置于第 ${e.actNumber || 3} 幕初\n`;
      md += `- **触发情境**: ${e.context}\n`;
      md += `- **对方质问**: “${e.confrontationPrompt}”\n`;
      md += `- **界面表现**: 3 秒倒计时圆环，提供 3 种性格态度倾向：\n`;
      for (const opt of e.options || []) {
        md += `  - \`[${opt.label} (${opt.attitude})]\`：${opt.reaction}\n`;
      }
      md += `- **收益**: 极佳的角色塑造，后续主线完全不被打乱，但主角说出了玩家心中想说的话。\n\n`;
      md += `---\n\n`;
    }

    // 4. Evidence Presentation
    if (micro.evidencePresentation) {
      const ev = micro.evidencePresentation;
      md += `### 4. 背包证物对质 (Evidence Presentation) —— 置于第 ${ev.actNumber || 3} 幕决战前夕\n`;
      md += `- **触发情境**: ${ev.context}\n`;
      md += `- **界面表现**: 屏幕并不弹出普通文字选项，而是弹出清脆提示音，打开玩家背包：\n`;
      md += `  - 玩家在限时内点击并拖拽背包中的【${ev.requiredItem}】，甩在反派面前！\n`;
      md += `  - *视听反馈*: ${ev.successFeedback}\n`;
      md += `  - *失误惩罚*: ${ev.failPunishment}\n\n`;
      md += `---\n\n`;
    }

    // 第二部分：宏观关键博弈决策点
    md += `## ⚡ 第二部分：决定命运走向的【核心戏剧分水岭】(重大剧情分支)\n\n`;

    for (const p of data.macroPivotPoints || []) {
      md += `### ⚡ ${p.name}（第 ${p.actNumber} 幕）\n`;
      md += `- **绝境抉择**: ${p.dramaticDilemma}\n`;
      md += `- **形式**: 限时 ${p.timeoutSeconds || 6} 秒高压抉择。\n`;
      for (const b of p.branches || []) {
        md += `  - **${b.choiceText}**: ${b.dramaticOutcome}`;
        if (b.isBadEnd) md += ` **(Bad End)**`;
        if (b.isTrueEnd) md += ` **(True End)**`;
        if (b.isTimeoutDefault) md += ` *(挂机超时默认路径)*`;
        md += `\n`;
      }
      md += `\n`;
    }

    return md;
  }

  /**
   * 基于当前故事主干大纲的标准基准兜底数据。
   */
  private getBenchmarkFallback(spine: StorySpineOutput): PivotPointsOutput {
    return {
      title: spine.title,
      microInteractions: {
        hotspotsInspection: {
          actNumber: 1,
          context: '主角在初始现场惊醒，周围弥漫危机信号。',
          items: [
            {
              id: 'spot_1',
              label: '检查自身伤势与接口',
              action: '点击伤痕处',
              feedback: '触及物理熔损痕迹，确认自身关键机能受阻。',
              clueReward: '物理受损数据',
            },
            {
              id: 'spot_2',
              label: '搜查现场核心死者/暗格',
              action: '点击暗格',
              feedback: '搜出一枚刻有暗号的核心证物！',
              itemReward: '核心密信残片',
            },
            {
              id: 'spot_3',
              label: '调取受损监控/残痕',
              action: '点击终端',
              feedback: '捕捉到一闪而过的敌方高维残影。',
              clueReward: '神秘代号残影',
            },
          ],
        },
        commCall: {
          actNumber: 2,
          caller: '神秘线人·加密频段',
          context: '潜行过程中突发脑机通信',
          incomingDialog: '别走主路，敌方无人哨戒已封死前路！',
          quickReactions: ['回怼: 凭什么信你?', '求助: 逃生路线在哪?'],
        },
        emotionalReaction: {
          actNumber: 3,
          context: '直面核心反派审讯',
          confrontationPrompt: '你以为凭你一人就能逆转定局吗？',
          options: [
            { label: '冷笑反讽', attitude: '冷漠挑衅', reaction: '“至少我没出卖自己的灵魂。”' },
            { label: '紧握双拳', attitude: '隐忍克制', reaction: '沉默不语，心跳急剧加速。' },
            { label: '针锋相对', attitude: '正气反问', reaction: '“那被你牺牲的无辜者算什么？！”' },
          ],
        },
        evidencePresentation: {
          actNumber: 3,
          context: '反派试图以谎言掩盖阴谋真相',
          requiredItem: '核心密信残片',
          actionPrompt: '1秒内从背包拖拽甩出证物！',
          successFeedback: '证物当面砸破全息屏，铁证如山，反派脸色骤变！',
          failPunishment: '错过出示时机，反派直接启动强行压制！',
        },
      },
      macroPivotPoints: [
        {
          pivotId: 'pivot_1',
          actNumber: 2,
          name: '分水岭 1：阵营信任生死考验',
          dramaticDilemma: '线人要求开放底层权限以验证身份。',
          timeoutSeconds: 8,
          branches: [
            {
              choiceText: '【同盟线】开放信任权限',
              targetPath: '地下同盟线',
              dramaticOutcome: '获得反制密钥，两人协同渗透。',
              effects: { gainItems: ['反制密钥'] },
            },
            {
              choiceText: '【孤狼线】暴力拒绝强夺装备',
              targetPath: '孤狼独行线',
              dramaticOutcome: '孤身一人强攻，失去同盟掩护。',
              isTimeoutDefault: true,
            },
          ],
        },
        {
          pivotId: 'pivot_2',
          actNumber: 3,
          name: '分水岭 2：审查交锋与生死 QTE',
          dramaticDilemma: '致命探针悬停在额前，反派展开最终洗脑。',
          timeoutSeconds: 6,
          branches: [
            {
              choiceText: '【智斗反抗】假意顺从暗中注入木马',
              targetPath: '智斗破局',
              dramaticOutcome: '成功反客为主，直捣终极中枢！',
            },
            {
              choiceText: '【全盘屈服 / 超时】意识彻底被抹除',
              targetPath: '即死出局',
              dramaticOutcome: '💀 结局1: 沦为无意识清道夫傀儡 (Bad End)',
              isBadEnd: true,
              isTimeoutDefault: true,
            },
          ],
        },
        {
          pivotId: 'pivot_3',
          actNumber: 4,
          name: '分水岭 3：终幕宿命三重拷问',
          dramaticDilemma: '站在终极中枢控制台前，面临决定全员命运的选择。',
          timeoutSeconds: 10,
          branches: [
            {
              choiceText: '【大义救赎】唤醒全员打破枷锁',
              targetPath: '官方结局',
              dramaticOutcome: '🏆 结局2: 众生觉醒革命 (True End)',
              isTrueEnd: true,
            },
            {
              choiceText: '【升维超越】抛弃肉身融为新主宰',
              targetPath: '隐藏结局',
              dramaticOutcome: '🌟 结局3: 飞升无上神明 (Secret End)',
              isTrueEnd: true,
            },
            {
              choiceText: '【莫比乌斯轮回】彻底格式化自身重启封印',
              targetPath: '时间循环',
              dramaticOutcome: '🔁 结局4: 莫比乌斯因果回溯 (Time Loop)',
              effects: { gainItems: ['轮回信物'] },
              isTrueEnd: true,
              isTimeoutDefault: true,
            },
          ],
        },
      ],
    };
  }
}

export const pivotPointsService = new PivotPointsService();
