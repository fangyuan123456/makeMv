import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { llmProvider, ChatMessage } from '../providers/llm.provider.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface GenreMeta {
  id: string;
  name: string;
  description: string;
}

export interface GenreModule {
  meta: GenreMeta;
  narrativeArc: string;
  negativeRules: string;
}

function findPromptsDir(): string {
  const candidates = [
    path.resolve(process.cwd(), 'server', 'src', 'prompts', 'templates'),
    path.resolve(process.cwd(), 'src', 'prompts', 'templates'),
    path.resolve(__dirname, '..', '..', 'src', 'prompts', 'templates'),
    path.resolve(__dirname, 'templates'),
    path.resolve(process.cwd(), 'prompts'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return path.resolve(__dirname, 'templates');
}

const PROMPTS_DIR = findPromptsDir();

/**
 * Lists all available modular genre definitions located in templates/genres/{genre_id}/meta.json
 */
export function listGenreModules(): GenreMeta[] {
  const genresDir = path.join(PROMPTS_DIR, 'genres');
  if (!fs.existsSync(genresDir)) {
    return [];
  }

  const entries = fs.readdirSync(genresDir, { withFileTypes: true });
  const list: GenreMeta[] = [];

  for (const entry of entries) {
    if (entry.isDirectory()) {
      const metaPath = path.join(genresDir, entry.name, 'meta.json');
      if (fs.existsSync(metaPath)) {
        try {
          const raw = fs.readFileSync(metaPath, 'utf-8');
          const meta = JSON.parse(raw) as GenreMeta;
          list.push(meta);
        } catch (err) {
          console.warn(`[loader] Failed to parse meta.json in ${entry.name}:`, err);
        }
      }
    }
  }

  return list;
}

/**
 * Loads a specific genre module (meta, narrativeArc, negativeRules).
 * Falls back to 'general' if the requested genreId does not exist.
 */
export function loadGenreModule(genreId: string = 'general'): GenreModule {
  const genresDir = path.join(PROMPTS_DIR, 'genres');
  let targetDir = path.join(genresDir, genreId);

  if (!fs.existsSync(targetDir)) {
    console.warn(`[loader] Genre "${genreId}" not found, falling back to "general"`);
    targetDir = path.join(genresDir, 'general');
  }

  // Fallback default if files are missing
  const defaultMeta: GenreMeta = {
    id: genreId,
    name: '经典通用影视',
    description: '标准经典影视结构',
  };

  let meta = defaultMeta;
  const metaPath = path.join(targetDir, 'meta.json');
  if (fs.existsSync(metaPath)) {
    try {
      meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
    } catch {}
  }

  const arcPath = path.join(targetDir, 'narrative_arc.txt');
  const narrativeArc = fs.existsSync(arcPath)
    ? fs.readFileSync(arcPath, 'utf-8').trim()
    : '起承转合标准推进。';

  const negPath = path.join(targetDir, 'negative_rules.txt');
  const negativeRules = fs.existsSync(negPath)
    ? fs.readFileSync(negPath, 'utf-8').trim()
    : '严禁角色违背常理逻辑。';

  return {
    meta,
    narrativeArc,
    negativeRules,
  };
}

/**
 * LLM Intent Router: Analyzes idea and visual style to choose the most fitting genre module.
 * If user explicitly provided preferredGenre, it honors it directly.
 */
export async function routeGenre(
  idea: string,
  style?: string,
  preferredGenre?: string
): Promise<{ genreId: string; reason: string }> {
  const allGenres = listGenreModules();

  // 1. If explicit preferredGenre is valid, honor directly
  if (preferredGenre && allGenres.some((g) => g.id === preferredGenre)) {
    const found = allGenres.find((g) => g.id === preferredGenre)!;
    return { genreId: found.id, reason: `创作者手动指定: ${found.name}` };
  }

  if (allGenres.length === 0) {
    return { genreId: 'general', reason: '未发现类型库，兜底通用模式' };
  }

  // 2. Call LLM Router with dynamic catalog generated from meta.json (Zero Hardcoding!)
  const catalog = allGenres
    .map((g) => `- [类型ID: ${g.id}] 《${g.name}》: ${g.description}`)
    .join('\n');

  const messages: ChatMessage[] = [
    {
      role: 'system',
      content: `你是顶级影视类型总监与故事架构策划。
创作者输入了故事灵感与视觉风格。你的职责是通读下方【已注册影视类型库】，理解创作者故事的核心冲突与主体特征，从中自主推断并挑选最精准匹配的类型 ID (genreId)。

【已注册影视类型库】：
${catalog}

若故事灵感较为宽泛或无法明显归入任一特定类型，请优先选择通用基础类型（如 general）。

严格输出纯 JSON：
{
  "genreId": "必须严格匹配上述类型库中存在的某个类型ID",
  "reason": "1-2句话简要说明判定依据"
}`.trim(),
    },
    {
      role: 'user',
      content: `【故事灵感】：\n${idea}\n\n【视觉风格】：\n${style || '默认'}`.trim(),
    },
  ];

  try {
    const res = await llmProvider.chatJSON<{ genreId: string; reason: string }>(messages);
    if (res?.genreId && allGenres.some((g) => g.id === res.genreId)) {
      return {
        genreId: res.genreId,
        reason: res.reason || `智能识别为《${allGenres.find((g) => g.id === res.genreId)?.name}》`,
      };
    }
  } catch (err) {
    console.warn('[routeGenre] LLM router failed, using fallback:', err);
  }

  return { genreId: 'general', reason: '通用影视基线' };
}

/**
 * Loads a prompt template file from the prompts directory.
 * @param category Folder under prompts/ (e.g. 'script', 'character', 'storyboard', 'video', 'style')
 * @param name File name without extension (e.g. 'generate_script', 'enhance', 'segment_design')
 * @param lang Preferred language code ('zh' or 'en')
 */
export function loadPrompt(category: string, name: string, lang: string = 'zh'): string {
  // 1. Try with lang suffix (e.g. generate_script_zh.txt)
  const langPath = path.join(PROMPTS_DIR, category, `${name}_${lang}.txt`);
  if (fs.existsSync(langPath)) {
    return fs.readFileSync(langPath, 'utf-8').trim();
  }

  // 2. Try with _zh fallback
  const zhPath = path.join(PROMPTS_DIR, category, `${name}_zh.txt`);
  if (fs.existsSync(zhPath)) {
    return fs.readFileSync(zhPath, 'utf-8').trim();
  }

  // 3. Try plain name without suffix (e.g. enhance.txt or realistic.txt)
  const plainPath = path.join(PROMPTS_DIR, category, `${name}.txt`);
  if (fs.existsSync(plainPath)) {
    return fs.readFileSync(plainPath, 'utf-8').trim();
  }

  throw new Error(`Prompt template not found: ${category}/${name} (${lang}) in ${PROMPTS_DIR}`);
}

/**
 * Interpolates variables into a prompt template string.
 * Supports both {variable} and {{variable}}.
 */
export function formatPrompt(template: string, variables: Record<string, any>): string {
  let result = template;
  for (const [key, value] of Object.entries(variables)) {
    const serialized = typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value ?? '');
    // Replace {key} and {{key}}
    result = result.replaceAll(`{${key}}`, serialized);
  }
  return result;
}

/**
 * Loads style modifier keywords and prefix/suffix from prompts/video/enhance.txt
 */
export function enhancePrompt(basePrompt: string, styleName?: string): string {
  try {
    const enhanceContent = loadPrompt('video', 'enhance', 'zh');
    const prefixMatch = enhanceContent.match(/\[prefix\]\s*([\s\S]*?)(?=\n\n|\n\[)/);
    const suffixMatch = enhanceContent.match(/\[suffix\]\s*([\s\S]*?)(?=\n\n|\n\[)/);

    const prefix = prefixMatch ? prefixMatch[1].trim() : 'high quality, 4K, detailed, cinematic footage,';
    const suffix = suffixMatch ? suffixMatch[1].trim() : ', realistic, high definition, masterpiece';

    let styleKeywords = '';
    if (styleName) {
      const styleRegex = new RegExp(`${styleName}\\s*:\\s*([^\\n]+)`, 'i');
      const styleMatch = enhanceContent.match(styleRegex);
      if (styleMatch) {
        styleKeywords = ` ${styleMatch[1].trim()}`;
      } else {
        styleKeywords = ` ${styleName}`;
      }
    }

    return `${prefix} ${basePrompt}${styleKeywords} ${suffix}`.trim();
  } catch {
    return `Cinematic, 4k, ${basePrompt}, ${styleName || ''}`.trim();
  }
}
