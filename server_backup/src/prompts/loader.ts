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

export interface PromptTemplateItem {
  id: string;
  name: string;
  description: string;
  fileName: string;
  language: 'zh' | 'en' | 'universal';
  variables?: string[];
}

export interface PromptCategoryInfo {
  category: string;
  name: string;
  description: string;
  items: PromptTemplateItem[];
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

export const PROMPTS_DIR = findPromptsDir();

/**
 * makeMv 创作工作室系统中的分类提示词模板注册表。
 */
export const PROMPT_CATEGORIES_REGISTRY: PromptCategoryInfo[] = [
  {
    category: 'bible',
    name: '全剧企划与故事圣经 (Story Bible)',
    description: '全剧宏观世界观、第一性原理主体地位、核心冲突、看点提炼及多集结构规划',
    items: [
      {
        id: 'generate_bible',
        name: '企划大纲与圣经架构',
        description: '依据核心灵感与匹配类型范式，生成工业级全剧圣经、主角清单及分集规划',
        fileName: 'generate_bible_zh.txt',
        language: 'zh',
        variables: ['genre_name', 'genre_id', 'genre_description', 'genre_reason', 'narrative_arc', 'negative_rules', 'episodes'],
      },
      {
        id: 'revise_bible',
        name: '大纲AI定向修订 (Copilot)',
        description: '响应创作者自然语言指令，对大纲圣经进行定向重构与增删修饰，保留未修改核心设定',
        fileName: 'revise_bible_zh.txt',
        language: 'zh',
        variables: ['genre_name', 'genre_id', 'genre_description', 'narrative_arc', 'negative_rules'],
      },
      {
        id: 'route_genre',
        name: '影视类型意图智能推断',
        description: '通读已注册影视范式库，精准识别灵感所属影视类型 ID',
        fileName: 'route_genre_zh.txt',
        language: 'zh',
        variables: ['catalog'],
      },
    ],
  },
  {
    category: 'script',
    name: '单集剧本与分场编写 (Episode Script)',
    description: '从大纲下钻深化至单集视听分场剧本，包含开场抓眼钩子、结尾悬念断章及连续性台词动作',
    items: [
      {
        id: 'expand_episode',
        name: '单集视听深化分场剧本',
        description: '按标准影视剧本规范（场志、镜头调度、对白与动作反应）深化单集剧本',
        fileName: 'expand_episode_zh.txt',
        language: 'zh',
        variables: ['genre_name', 'genre_id', 'genre_description', 'narrative_arc', 'negative_rules', 'episode_number', 'episode_title'],
      },
      {
        id: 'smart_continue_script',
        name: '剧本断点智能续写',
        description: '延续前文情节点与人物状态，自洽无缝续写后续场景与冲突',
        fileName: 'smart_continue_script_zh.txt',
        language: 'zh',
      },
      {
        id: 'repair_episode_count',
        name: '剧本集数与格式自愈修正',
        description: '修复剧本集数缺失、格式溢出或行数不合规问题',
        fileName: 'repair_episode_count_zh.txt',
        language: 'zh',
      },
      {
        id: 'eval_dialogue',
        name: '剧本对白质量评估',
        description: '评估台词张力、角色声线及对话密度',
        fileName: 'eval_dialogue_zh.txt',
        language: 'zh',
      },
      {
        id: 'eval_plot',
        name: '剧情节奏与冲突评估',
        description: '审查故事节拍推进与悬念钩子设置',
        fileName: 'eval_plot_zh.txt',
        language: 'zh',
      },
    ],
  },
  {
    category: 'character',
    name: '角色与实体视觉设计 (Character Design)',
    description: '角色概念设定卡、各视角规范与英文生图提示词独立提炼',
    items: [
      {
        id: 'character_design',
        name: '顶级概念设计师视觉卡',
        description: '为人/兽/神魔/机甲输出外观质感、服饰装甲与高密度中文生图 Prompt (imagePrompt)',
        fileName: 'character_design_zh.txt',
        language: 'zh',
      },
      {
        id: 'character',
        name: '角色四视角标准生图模板',
        description: '生成正面肖像、正面全身、侧面全身与背面全身一致性设计图',
        fileName: 'character_zh.txt',
        language: 'zh',
        variables: ['style', 'name', 'desc'],
      },
      {
        id: 'eval_character',
        name: '角色一致性与画质评估',
        description: '多维度审查角色形体、肤质及是否契合故事设定',
        fileName: 'eval_character_zh.txt',
        language: 'zh',
      },
      {
        id: 'eval_select_best',
        name: '角色多版本优选推荐',
        description: '在多次生成的候选角色图片中打分并推荐最佳版本',
        fileName: 'eval_select_best_zh.txt',
        language: 'zh',
      },
      {
        id: 'refine_prompt',
        name: '角色生图提示词定向微调',
        description: '响应创作者中文微调指令，无缝融合优化为高质感英文生图 Prompt',
        fileName: 'refine_prompt_zh.txt',
        language: 'zh',
      },
    ],
  },
  {
    category: 'storyboard',
    name: '影视分镜头与视听调度 (Storyboard & Staging)',
    description: '规划环环相扣连续镜头组、主角视线支配、影调光影统合及分镜工业级连续性审计',
    items: [
      {
        id: 'storyboard_design',
        name: '影视分镜头组规划',
        description: '规划 5 个遵循起承转合余的连续镜头，填入精确景别、机位、运镜及 Prompt',
        fileName: 'storyboard_design_zh.txt',
        language: 'zh',
      },
      {
        id: 'staging_continuity',
        name: '分镜连续性工业级审计',
        description: '严格检查空间连续性、站位轴线与核心主角支配度，输出问题与修补方案',
        fileName: 'staging_continuity_zh.txt',
        language: 'zh',
        variables: ['episode_number', 'episode_title', 'retry_feedback', 'segments'],
      },
      {
        id: 'segment_design',
        name: '分段镜头细化设计',
        description: '将剧本细分片段逐一映射至镜头单元',
        fileName: 'segment_design_zh.txt',
        language: 'zh',
        variables: ['episode_number', 'episode_title', 'segment_number', 'location', 'characters', 'style', 'items'],
      },
      {
        id: 'segment_plan',
        name: '镜头时序与时长规划',
        description: '规划镜头节奏与画面总时长配置',
        fileName: 'segment_plan_zh.txt',
        language: 'zh',
      },
    ],
  },
  {
    category: 'reference',
    name: '首帧与视觉参考 (Visual Reference)',
    description: '镜头首帧锚定、多角色融合与场景环境光源锁死',
    items: [
      {
        id: 'first_frame',
        name: '首帧视觉参考提示词',
        description: '为镜头起始帧生成高一致性生图提示词',
        fileName: 'first_frame_zh.txt',
        language: 'zh',
      },
      {
        id: 'eval_first_frame',
        name: '首帧参考图质量与连贯性评估',
        description: '审查生成的参考图是否贴合分镜与角色外貌',
        fileName: 'eval_first_frame_zh.txt',
        language: 'zh',
      },
    ],
  },
  {
    category: 'video',
    name: '视频生成与动力学镜头 (Video Generation & Motion)',
    description: '视频前后缀增强、电影级胶片质感及镜头动力学运镜控制',
    items: [
      {
        id: 'enhance',
        name: '视频生成提示词增强库',
        description: '包含高质量前缀 (prefix)、无畸变后缀 (suffix) 与各艺术画风匹配词',
        fileName: 'enhance.txt',
        language: 'universal',
      },
      {
        id: 'motion_prompt',
        name: '运镜与动力学运动词库',
        description: '提供推、拉、摇、移、跟、升降及手持微晃的精准英文提示词',
        fileName: 'motion_prompt_zh.txt',
        language: 'zh',
      },
    ],
  },
  {
    category: 'genres',
    name: '影视类型与戏剧范式库 (Genre Paradigms)',
    description: '解耦独立的影视类型范式，包含专属叙事弧线 (narrative_arc) 与一票否决负面禁忌 (negative_rules)',
    items: [
      {
        id: 'general',
        name: '经典通用影视范式',
        description: '标准经典影视结构，稳健普适的起承转合',
        fileName: 'genres/general',
        language: 'universal',
      },
      {
        id: 'interactive_fmv',
        name: '互动影游范式 (FMV / 完蛋!)',
        description: '第一人称 POV 视角、直面镜头视线交互、心动感、高频强分支选择与好感度羁绊',
        fileName: 'genres/interactive_fmv',
        language: 'universal',
      },
      {
        id: 'versus',
        name: '宿命对决范式 (Versus / 双雄争霸)',
        description: '双核心主角绝对视线中心，交锋对抗、战损升级、宿命压迫感',
        fileName: 'genres/versus',
        language: 'universal',
      },
      {
        id: 'suspense',
        name: '悬疑推理范式 (Suspense / 破案解谜)',
        description: '线索前置、多重视角误导、层层抽丝剥茧与高能惊天逆转',
        fileName: 'genres/suspense',
        language: 'universal',
      },
      {
        id: 'scifi_adventure',
        name: '科幻冒险范式 (Sci-Fi / 机甲巨构)',
        description: '硬核工业美学、世界观沉浸感与震撼视听奇观',
        fileName: 'genres/scifi_adventure',
        language: 'universal',
      },
      {
        id: 'short_drama',
        name: '快节奏短剧范式 (Short Drama)',
        description: '极致情绪反弹、短平快打脸逆袭与每集高潮黄金断章',
        fileName: 'genres/short_drama',
        language: 'universal',
      },
    ],
  },
  {
    category: 'style',
    name: '视觉渲染与艺术风格库 (Visual Styles)',
    description: '直接可注入提示词的专业艺术画风描述符',
    items: [
      { id: 'realistic', name: '电影写实 (Cinematic Realistic)', description: '电影级写实质感、自然环境光影、85mm镜头光圈', fileName: 'realistic.txt', language: 'universal' },
      { id: 'cyberpunk', name: '赛博朋克 (Cyberpunk)', description: '霓虹冷暖对比、高科技低生活、全息雨夜雨渍', fileName: 'cyberpunk.txt', language: 'universal' },
      { id: 'anime', name: '日式动漫 (Anime / Makoto Shinkai)', description: '赛璐珞上色、新海诚高光粒子、明快透亮调色', fileName: 'anime.txt', language: 'universal' },
      { id: 'chinese-ink', name: '国风水墨 (Chinese Ink)', description: '泼墨留白、东方气韵、古朴意境水墨流转', fileName: 'chinese-ink.txt', language: 'universal' },
      { id: '3d-disney', name: '3D 迪士尼/皮克斯 (3D Disney)', description: '3D动画质感、柔和SSS皮肤次表面散射、童话光感', fileName: '3d-disney.txt', language: 'universal' },
      { id: 'comic-book', name: '美漫风格 (Comic Book)', description: '粗犷墨线、网点阴影、波普艺术张力', fileName: 'comic-book.txt', language: 'universal' },
      { id: 'oil-painting', name: '古典油画 (Oil Painting)', description: '重彩肌理、古典厚涂笔触、伦勃朗光影', fileName: 'oil-painting.txt', language: 'universal' },
      { id: 'cartoon', name: '欧美卡通 (Cartoon)', description: '夸张形体设计、扁平鲜活色彩', fileName: 'cartoon.txt', language: 'universal' },
    ],
  },
  {
    category: 'doctor',
    name: '错误自愈与诊断医生 (Doctor Self-Healing)',
    description: '大模型生成安全审查违规、超长提示词拦截及格式错误的自动诊断与定向自愈重写',
    items: [
      {
        id: 'diagnose',
        name: '生成错误自愈诊断',
        description: '分析报错根因，判断是否可通过改写提示词完成自动挽回重试',
        fileName: 'diagnose_zh.txt',
        language: 'zh',
      },
      {
        id: 'rewrite_prompt',
        name: '提示词智能合规与安全重写',
        description: '在保留原始核心创意与视觉要素的前提下，替换敏感词并压缩精炼提示词',
        fileName: 'rewrite_prompt_zh.txt',
        language: 'zh',
      },
    ],
  },
];

/**
 * 返回系统中所有提示词模板的分类目录清单。
 */
export function listPromptCategories(): PromptCategoryInfo[] {
  return PROMPT_CATEGORIES_REGISTRY;
}

/**
 * 列出所有可用的模块化题材流派定义 (templates/genres/{genre_id}/meta.json)。
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
 * 加载特定题材流派模块（元信息、叙事弧光、负向避坑规则）。
 * 若请求的题材不存在，自动回退到 'general' 通用流派。
 */
export function loadGenreModule(genreId: string = 'general'): GenreModule {
  const genresDir = path.join(PROMPTS_DIR, 'genres');
  let targetDir = path.join(genresDir, genreId);

  if (!fs.existsSync(targetDir)) {
    console.warn(`[loader] Genre "${genreId}" not found, falling back to "general"`);
    targetDir = path.join(genresDir, 'general');
  }

  // 若配置文件缺失时的通用默认兜底
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

const PROMPT_ALIASES: Record<string, string> = {
  'bible/bible_generation': 'generate_bible',
  'bible/bible': 'generate_bible',
  'script/script_expansion': 'expand_episode',
  'storyboard/storyboard': 'storyboard_design',
};

/**
 * 从提示词模板目录加载指定模板文件。
 * @param category templates/ 下的分类子目录（如 'bible'、'script'、'character'、'storyboard'、'video'、'style'、'doctor'）
 * @param name 模板文件名（不含扩展名，如 'generate_bible'、'expand_episode'、'enhance'）
 * @param lang 优先语言代码（'zh' 或 'en'）
 */
export function loadPrompt(category: string, name: string, lang: string = 'zh'): string {
  const actualName = PROMPT_ALIASES[`${category}/${name}`] || name;

  // 1. 优先尝试带语言后缀的模板（例如 generate_bible_zh.txt）
  const langPath = path.join(PROMPTS_DIR, category, `${actualName}_${lang}.txt`);
  if (fs.existsSync(langPath)) {
    return fs.readFileSync(langPath, 'utf-8').trim();
  }

  // 2. 尝试使用 _zh 中文后缀兜底
  const zhPath = path.join(PROMPTS_DIR, category, `${actualName}_zh.txt`);
  if (fs.existsSync(zhPath)) {
    return fs.readFileSync(zhPath, 'utf-8').trim();
  }

  // 3. 尝试使用无语言后缀的原生文件名（例如 enhance.txt 或 realistic.txt）
  const plainPath = path.join(PROMPTS_DIR, category, `${actualName}.txt`);
  if (fs.existsSync(plainPath)) {
    return fs.readFileSync(plainPath, 'utf-8').trim();
  }

  throw new Error(`Prompt template not found: ${category}/${name} (${lang}) in ${PROMPTS_DIR}`);
}

/**
 * 加载提示词模板，若文件不存在则返回预设的默认兜底文本。
 */
export function loadPromptSafe(category: string, name: string, lang: string = 'zh', fallback: string = ''): string {
  try {
    return loadPrompt(category, name, lang);
  } catch (err) {
    if (fallback) return fallback;
    console.warn(`[loader] Prompt template not found: ${category}/${name}, using empty string`);
    return '';
  }
}

/**
 * 将动态变量插值替换到提示词模板字符串中。
 * 同时兼容 {variable} 与 {{variable}} 两种占位符语法。
 */
export function formatPrompt(template: string, variables: Record<string, any>): string {
  let result = template;
  for (const [key, value] of Object.entries(variables)) {
    const serialized = typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value ?? '');
    // 先替换 {{key}} 双大括号，再替换 {key} 单大括号，避免产生残留符号
    result = result.replaceAll(`{{${key}}}`, serialized);
    result = result.replaceAll(`{${key}}`, serialized);
  }
  return result;
}

/**
 * 大模型意图路由分类器：分析用户灵感创意与视觉风格，匹配最契合的影视游戏题材流派。
 * 若创作者显式指定了偏好题材，直接遵循该设定。
 */
export async function routeGenre(
  idea: string,
  style?: string,
  preferredGenre?: string
): Promise<{ genreId: string; reason: string }> {
  const allGenres = listGenreModules();

  // 1. 若显式指定的 preferredGenre 有效，直接采用
  if (preferredGenre && allGenres.some((g) => g.id === preferredGenre)) {
    const found = allGenres.find((g) => g.id === preferredGenre)!;
    return { genreId: found.id, reason: `创作者手动指定: ${found.name}` };
  }

  if (allGenres.length === 0) {
    return { genreId: 'general', reason: '未发现类型库，兜底通用模式' };
  }

  // 2. 根据题材目录调用大模型意图路由器进行题材分类
  const catalog = allGenres
    .map((g) => `- [类型ID: ${g.id}] 《${g.name}》: ${g.description}`)
    .join('\n');

  let systemPrompt = '';
  try {
    const template = loadPrompt('bible', 'route_genre', 'zh');
    systemPrompt = formatPrompt(template, { catalog });
  } catch {
    systemPrompt = `你是顶级影视类型总监与故事架构策划。
创作者输入了故事灵感与视觉风格。你的职责是通读下方【已注册影视类型库】，理解创作者故事的核心冲突与主体特征，从中自主推断并挑选最精准匹配的类型 ID (genreId)。

【已注册影视类型库】：
${catalog}

若故事灵感较为宽泛或无法明显归入任一特定类型，请优先选择通用基础类型（如 general）。

严格输出纯 JSON：
{
  "genreId": "必须严格匹配上述类型库中存在的某个类型ID",
  "reason": "1-2句话简要说明判定依据"
}`.trim();
  }

  const messages: ChatMessage[] = [
    {
      role: 'system',
      content: systemPrompt,
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
 * 从 templates/video/enhance.txt 中加载风格修饰词、前缀及后缀描述
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
    return `电影级质感，4K超高清，${basePrompt}，${styleName || ''}`.trim();
  }
}
