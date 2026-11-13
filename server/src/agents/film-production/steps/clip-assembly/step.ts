import { createStep } from '@mastra/core/workflows';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { ProjectStore } from '../../../../project-store/ProjectStore.js';
import { MediaResolver } from '../../../../media/MediaResolver.js';
import { ClipAssemblyStepInputSchema, ClipAssemblyStepOutputSchema, type ClipAssemblyStepInput, type ClipAssemblyStepOutput } from './schema.js';

function runFfmpeg(args: string[]): Promise<void> { return new Promise((resolve, reject) => { const p = spawn('ffmpeg', args, { stdio: ['ignore','ignore','pipe'] }); let err=''; p.stderr.on('data', d => err += d); p.on('error', reject); p.on('close', c => c === 0 ? resolve() : reject(new Error(err || `ffmpeg exit ${c}`))); }); }

export async function executeClipAssemblyStep(input: ClipAssemblyStepInput): Promise<ClipAssemblyStepOutput> {
  const store = ProjectStore.getInstance(); const spec: any = store.getArtifact(input.projectId, 'film_spec');
  if (!spec?.clips?.length) throw new Error(`[ClipAssemblyStep] 项目 [${input.projectId}] 缺少 film_spec`);
  let assembled=0, failed=0; const dir = store.getProjectDir(input.projectId);
  for (const clip of spec.clips) {
    const shots = [...(clip.shots || [])].sort((a,b) => a.shotIndex - b.shotIndex);
    const files = shots.map(s => MediaResolver.resolveDiskPath(s.videoUrl || '', input.projectId).diskPath).filter(Boolean);
    if (!files.length || files.length !== shots.length) { failed++; continue; }
    const list = path.join(dir, `.concat-${clip.clipId}.txt`); const out = path.join(dir, 'video', `${clip.clipId}.mp4`);
    fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(list, files.map(f => `file '${f.replace(/'/g, "'\\''")}'`).join('\n'));
    try {
      await runFfmpeg(['-y','-f','concat','-safe','0','-i',list,'-c','copy',out]);
      clip.clipUrl = `/media/${input.projectId}/video/${clip.clipId}.mp4`;
      const scenePath = path.join(dir, 'scenes', `${clip.clipId}.json`);
      if (fs.existsSync(scenePath)) {
        const scene = JSON.parse(fs.readFileSync(scenePath, 'utf8'));
        scene.clipUrl = clip.clipUrl;
        fs.writeFileSync(scenePath, JSON.stringify(scene, null, 2));
      }
      assembled++;
    } catch { failed++; } finally { try { fs.unlinkSync(list); } catch {} }
  }
  store.setArtifact(input.projectId, 'film_spec', spec); return { projectId: input.projectId, force: input.force, assembled, failed };
}

export const clipAssemblyStep = createStep({ id: 'film-clip-assembly', description: '按镜头顺序合成分幕视频', inputSchema: ClipAssemblyStepInputSchema, outputSchema: ClipAssemblyStepOutputSchema, execute: async ({ context }) => executeClipAssemblyStep(context) });

