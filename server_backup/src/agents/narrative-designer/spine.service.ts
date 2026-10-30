import fs from 'fs';
import path from 'path';
import { AgentContext } from '../base/index.js';
import { StorySpineOutput, GoldenSpineAct, NarrativeDesignArtifact } from './types.js';
import { llmProvider, ChatMessage } from '../../providers/llm.provider.js';
import { loadPromptSafe } from '../../prompts/loader.js';

export class SpineService {
  /**
   * 生成第 1 步交付物：黄金戏剧主干大纲（四幕剧经典叙事弧光）。
   * Aligns 100% with server/data/examples/stage_1_narrative_spec/01_story_spine.md
   */
  async generateStorySpine(
    context: AgentContext,
    existingArtifact?: NarrativeDesignArtifact,
    userInstruction?: string
  ): Promise<StorySpineOutput> {
    const { session } = context;

    const systemPrompt = loadPromptSafe('bible', 'generate_spine', 'zh');

    const userPrompt = `
【核心创意与题材】：${session.meta.idea}
【目标视觉风格】：${session.meta.style}
${userInstruction ? `【用户补充特别要求】：\n${userInstruction}\n` : ''}

请严格按照范式要求，输出完整合法的 JSON 格式黄金故事主干原案（包含 title, theme, style, logline, sellingPoints, goldenSpine 4幕架构）。
`;

    const messages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ];

    let spine: StorySpineOutput;
    try {
      if (context.audit) {
        spine = await context.audit.trackLlmCall(
          { systemPrompt, userPrompt },
          'qwen-plus',
          () => llmProvider.chatJSON<StorySpineOutput>(messages, 0.7)
        );
      } else {
        spine = await llmProvider.chatJSON<StorySpineOutput>(messages, 0.7);
      }
    } catch (err: any) {
      console.error('[SpineService] 大模型故事主干生成或 JSON 解析失败:', err);
      throw new Error(`故事主干 (Golden Spine) 生成失败: ${err.message || String(err)}`);
    }

    // 校验并清洗各幕戏剧数据结构
    if (!spine || !spine.goldenSpine || spine.goldenSpine.length === 0) {
      throw new Error('大模型未返回有效的黄金四幕戏剧结构 (goldenSpine)，请检查提示词或重试。');
    }

    // 将 01_story_spine.md 导出至项目 narrative 目录
    this.exportMarkdown(context.projectDir, spine);

    return spine;
  }

  /**
   * 将戏剧主干对象导出为格式规范的 01_story_spine.md 文件。
   */
  exportMarkdown(projectDir: string, spine: StorySpineOutput): string {
    const md = this.formatToMarkdown(spine);
    try {
      const narrativeDir = path.join(projectDir, 'narrative');
      fs.mkdirSync(narrativeDir, { recursive: true });
      fs.writeFileSync(path.join(narrativeDir, '01_story_spine.md'), md, 'utf-8');
    } catch (err) {
      console.warn('[SpineService] Failed to export 01_story_spine.md:', err);
    }
    return md;
  }

  /**
   * 将戏剧主干结构标准化格式化为易读的 Markdown 文本。
   */
  formatToMarkdown(spine: StorySpineOutput): string {
    let md = `# 故事主干原案 (The Golden Spine)\n\n`;
    md += `> 本文档为【阶段1·互动叙事】第一序列表产物。确立全剧唯一的四幕戏剧主线（起承转合）、核心立意、题材风格与关键商业卖点，作为后续提取分支点与网状状态机的黄金基准。\n\n`;
    md += `---\n\n`;
    md += `## 1. 企划基本信息\n`;
    md += `- **片名标题**: 《${spine.title}》\n`;
    md += `- **题材类型**: ${spine.theme}\n`;
    md += `- **视觉风格**: ${spine.style}\n`;
    md += `- **预估总节点预算**: 10 个节点（控制在 3 分钟以内高密度互动体验）\n\n`;

    md += `## 2. 一句话故事总梗概 (Logline)\n`;
    md += `${spine.logline}\n\n`;

    md += `## 3. 核心商业与互动卖点 (Selling Points)\n`;
    for (const sp of spine.sellingPoints || []) {
      md += `- ${sp}\n`;
    }
    md += `\n`;

    md += `## 4. 黄金四幕戏剧结构 (The 4-Act Dramatic Spine)\n\n`;
    for (const act of spine.goldenSpine || []) {
      md += `### 第 ${act.act} 幕·${act.name.replace(/^第\s*\d+\s*幕[·:：\s]*/, '')}\n`;
      md += `- **戏剧功能定位**: ${act.dramaticFunction}\n`;
      md += `- **核心事件总述**: ${act.summary}\n`;
      md += `- **核心冲突**: ${act.coreConflict}\n`;
      md += `- **卡点悬念**: ${act.cliffhanger}\n`;
      md += `- **目标时长**: 约 ${act.targetDurationSec || 25} 秒\n\n`;
    }

    return md;
  }
}

export const spineService = new SpineService();
