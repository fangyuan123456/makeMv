/**
 * artifacts/index.ts
 * 产物契约层总出口
 *
 * 这里只放「产物长什么样 + 怎么落盘」，不放任何工序/流程逻辑。
 * 生成轨（generator）与修改轨（modifier）都向下依赖本层，彼此不互相 import。
 */

export * from './story-bible.js';
export * from './scene-script.js';
export * from './storyboard.js';
export * from './character-portrait.js';
export * from './keyframe-reference.js';
export * from './video-production.js';
