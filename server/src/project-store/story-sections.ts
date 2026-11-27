/**
 * project-store/story-sections.ts
 * 分幕剧本正文统一解析器 (Story Sections SSOT)
 *
 * 唯一事实来源：从结构化剧本 JSON (screenplay.json) 的 clips 提取各分幕剧本正文，
 * 供接口读取、分镜规划工具与分镜导演上下文统一消费。
 */

import { ProjectStore } from './ProjectStore.js';
import { resolveProjectStorySource } from './story-source.js';

export interface StorySection {
  title: string;
  narrativeText: string;
}

/**
 * 从标准分幕 Markdown 文本逐行解析 clipId -> { title, narrativeText } 字典
 */
export function parseStorySections(markdown?: string | null): Record<string, StorySection> {
  const sections: Record<string, StorySection> = {};
  if (!markdown || typeof markdown !== 'string') return sections;

  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  let currentId: string | null = null;
  let currentTitle = '';
  let bodyLines: string[] = [];

  const flush = () => {
    if (!currentId) return;
    sections[currentId] = {
      title: currentTitle || currentId,
      narrativeText: bodyLines.join('\n').trim(),
    };
  };

  for (const line of lines) {
    const headingMatch = line.match(/^##\s*([A-Za-z0-9_.-]+)(?:\s*[｜|]\s*(.+))?$/);
    if (headingMatch) {
      flush();
      currentId = headingMatch[1].trim();
      currentTitle = (headingMatch[2] || currentId).trim();
      bodyLines = [];
      continue;
    }
    if (currentId !== null) {
      bodyLines.push(line);
    }
  }
  flush();

  return sections;
}

/**
 * 读取指定项目的分幕剧本字典 (优先 story.md，缺失时回退 screenplay.md)
 */
export function getProjectStorySections(
  projectId: string,
  overrideMarkdown?: string
): Record<string, StorySection> {
  if (overrideMarkdown) {
    return parseStorySections(overrideMarkdown);
  }
  const storySource = resolveProjectStorySource(projectId);
  if (!storySource || !Array.isArray(storySource.clips)) {
    return {};
  }
  const sections: Record<string, StorySection> = {};
  for (const c of storySource.clips) {
    if (c?.id && c?.narrativeText) {
      sections[c.id] = {
        title: c.title || c.id,
        narrativeText: String(c.narrativeText).trim(),
      };
    }
  }
  return sections;
}
