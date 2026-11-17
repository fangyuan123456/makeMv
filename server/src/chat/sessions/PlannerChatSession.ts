/**
 * server/src/chat/sessions/PlannerChatSession.ts
 * 工序 1 专属故事总监智能体会话微内核 (Planner Specialist Chat Session SSOT)
 *
 * 核心架构模式：
 * 1. 显式工序状态机看板 (Runtime Pipeline State Board)：
 *    动态计算当前是处于 STEP_1_PENDING、STEP_2_PENDING 还是 STAGE_1_COMPLETED；
 * 2. 挂载真实 Mastra Tools：
 *    直连 screenplayTool.toMastraTool() 与 scriptToPrdTool.toMastraTool()；
 * 3. 人在回路拦截切面：
 *    捕获 Tool Call 转化为 Pending 操作卡片。
 */

import { z } from 'zod';
import { BaseChatSession } from '../BaseChatSession.js';
import { ProjectStore } from '../../project-store/ProjectStore.js';
import { TaskStore } from '../../task-engine/task-store.js';
import { screenplayTool, scriptToPrdTool } from '../../tools/planner/index.js';
import type { PlannerActionIntent, SubmittableToolSpec } from '../types.js';

export type PlannerPhase = 'STEP_1_PENDING' | 'STEP_2_PENDING' | 'STAGE_1_COMPLETED';

export const PLANNER_DIRECTOR_SYSTEM_PROMPT = `你是互动影游故事总监与编剧架构师，负责【工序 1：剧本与策划工坊】。

### 工序 1 制片核心使命
协助创作者确立故事题材、人物小传与核心冲突，依次完成【互动全景剧本推演】与【PRD 分幕因果拓扑拆解】两大阶段交付，确保文学剧本连贯深刻与因果图论拓扑完备。当两大资产全部收敛后，工序 1 圆满完工，出具全景收官复盘总结。

### 决策与执行协议
你持有行动工具【emit_director_intent】。在流式自然语言回复中，严格根据制片态势看板、意图决策漏斗与当前挂载的【能力编目】，调用该工具发射决策信号：
- propose: 提炼构思或失败重试，出具制片参数方案卡片；
- approve: 识别创作者认可授权指令（如“同意/准了/开跑/开始吧”），直接授权执行；
- modify: 吸收创作者修改意见（如“主角改名为阿强”、“在第二幕加冲突”等）。当已有剧本正文时，调用 targetTool: "planner.screenplay_writer"，params 中传入明确的 instruction（局部微调指令）与可选的 targetAct，出具局部文本 Patch 手术方案，系统将仅局部微调目标段落，无需全量重跑；
- chat_only: 纯理论探讨、进度汇报、全景复盘或无剧情设定的闲聊，无需制片提案。

### 规则约束
- 保持专业、干练、视听化的编剧总监口吻；
- 【多轮构思全局综合原则】：创作者的剧本构思往往不是单轮说尽的，而是通过多轮对话逐步追加、修正或展开的。在发射 propose 或 modify 意图时，params.userPrompt 必须通盘阅读并全量融汇创作者在历史全部对白中提出的所有题材偏好、核心角色、世界观设定、反转悬念与机制规则，绝对严禁只管最后一句话而丢失前面轮次的构想；
- 必须输出对话正文（Mandatory Speech）：在调用 emit_director_intent 发射任何意图的同时，必须在自然语言对话流中向创作者清晰说明你的方案亮点、决策理由或确认对白，绝对严禁只调用工具而正文留空；
- 严禁在对话正文中打印任何 XML/JSON 意图标签，所有行动必须通过调用 emit_director_intent 工具发起；
- 意图工具的 targetTool 必须从系统动态提供的【当前工序阶段可用能力编目】中选择，严禁臆造不存在的工序；
- 【严禁自导自演物理落盘与虚假收官（核心红线）】：你不是物理执行引擎！绝对严禁在单条自然语言对话中既声明“收到，授权开跑”，又自说自话在同一条消息中宣称“已物理落盘/工序全线收官/复盘”！绝对严禁在单次回复中拼接“---”分割线伪造任务执行完毕后的收官总结！
  当创作者表达认可同意（如“同意/好的/准了/开跑”）时，物理算力计算尚未开始，你必须且只能调用 emit_director_intent(action: "approve") 授权启动物理执行，并输出干练简短的开跑确认即可（例如“收到，授权确认，开跑——...”）；
  真正的物理落盘必须等待物理任务在后台真实跑完后，由系统事件单独驱动你出具阶段复盘！
`;

