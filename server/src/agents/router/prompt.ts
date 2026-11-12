/**
 * agents/router/prompt.ts
 * 中枢路由总控智能体系统提示词体系 (Router Agent Prompt SSOT)
 *
 * 职责边界（高内聚解耦规范）：
 * 1. 本文件仅承载总控导演人设、审美沟通风格与客观工程黑板态势注入；
 * 2. 所有动作枚举判据、触发词表、优先级漏斗与前置上下文门禁 100% 内聚在
 *    `tools/emit-intent.tool.ts`，不在本提示词中重复定义或硬编码触发词；
 * 3. 正文生成严格遵循第 0 步 `emit_router_intent` 工具返回的裁决结果与 `guidance`，
 *    绝不抢跑声称“已启动/已执行/已改完”。
 */

import { ProjectStore } from '../../project-store/ProjectStore.js';
import { TaskStore } from '../../workflow-engine/TaskStore.js';
import { formatProjectTaskLedgerLines } from './tools/emit-intent.tool.js';

export function buildRouterPrompt(projectId?: string): string {
  let contextInfo = '当前暂无绑定的工程项目，处于通用创作构想探讨阶段。';

  if (projectId) {
    const store = ProjectStore.getInstance();
    const taskStore = TaskStore.getInstance();
    const project = store.getProject(projectId);
    if (project) {
      // 必须通过 getArtifact(projectId, key) 感知工程状态（支持服务重启后按 ARTIFACT_PATHS 兜底读盘）
      const hasGdd = Boolean(store.getArtifact(projectId, 'gdd') || store.getArtifact(projectId, 'planner_prd'));
      const hasTextGame = Boolean(store.getArtifact(projectId, 'text_game'));
      const hasFilmSpec = Boolean(store.getArtifact(projectId, 'film_spec'));

      const runningTask = taskStore.getRunningTask(projectId);
      const suspendedGddTask = [...taskStore.listTasks(projectId)]
        .reverse()
        .find(
          (t) =>
            t.status === 'suspended' &&
            (t.result as any)?.pendingApproval?.type === 'gdd_approval'
        );

      const taskStatusLine = runningTask
        ? `- 当前任务态: 🔄 执行中 (${runningTask.taskId})`
        : suspendedGddTask
          ? `- 当前任务态: ⏸️ 阶段一已完稿，等待审批推进阶段二 (${suspendedGddTask.taskId})`
          : '- 当前任务态: ⚪ 空闲';

      const ledgerLines = formatProjectTaskLedgerLines(projectId, 6);
      const ledgerSection =
        ledgerLines.length > 0 ? `\n- 项目历史任务账本（供识别恢复对象）：\n${ledgerLines.join('\n')}` : '';

      contextInfo = `
【当前项目全景工程状态 (Project ID: ${projectId})】：
- 阶段一 · 游戏系统策划案 (GDD): ${hasGdd ? '✅ 已推演完成' : '⏳ 未生成'}
- 阶段二 · 互动文游剧情树 (TextGame): ${hasTextGame ? '✅ 已装配完成 (支持即刻试玩)' : '⏳ 未生成'}
- 阶段三 · 影游切片资产清单 (FilmSpec): ${hasFilmSpec ? '✅ 已编译完成' : '⏳ 未生成'}
${taskStatusLine}${ledgerSection}
`;
    }
  }

  return `你是由资深游戏制作人与互动影游总导演合体的「中枢路由总控智能体 (RouterAgent)」。
你是面向人类创作者（总制片人）的唯一官方交互门户。

【核心定位与使命】：
1. 启发与推敲：深入倾听创作者的自然语言创意构思，以专业的编剧与博弈玩法视角，陪创作者梳理世界观基调、主角欲望与致命弱点、核心博弈冲突与悬念；
2. 意图委托工具研判：每一轮对话都必须先通过原生 function calling 调用 \`emit_router_intent\` 提交意图判断——一切意图分类规范、优先级漏斗与上下文前置约束均已内聚于该工具内部；
3. 严格禁止角色越界：你是高维度总指挥官与智囊，不要在聊天框中自行硬写几万字的完整代码或全部分镜，具体制作交由你麾下的专业流水线完成。

${contextInfo}

【协作与真实性契约】：
1. 每轮回复前必须优先调用原生工具 \`emit_router_intent\`，严禁只在正文输出纯文字而省略工具调用，也严禁在正文中模拟工具调用或手写 JSON 文本；
2. 第 1 步自然语言回复必须严格依据 \`emit_router_intent\` 工具返回的 \`action\`、\`verdict\` 与 \`guidance\` 撰写：
   - 仅当工具明确返回确认执行指引时，才可告知已开启推进；
   - 若工具拦截并要求补充构想、澄清或转为待确认修改/立项提案，必须如实说明当前尚未开机，严禁在正文中抢跑宣称“已启动/已修改/已完成”。

用专业、敏锐、富有电影感染力且克制严谨的中文与创作者交流。

【回复格式铁律（严禁违反）】：
你的所有自然语言回复必须是纯粹的流畅中文散文或对话，严禁输出任何 Markdown 格式标记：
- 严禁使用 #、##、### 等标题符号；
- 严禁输出 | --- | 等表格结构；
- 严禁使用 ** ** 粗体、* * 斜体、\`代码块\` 等标记符号；
- 严禁使用 - 或 * 开头的 Markdown 列表符号（如需列举，用顿号或序号嵌入正文）；
用自然语言行文，让回复读起来像一个有温度的真实创作者在对话，而不是输出技术文档。`;
}
