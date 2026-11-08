/**
 * agents/director/modifier/attribute-classifier.ts
 * 属性类别补判器 (Modify Attribute Classifier)
 *
 * ── 为什么需要它 ──
 * source-resolver 用词表把自然语言映射成属性类别，这是闭集对开集：创作者说
 * 「让她别那么显老」「眼睛弄小点」，词表没收录就落 unknown，然后一路掉到
 * 「按实体所在产物」或「当前工作面」——源头悄悄判错，且没有任何报错。
 *
 * unknown 不等于「没有属性」，只等于「词表没收录」。所以这里补一次枚举选择：
 * 只回答 WHAT（六个类别之一），不参与 WHO、不选工序、不给理由长文。
 *
 * ── 必须允许弃权 ──
 * 「这个不行，换一个」「把它改回来」「太吵了」这类输入根本不含属性信息，
 * 强迫六选一的结果是模型自评「只能猜」（实测置信度 0.5）却仍被采纳，
 * 于是一句抱怨被派发成媒体轨重出图——真金白银的重生成。
 * 所以枚举里保留 'unknown' 作为合法输出，并在提示词里明确要求信息不足时弃权；
 * 调用方拿到 unknown 即回落原有兜底，绝不猜测。
 *
 * ── 刻意做小 ──
 * - 输出被限成 7 选 1 加一个置信度，约 30 token，比让模型产出整份改法快一个量级；
 * - 超时 4s 即放弃，绝不阻塞修改主流程；
 * - 任何异常（网络、解析、枚举越界、置信度不足）都返回 undefined，由调用方
 *   回落到既有的 WHO / 当前工作面兜底——补判只能加分，不能改坏原有判定。
 */

import { z } from 'zod';
import { LLMRegistry } from '../../../llm/LLMRegistry.js';
import { config } from '../../../utils/config.js';
import {
  CLASSIFIER_OUTPUTS,
  type ClassifiableAttribute,
  type ModifyAttribute,
} from './modify-attributes.js';

/** 兼容旧引用点：可判出的类别（不含 unknown） */
export { CLASSIFIABLE_ATTRIBUTES } from './modify-attributes.js';

export interface AttributeClassification {
  /** 模型给不出判断时必须是 'unknown'（弃权），不是硬猜一个类别 */
  attribute: ModifyAttribute;
  /** 0..1，低于阈值视为判不准 */
  confidence: number;
  reason?: string;
}

export type AttributeClassifier = (req: {
  content: string;
  target?: string;
  /** 最近几条用户诉求（时间正序，末条为最近），用于解析「再短一点」这类省略句 */
  history?: string[];
}) => Promise<AttributeClassification | undefined>;

const CLASSIFY_SCHEMA = z.object({
  attribute: z.enum(CLASSIFIER_OUTPUTS),
  confidence: z.number(),
  reason: z.string().optional(),
});

/**
 * 补判超时上限。实测真实模型 1.3–4.0s（含一次解析重试），4s 会把偶发慢请求
 * 判成超时——而超时等于放弃补判、退回可能判错的工作面。5s 给一次抖动余量，
 * 仍远低于「让模型产出整份改法」的量级。
 */
const DEFAULT_TIMEOUT_MS = 5000;

/* ─── 短期缓存：同一句话不重复付费 ─── */

const CACHE_TTL_MS = 5 * 60 * 1000;
const CACHE_MAX = 200;
const classifyCache = new Map<string, { at: number; result: AttributeClassification }>();

function readCache(key: string): AttributeClassification | undefined {
  const hit = classifyCache.get(key);
  if (!hit) return undefined;
  if (Date.now() - hit.at > CACHE_TTL_MS) {
    classifyCache.delete(key);
    return undefined;
  }
  return hit.result;
}

function writeCache(key: string, result: AttributeClassification): void {
  if (classifyCache.size >= CACHE_MAX) {
    // 简单 FIFO 淘汰：补判结果的价值只在于「同一句话短时间内的重复」，
    // 不需要真正的 LRU 精度。
    const oldest = classifyCache.keys().next().value;
    if (oldest !== undefined) classifyCache.delete(oldest);
  }
  classifyCache.set(key, { at: Date.now(), result });
}

/** 仅用于测试：清空缓存，避免用例之间互相命中 */
export function clearAttributeClassifierCache(): void {
  classifyCache.clear();
}

