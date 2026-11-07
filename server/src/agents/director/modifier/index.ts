/**
 * agents/director/modifier/index.ts
 * 资产定向精修外科手术室出口 (Modifier SSOT)
 *
 * 结构（与 generator/ 同构：一个业务单元一个 step）：
 *   modifier.workflow.ts   唯一一条微调 workflow：text / image / video 三条互斥分支
 *   manifest.ts            工序 → 微调规格注册表
 *   spec.ts                修改器四段契约（load / plan / apply / commit）
 *   steps/                 三个互斥 step + 各媒介业务体（四段实现）
 */

export * from './modifier.workflow.js';
export * from './manifest.js';
export * from './spec.js';
export * from './steps/index.js';
export * from './entity-resolver.js';
