import { createStep } from '@mastra/core/workflows';
import { ProjectStore } from '../../../../project-store/ProjectStore.js';
import { Agent } from '@mastra/core/agent';
import { LLMProvider } from '../../../../llm/index.js';
import { generateStructured } from '../../../../utils/llm-diagnostics.js';
import { runTaskRecordedStep } from '../../../../workflow-engine/TaskStore.js';
import { writeArtifactFile, renderArtifactMarkdown, STAGE, PLANNER_STEP } from '../../../../project-store/artifact-fs.js';
import { InteractiveOutlineInputSchema, InteractiveOutlineSchema, type InteractiveOutline, type InteractiveOutlineInput } from './schema.js';

function prompt(input: InteractiveOutlineInput) { return `你是互动影游结构策划。根据创意简报生成一份可调整的互动剧情大纲，只输出节点和因果，不写文学正文。\n\n【原始创意】\n${input.userPrompt}\n\n【创作简报】\n${input.creativeBrief || '无'}\n\n【风格】\n${input.userToneOrPreference || '无'}\n\n要求：nodes 同时包含 MAINLINE、BRANCH、ENDING；主线节点按 S1、S2 命名，支线按 S2.1 命名；CHOICE 必须有两个选项和两个去向；大纲是软约束，后续可以为更好的戏剧因果调整；只输出 JSON。`; }

export async function executeInteractiveOutlineStep(input: InteractiveOutlineInput, agent: Agent = new Agent({ name: 'interactive-outline-agent', instructions: '你是互动影游结构策划，只输出结构化大纲。', model: LLMProvider.getModel() })): Promise<InteractiveOutline> { return generateStructured({ agent, prompt: prompt(input), schema: InteractiveOutlineSchema, stage: STAGE.planner, step: PLANNER_STEP.outline, label: '互动剧情大纲生成' }); }

export const interactiveOutlineStep = createStep({ id: 'interactive-outline', description: '生成互动影游主线与支线大纲', inputSchema: InteractiveOutlineInputSchema, outputSchema: InteractiveOutlineSchema, execute: async ({ context }) => runTaskRecordedStep('interactive-outline', async () => { const ctx = (context as any) || {}; const input = { userPrompt: ctx.userPrompt || ctx.triggerData?.userPrompt || '', creativeBrief: ctx.creativeBrief || ctx.triggerData?.creativeBrief, userToneOrPreference: ctx.userToneOrPreference || ctx.triggerData?.userToneOrPreference }; const outline = await executeInteractiveOutlineStep(input); const projectId = ctx.projectId || ctx.triggerData?.projectId; if (projectId) { ProjectStore.getInstance().setArtifact(projectId, 'planner_outline', outline); writeArtifactFile(projectId, 'debug', STAGE.planner, PLANNER_STEP.outline, 'interactive_outline.md', renderArtifactMarkdown('互动剧情大纲', outline)); } return outline; }) });
