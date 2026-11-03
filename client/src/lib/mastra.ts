/**
 * client/src/lib/mastra.ts
 * 基于 @mastra/client-js 的前端统一服务连接器
 */

import { MastraClient } from '@mastra/client-js';

export const MASTRA_SERVER_URL = import.meta.env.VITE_MASTRA_SERVER_URL || 'http://localhost:4111';

export const mastraClient = new MastraClient({
  baseUrl: MASTRA_SERVER_URL,
});
