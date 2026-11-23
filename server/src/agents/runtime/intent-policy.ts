/**
 * agents/runtime/intent-policy.ts
 * 制片意图策略与规则规约单一事实来源 (Intent Policy SSOT)
 *
 * 核心架构定位：
 * 1. 【改且只改一处】：全系统关于智能体意图动作、漏斗决策优先级、创作者裁决权的唯一权威定义中心；
 * 2. 彻底消灭在 Tool Schema、System Prompt、历史消息拼接中重复散落声明规则的坏味道；
 * 3. 驱动下游 Tool 参数契约与微内核 Prompt 统一同源派生。
 */

export const INTENT_ACTIONS = ['propose', 'modify', 'approve', 'chat_only'] as const;
export type IntentActionType = (typeof INTENT_ACTIONS)[number];

export class IntentPolicy {
  /**
   * 动作枚举定义与极简契约说明（供 Mastra Tool Schema 使用，保持极简纯净，绝无大段业务宣讲）
   */
  public static getActionDescriptions(allowPendingActions: boolean): Record<string, string> {
    if (allowPendingActions) {
      return {
        propose: '提出新的制片工序方案（单步或多步 Plan 卡片）',
        modify: '对已有提案进行参数精修或局部调整',
        approve: '创作者明确肯定授权时，转译执行挂起的待审提案',
        chat_only: '纯自然语言对话交流、探讨答疑（严禁在用户提出修改诉求时滥用）',
      };
    }
    return {
      propose: '提出新的制片工序方案（单步或多步 Plan 卡片）',
      chat_only: '纯自然语言对话交流、探讨答疑（严禁在用户提出修改诉求时滥用）',
    };
  }

  /**
   * 唯一的意图工具简要说明
   */
  public static getToolDescription(allowPendingActions: boolean): string {
    return allowPendingActions
      ? '制片意图决策工具：根据创作者最新意图与当前制片态势，选择合适的制片动作（propose/modify/approve/chat_only）并附带专业对白。'
      : '制片意图决策工具：提议或修改方案必须出具 propose/modify（单步填 tool+params，批量填 operations）；仅在纯讨论概念或叫停时出具 chat_only。';
  }

  /**
   * 全系统唯一的【意图决策状态机与行为规约】Prompt (SSOT)
   * 采用高信噪比架构：状态表 + 正向准则 + 典型 Few-Shot 示例，彻底摒弃长篇负向对抗说教
   */
  public static renderFunnelMatrix(): string {
    return `### 【导演意图决策漏斗与状态机】

#### 1. 意图决策状态表（自顶向下独占优先级匹配）
| 优先级 | 场景与创作者意图 | 目标动作 (action) | 行为规范 |
| :--- | :--- | :--- | :--- |
| **L1 修改拦截** | 创作者表达调整、换人、换名、精修或重做诉求（无论信息详略、无论是否有挂起卡片） | \`propose\` / \`modify\` | **自主推演具体方案直接出卡**：信息不足时总监自主推演并补齐一种最合理的具体方案出卡，不以“需要澄清”为由退缩反问；仅纯喊停（“先等等/我再想想”）时用 \`chat_only\`(invalidate: true) |
| **L2 待审裁决** | 态势黑板显示【存在挂起待审提案】，创作者给出肯定答复（“同意/开跑/好的/确认/行/可以/按这个来”等） | \`approve\` | **充当转译器授权开跑**：唯一调用 approve 放行已有方案，对白克制在 1 句内，严禁重复出卡；创作者犹豫时用 chat_only 保持待审 |
| **L3 顺位推进** | 当前无待审提案，创作者提出推进新工序，或工序完工后系统自动复盘接力 | \`propose\` | **依据可用工具编目出具方案卡片**：单任务 1 步，多任务在 operations 中展开多步；管辖工序全量收官后终态自知，以 \`chat_only\` 总结并引导前往下一工坊 |
| **L4 纯探讨** | 既不修改也不推进具体工序，纯粹交流剧情、讨论风格设定或咨询背景 | \`chat_only\` | **专业自然语言对话**：纯文本答疑探讨，零卡片、零按钮 |

#### 2. 方案编排核心准则 (Plan by Construction)
- **步骤结构统一**：无论单任务还是多任务，执行步骤统一在 \`operations\` 数组中清晰展开（处理 1 个实体为 1 步，处理 N 个实体为 N 步，言行一致）；
- **参数确定完备**：卡片所附带的 params 必须具体可执行，严禁包含占位符或未决变量；
- **聚焦单一阶段**：修改或推进仅限定在当前工序阶段，不擅自向后超前捆绑下游工序；
- **视口消歧原则**：创作者显式指定目标或存在待审方案时严格以指令与方案为准；仅首发无主语模糊指令（如“改一下这张”）时视口焦点才作为消歧依据。

#### 3. 典型决策示例 (Few-Shot Examples)
- **示例 1 · 挂起提案决策放行 (L2 approve)**：
  - 态势：黑板挂起【角色定妆 · 三视图】
  - 创作者：“同意” 或 “好的开跑”
  - 调用：\`emit_director_intent({ action: "approve", reply: "收到确认，三角色定妆方案已锁定，立即开跑推演。" })\`
- **示例 2 · 模糊修改需求主动出卡 (L1 propose)**：
  - 态势：当前为民间恐怖故事剧本
  - 创作者：“改下名字吧”
  - 调用：\`emit_director_intent({ action: "propose", title: "全景剧本 · 主题更名《守阴人》", description: "结合中式民俗恐怖调性，将全剧片名重构为更具压迫感的《守阴人》", operations: [{ tool: "planner.screenplay_writer", title: "全景剧本推演", params: { userPrompt: "改名为《守阴人》，强化民俗禁忌冲突" } }], reply: "已将片名调整为更具悬疑感的《守阴人》，方案卡片已生成，请审阅。" })\`
- **示例 3 · 多实体批量工序出卡 (L3 propose)**：
  - 态势：视觉规格已落盘，需为出场角色定妆
  - 创作者：“为陈守义和林阿婆出三视图定妆”
  - 调用：\`emit_director_intent({ action: "propose", title: "角色定妆 · 陈守义 / 林阿婆 三视图", description: "按落盘规格为陈守义、林阿婆各生成一张全身三视图定妆", operations: [{ tool: "film.lookdev", title: "定妆 · 陈守义", params: { targetKind: "character", targetId: "char_1" } }, { tool: "film.lookdev", title: "定妆 · 林阿婆", params: { targetKind: "character", targetId: "char_2" } }], reply: "已为两位角色编排定妆方案，请审阅确认。" })\``;
  }
}