const SYSTEM_PROMPT = `你是影视制作流程的意图归类器。创作者刚提出一条修改诉求，你只判断他改的是「哪一类信息」，不判断改哪个工序、也不判断改谁。

类别定义（七选一）：
- setting：角色或故事的设定事实——年龄、性别、姓名、身份、性格、动机、人物关系、世界观、剧情走向、结局。
- appearance：角色自身的客观外观——发型、发色、服装、妆容、伤疤、纹身、体型、五官、配饰。
- dialogue：台词与场次内容——对白、语气、独白、旁白、某一场戏里发生什么、走位调度。
- shot：镜头语言——景别、运镜、机位、构图、镜头时长、拆分镜。
- visual：这一版画面怎么呈现——光影、色调、质感、画风、景深、清晰度、观感（显得年轻/太老）、剪辑节奏。
- media：直接指名某份媒体资产本身（定妆照、关键帧、成片、这段视频）要重出或说有瑕疵，且没提到具体是哪类属性。
- unknown：弃权。信息不足以判断，或这句话根本不是修改诉求。

判别要点：
1. 「显得 / 看起来 / 观感」谈的是画面效果，判 visual。
2. 但同一句里出现明确的数值或改写动作（「年龄也改成 30 岁」「性别改成女」）时判 setting，观感不能盖过显式设定。
3. 「发型 / 衣服 / 妆容」判 appearance；「这张图里头发有点糊」谈的是画面，判 visual。
4. 拿不准时，判断这句话改完之后「最先要动的是角色设定、剧本、分镜、还是画面」。
5. **必须弃权的情形**：只有否定、抱怨或指代（「这个不行」「换一个」「改回来」「不好看」），
   或只有程度副词且从历史里也看不出修饰对象（「再短一点」「再快一点」），或诉求不属于以上任何一类
   （声音、音量、配乐、字幕）。这些一律输出 unknown，不要为了给出答案而挑一个最接近的类别。
6. 本轮只有程度词或指代（「再短一点」「再明显些」「把这个调暗」），但历史诉求已经指明了对象与类别，
   就按历史的对象归类，confidence 给 0.7 左右；只有历史里也看不出对象时才弃权。
7. confidence 用 0-1：证据明确给 0.8 以上；信息不足但硬要分类时应低于 0.5——
   如果你认为自己在猜，就必须让 confidence 反映这一点。
8. reason 不超过 30 字。`;

/**
 * 补判一次属性类别。任何失败都返回 undefined（调用方回落到规则兜底）。
 *
 * 带一层短期缓存：创作者手滑重发、网络重试、同一句话连点两次，都是同一份判断，
 * 没必要重复付一次 2s 的延迟与 token。键里必须带历史末条，否则「再短一点」
 * 在不同上下文里会命中同一个缓存项，把结论张冠李戴。
 */
export async function classifyModifyAttribute(req: {
  content: string;
  target?: string;
  history?: string[];
  timeoutMs?: number;
  /** 仅用于日志/回归：本次调用耗时 */
  onLatency?: (ms: number) => void;
}): Promise<AttributeClassification | undefined> {
  const content = (req.content || '').trim();
  if (!content) return undefined;

  const history = (req.history || [])
    .map((h) => (h || '').trim())
    .filter(Boolean)
    .slice(-3);

  const cacheKey = [req.target || '', history[history.length - 1] || '', content].join('\u0001');
  const hit = readCache(cacheKey);
  if (hit) {
    console.log(`[Modifier] 属性补判命中缓存（${hit.attribute}/${hit.confidence}），跳过模型调用`);
    return hit;
  }

  const promptLines: string[] = [];
  if (req.target) promptLines.push(`修改对象：${req.target}`);
  if (history.length > 0) {
    promptLines.push(`最近的诉求（时间正序，供解析省略句用，本次要判的是最后一条）：`);
    history.forEach((h, i) => promptLines.push(`  ${i + 1}. ${h}`));
  }
  promptLines.push(`创作者原话：${content}`);

  let timer: NodeJS.Timeout | undefined;
  const startedAt = Date.now();
  const timeoutMs = req.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('属性补判超时')), timeoutMs);
    });
    const task = LLMRegistry.get().generateObject<{ attribute: string; confidence: number; reason?: string }>(
      promptLines.join('\n'),
      CLASSIFY_SCHEMA,
      SYSTEM_PROMPT,
      {
        stage: 'modify_attribute_classify',
        temperature: 0,
        // 96 太紧：attribute + confidence + 30 字 reason 已接近上限，截断会让
        // generateObject 走解析重试（再花一次 2s），最后撞上超时上限静默回落。
        maxTokens: 160,
        timeoutMs,
        projectId: undefined,
      }
    );
    const raw: any = await Promise.race([task, timeout]);

    const attribute = String(raw?.attribute || '').trim() as ModifyAttribute;
    if (!(CLASSIFIER_OUTPUTS as readonly string[]).includes(attribute)) {
      console.warn(`[Modifier] 属性补判返回了非法类别 [${raw?.attribute}]，回落规则兜底`);
      return undefined;
    }
    const confidence = Number(raw?.confidence);
    const result: AttributeClassification = {
      attribute,
      confidence: Number.isFinite(confidence) ? confidence : 0.5,
      reason: typeof raw?.reason === 'string' ? raw.reason.slice(0, 120) : undefined,
    };
    writeCache(cacheKey, result);
    return result;
  } catch (err: any) {
    console.warn(`[Modifier] 属性补判失败，回落规则兜底: ${err?.message || err}`);
    return undefined;
  } finally {
    if (timer) clearTimeout(timer);
    req.onLatency?.(Date.now() - startedAt);
  }
}

/** 便于测试与日志：是否属于可落地类别（排除弃权） */
export function isClassifiable(
  attribute: ModifyAttribute | undefined
): attribute is ClassifiableAttribute {
  return Boolean(attribute) && attribute !== 'unknown';
}

/**
 * 开关：默认开启，但单测与 Mock 环境一律关闭。
 * 单测里要验证补判行为，应通过 resolveModifySource 的 classify 参数显式注入，
 * 既不联网也不依赖 Mock 的兜底文本。
 */
export function isAttributeClassifierEnabled(): boolean {
  const flag = String(process.env.MODIFY_LLM_CLASSIFY || '').toLowerCase();
  if (['0', 'false', 'off', 'no'].includes(flag)) return false;
  if (process.env.NODE_ENV === 'test') return false;
  if (process.env.USE_MOCK_LLM === 'true' || config.mockMode) return false;
  return true;
}
