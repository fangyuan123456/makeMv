/**
 * agents/director/generator/steps/story-bible/exporter.ts
 * ⚠️ 实现已下沉至 artifacts/story-bible.ts（产物契约层）
 *
 * 依赖方向：generator → artifacts。生成轨与修改轨共享同一份落盘真相，
 * 但彼此之间不存在任何横向 import。
 */

export * from '../../../../../artifacts/story-bible.js';
