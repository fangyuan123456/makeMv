/**
 * pipelines/scene-script/steps/scene-structuring/schema.ts
 */

import { z } from 'zod';
import { ScriptSceneSchema } from '../../types.js';

export const SceneStructuringSchema = z.object({
  scenes: z.array(ScriptSceneSchema).describe('结构化分场数组，包含动作、台词与互动决策选项'),
  locations: z.array(z.string()).describe('出现的所有场景地点清单'),
});

export type SceneStructuringOutput = z.infer<typeof SceneStructuringSchema>;