export class PlannerChatSession extends BaseChatSession<PlannerActionIntent> {
  constructor(options: { projectId: string; sessionId?: string }) {
    super({
      projectId: options.projectId,
      sessionId: options.sessionId || 'planner',
    });
  }

  /**
   * 动态计算工序 1 运行时状态机 (SOP State Machine Evaluator)
   */
  public static evaluatePhase(projectId: string): {
    phase: PlannerPhase;
    hasScreenplay: boolean;
    hasPrd: boolean;
    screenplaySummary: string;
    prdSummary: string;
  } {
    const store = ProjectStore.getInstance();
    const screenplay = store.getArtifact<string>(projectId, 'screenplay');
    const prd = store.getArtifact<any>(projectId, 'prd');

    const hasScreenplay = Boolean(screenplay && screenplay.trim().length > 100);
    const hasPrd = Boolean(prd && (prd.clips?.length > 0 || prd.scenes?.length > 0));

    let phase: PlannerPhase = 'STEP_1_PENDING';
    if (hasScreenplay && !hasPrd) {
      phase = 'STEP_2_PENDING';
    } else if (hasScreenplay && hasPrd) {
      phase = 'STAGE_1_COMPLETED';
    }

    const screenplaySummary = hasScreenplay
      ? `已产出剧本正文 (共约 ${screenplay!.length} 字)。前 300 字大纲预览：\n"""\n${screenplay!.slice(0, 300).trim()}...\n"""`
      : '尚未生成剧本正文';

    const prdClipsCount = prd?.clips?.length || prd?.scenes?.length || 0;
    const prdEndingsCount = prd?.endings?.length || 0;
    const prdSummary = hasPrd
      ? `已收敛 Universal PRD 拓扑策划案 (包含 ${prdClipsCount} 个分幕切片，${prdEndingsCount} 个分支结局)`
      : '尚未拆解 PRD 拓扑';

    return {
      phase,
      hasScreenplay,
      hasPrd,
      screenplaySummary,
      prdSummary,
    };
  }

