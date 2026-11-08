/**
 * agents/director/lineage/ — 血缘 · 指纹 · 重算轨出口
 *
 * 这一层既不属于生成轨，也不属于修改轨：它回答的是「改了上游之后，
 * 哪些已落盘的媒体资产因此过期、该按什么顺序重做」。
 *
 * 六个模块的分工：
 *   character-identity  稳定角色身份（写盘归一，id 与显示名解耦）
 *   lineage             产物血缘图与影响面查询
 *   fingerprint         内容指纹与陈旧判定
 *   provenance          setArtifact 落盘边界，统一补 id + inputFingerprint
 *   recompute-plan      只读 dry-run 清单（只算不执行）
 *   recompute-executor  精确/回退决策 + W1/W2 波次执行（需人工确认）
 *
 * 依赖方向：本层可被 generator / modifier / api / project-store 引用，
 * 但内部不 import 任何一轨的业务执行体（recompute-executor 只拿
 * 子工作流对象作为注入参数或显式引用，属于编排，不是执行体依赖）。
 */

export * from './character-identity.js';
export * from './lineage.js';
export * from './fingerprint.js';
export * from './provenance.js';
export * from './recompute-plan.js';
export * from './recompute-executor.js';
