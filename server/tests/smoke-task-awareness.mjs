import { PlannerDirectorAgent } from '../dist/agents/planner-director/planner-director.agent.js';

const prompt = PlannerDirectorAgent.assembleSystemPrompt('proj_1794792349421_t6d1');
console.log('--- 验证组装的 SYSTEM PROMPT 看板 ---');
console.log(prompt.slice(prompt.indexOf('【工序 1 物理任务引擎实时状态看板')));
