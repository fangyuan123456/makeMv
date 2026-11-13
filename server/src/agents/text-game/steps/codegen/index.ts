/**
 * agents/text-game/steps/codegen/index.ts
 * 互动影游代码生成工序总装出口 (SSOT)
 */

export { codegenStep, executeCodegenStep, generateIndexHtml, type CodegenDeps } from './step.js';
export { VirtualFS } from './vfs.js';
export { parseDrafts, parseFileDrafts, applyDrafts, buildSymbolSummary } from './tools.js';
export { buildCodegenSystemPrompt } from './prompt.js';

export {
  CodegenInputSchema,
  CodegenOutputSchema,
  type CodegenInput,
  type CodegenOutput,
} from './schema.js';
