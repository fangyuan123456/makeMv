/**
 * tools/index.ts
 * 影视生成引擎公共真实物理算力工具库统一出口 (Physical Tools SSOT)
 * 
 * 架构铁律：
 * 1. 模块化：一个 Tool 对应一个独立专属文件夹，0 裸文件；
 * 2. 纯粹性：本目录有且仅有真实的物理/硬件算力工具 (生图、重绘、生视频、声音、FFmpeg)；
 * 3. 0 假工具：坚决杜绝把大模型写文本、写剧本或查黑板包装成所谓的 Tool；
 * 4. 供全系统 (PipelineAgent / ModifierAgent / Workflow Steps) 公共调度。
 */

export * from './image-generate/index.js';
export * from './image-inpaint/index.js';
export * from './video-generate/index.js';
export * from './voice-generate/index.js';
export * from './ffmpeg-render/index.js';
