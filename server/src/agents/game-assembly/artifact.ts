import { z } from 'zod';

export const GameAssemblyTechMethodSchema = z.object({
  name: z.string(),
  signature: z.string(),
  description: z.string(),
});

export const GameAssemblyTechSymbolSchema = z.object({
  name: z.string(),
  kind: z.enum(['class', 'function', 'const']),
  purpose: z.string(),
  methods: z.array(GameAssemblyTechMethodSchema).default([]),
});

export const GameAssemblyTechFileSchema = z.object({
  fileName: z.string(),
  kind: z.enum(['js', 'css']),
  responsibility: z.string(),
  dependencies: z.array(z.string()).default([]),
  symbols: z.array(GameAssemblyTechSymbolSchema).default([]),
});

export const GameAssemblyTechPlanArtifactSchema = z.object({
  architectureSummary: z.string(),
  files: z.array(GameAssemblyTechFileSchema).min(1),
});

export type GameAssemblyTechPlanArtifact = z.infer<typeof GameAssemblyTechPlanArtifactSchema>;
export type TechFileSpec = z.infer<typeof GameAssemblyTechFileSchema>;
export type TechPlanOutput = GameAssemblyTechPlanArtifact;
