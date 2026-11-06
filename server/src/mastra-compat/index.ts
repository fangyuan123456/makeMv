/**
 * mastra-compat/index.ts
 * Mastra 微内核增强与兼容层出口 (Mastra Compat SSOT)
 */

export {
  createTool,
  resolveToolArgs,
  cleanSchemaToStringFields,
  type WrappedToolConfig,
} from './createTool.js';

export { installMastraJsonSelfHealing } from './jsonHealing.js';
