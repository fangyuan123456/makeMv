/**
 * scripts/diag-text-game.ts
 * 单独跑阶段二上半场（文游扩写 agent），用于定位节点数不足的问题
 *
 * 用法：npx tsx scripts/diag-text-game.ts <projectId>
 */
import { ProjectStore } from '../src/project-store/ProjectStore.js';
import { writeTextGameWithAgent } from '../src/agents/text-game/text-game.agent.js';
import type { GDDArtifact } from '../src/agents/planner/schema.js';

const projectId = process.argv[2]!;
const store = ProjectStore.getInstance();
const gdd = store.getArtifact<GDDArtifact>(projectId, 'gdd');
if (!gdd) throw new Error('缺少 gdd');

console.log(`[Diag] 模型: ${process.env.LLM_MODEL} | gdd 节拍数: ${gdd.beatOutline?.length}`);

const t0 = Date.now();
const tg = await writeTextGameWithAgent(gdd);
console.log(`[Diag] 耗时 ${Math.round((Date.now() - t0) / 1000)}s | 节点数 ${tg.nodes.length}`);
console.log(`[Diag] 节点: ${tg.nodes.map((n) => n.id).join(', ')}`);
console.log(`[Diag] 无 visual 的节点: ${tg.nodes.filter((n) => !n.visual?.imagePromptEn).length}/${tg.nodes.length}`);
process.exit(0);
