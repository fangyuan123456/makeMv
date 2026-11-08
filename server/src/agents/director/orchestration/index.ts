/**
 * agents/director/orchestration/ — 工作流编排层出口
 *
 * register.ts 过去放在 generator/ 下，但它做的是「注册全部工作流 + 状态机钩子
 * + 审批任务派发」，同时依赖生成轨、修改轨和血缘重算轨。它是两轨之上的
 * 编排者，不是任何一轨的内部实现，因此独立成层。
 */

export * from './register.js';
