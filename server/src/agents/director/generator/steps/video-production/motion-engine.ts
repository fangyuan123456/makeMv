/**
 * agents/director/generator/steps/video-production/motion-engine.ts
 * ⚠️ 实现已下沉至 media/motion-engine.ts（媒体基础设施层）
 *
 * 依赖方向：generator → media ← modifier。生成轨与修改轨共用同一份提示词构造逻辑，
 * 但彼此之间不存在任何横向 import。
 */

export * from '../../../../../media/motion-engine.js';
