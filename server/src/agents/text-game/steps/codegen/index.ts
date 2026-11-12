/**
 * agents/text-game/steps/codegen/index.ts
 * 互动文游代码生成工序总装出口 (SSOT)
 */

export {
  codegenStep,
  executeCodegenStep,
  getSceneTypesCode,
  getStateBlackboardCode,
  getSceneLoaderCode,
  getInteractiveShellCode,
  getMainEntryCode,
} from './step.js';

export {
  CodegenInputSchema,
  CodegenOutputSchema,
  type CodegenInput,
  type CodegenOutput,
} from './schema.js';
