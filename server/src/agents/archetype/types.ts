/**
 * agents/archetype/types.ts
 * 通用 Agent 底座原型强类型数据契约 (SSOT)
 */

import type { BaseAgentInput } from '../../agent-runtime/index.js';

export interface ArchetypeInput extends BaseAgentInput {
  userPrompt: string;
  style?: string;
}

export interface AnalysisOutput {
  theme: string;
  keywords: string[];
  intent: string;
}

export interface ArchetypeArtifact {
  title: string;
  summary: string;
  analysis: AnalysisOutput;
  elements: Array<{
    id: string;
    name: string;
    description: string;
  }>;
  createdAt: string;
}