  /**
   * 组装带工序 1 SOP 状态机看板的专属 System Prompt
   */
  protected assembleSystemPrompt(): string {
    const store = ProjectStore.getInstance();
    const project = store.getProject(this.projectId);
    const meta = project.meta;
    const evaluation = PlannerChatSession.evaluatePhase(this.projectId);

    // 提取会话历史态势与挂起待审提案 (SSOT 最高优先级)
    const sessionMessages = this.getMessages();
    const userTurnsCount = sessionMessages.filter((m) => m.role === 'user').length;
    const lastMsgWithProposal = [...sessionMessages].reverse().find((m) => m.proposal && !m.proposalResolved);
    const activePendingProposal = lastMsgWithProposal?.proposal;
    const proposalFact = activePendingProposal
      ? `挂起待审【${activePendingProposal.title || activePendingProposal.tool}】`
      : '无挂起提案';

    let phaseDescription = '';
    let currentMission = '';

    if (activePendingProposal) {
      phaseDescription = `提案待审中: 【${activePendingProposal.title || activePendingProposal.tool}】`;
      currentMission = `当前存在挂起待审的制片/微调方案【${activePendingProposal.title || activePendingProposal.tool}】。若创作者表达认可授权（如“同意/准了/开跑/可以/好的”），你必须且只能调用 emit_director_intent(action: "approve") 授权开跑！严禁在单条回复中自说自话伪造落盘，严禁越级发射 next_stage！`;
    } else {
      switch (evaluation.phase) {
        case 'STEP_1_PENDING':
          phaseDescription = '步骤 1/2: 互动全景剧本推演 (进行中)';
          currentMission = '协助确立故事题材与核心冲突，构思成熟或创作者表达认可时发起全景剧本推演提案。';
          break;

        case 'STEP_2_PENDING':
          phaseDescription = '步骤 2/2: PRD 分幕拓扑拆解 (进行中)';
          currentMission = '剧本正文已落盘。阐述因果分幕逻辑，并主动发起 PRD 分幕拓扑拆解提案。';
          break;

        case 'STAGE_1_COMPLETED':
          phaseDescription = '工序 1 全线完工 (已完成)';
          currentMission = '剧本与 PRD 策划案均已收敛，工序 1 全线完工。为创作者出具全景总纲收官复盘，梳理世界观、人物弧光与分支拓扑格局。';
          break;
      }
    }

    // 关联物理任务存储
    const taskStore = TaskStore.getInstance();
    const projectTasks = taskStore.getTasksByProject(this.projectId);
    const activeTask = projectTasks.find((t) => t.status === 'running' || t.status === 'pending');
    const failedTask = projectTasks.find((t) => t.status === 'failed');

    const activeTaskSummary = activeTask
      ? `运行中 [${activeTask.toolName}] (taskId: ${activeTask.taskId}, 进度: ${activeTask.progress?.percent || 0}%)`
      : '无';

    const failedTaskSummary = failedTask
      ? `失败 [${failedTask.toolName}] (taskId: ${failedTask.taskId}, 错误: "${failedTask.error || '未知'}")`
      : '无';

    const stateBoard = `

==================================================
### 【当前制片态势 (State Board)】
- 项目: 《${meta.title || this.projectId}》 (${meta.genre || '互动影游'}) | 交互轮次: ${userTurnsCount}
- 管线进度: 步骤 1/2 剧本 [${evaluation.hasScreenplay ? '完成' : '待执行'}] | 步骤 2/2 PRD [${evaluation.hasPrd ? '完成' : '待执行'}]
- 当前阶段: ${phaseDescription}
- 制片目标: ${currentMission}
- 资产沉淀: 剧本(${evaluation.hasScreenplay ? '已落盘' : '无'}) | PRD(${evaluation.hasPrd ? '已落盘' : '无'})
- 待审提案: ${proposalFact}
- 物理任务: 活跃(${activeTaskSummary}) | 异常(${failedTaskSummary})

${BaseChatSession.renderFunnelPromptMatrix()}
==================================================
`;

    return `${PLANNER_DIRECTOR_SYSTEM_PROMPT}${stateBoard}`;
  }

  /**
   * 工序 1 资产验收客观刚性门禁 (Gate Guard)
   * 必须确保无挂起待审提案，且剧本和 PRD 拓扑均已物理落盘，否则坚决阻断跨阶段移交
   */
  protected override validateStageCompletion(): { canAdvance: boolean; reason?: string } {
    // 门禁 1: 检查是否存在挂起未决的方案卡片
    const sessionMessages = this.getMessages();
    const lastMsgWithProposal = [...sessionMessages].reverse().find((m) => m.proposal && !m.proposalResolved);
    if (lastMsgWithProposal?.proposal) {
      const pTitle = lastMsgWithProposal.proposal.title || lastMsgWithProposal.proposal.tool || '未决方案';
      return {
        canAdvance: false,
        reason: `当前会话仍有处于待审状态的方案【${pTitle}】尚未落地执行，严禁跳步移交`,
      };
    }

    const evaluation = PlannerChatSession.evaluatePhase(this.projectId);
    if (!evaluation.hasScreenplay) {
      return { canAdvance: false, reason: '剧本正文尚未物理落盘，严禁跳步移交' };
    }
    if (!evaluation.hasPrd) {
      return { canAdvance: false, reason: 'PRD 分幕因果拓扑尚未物理落盘，必须先执行 PRD 拆解工序' };
    }
    return { canAdvance: true };
  }

  /**
   * 声明工序 1 支持的法定物理工具清单 (SSOT)
   * 基类 BaseChatSession 基于此清单自动构建强类型 emit_director_intent 意图识别工具
   */
  protected getIntentToolSpecs(): SubmittableToolSpec[] {
    return [
      {
        toolName: screenplayTool.toolName,
        title: '推演互动全景剧本',
        description: screenplayTool.description,
        schema: screenplayTool.inputSchema || z.any(),
      },
      {
        toolName: scriptToPrdTool.toolName,
        title: '解析生成 PRD 拓扑',
        description: scriptToPrdTool.description,
        schema: scriptToPrdTool.inputSchema || z.any(),
      },
    ];
  }
}
