/**
 * agents/index.ts
 * 核心智能体统一门面导出 (SSOT)
 * 双核智能体微内核：
 * 1. DirectorAgent：总导演智能体（编排决策与端到端驱动）
 * 2. DoctorAgent：质检与自愈专家智能体（刚性门禁与故障自愈）
 */

export * from './director/index.js';
export * from './doctor/index.js';
