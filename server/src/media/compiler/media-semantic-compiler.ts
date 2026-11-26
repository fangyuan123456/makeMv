/**
 * server/src/media/compiler/media-semantic-compiler.ts
 * 统一媒体语义编译器 (Media Semantic Compiler SSOT)
 *
 * 核心职责：
 * 1. 纯自然语言实体解析：从文学正文中按法定标准全名（长名优先 + 占位遮罩）提取角色、道具、场景及对应定妆图；
 * 2. 媒体多模态注意力编译：将正文中的实体名称编译映射为 <imageN>(实体名)，建立硬件级交叉注意力（Cross-Attention）；
 * 3. 编排多图队列：合并前序接戏尾帧、用户临时垫图与资产定妆图，严格排序去重；
 * 4. 自动视角解绑与模式决断：注入场景机位解绑声明，无资产自动走 t2i，有资产自动走 ref2i。
 */

import {
  CINEMATIC_CONTINUITY_LOCK,
  CINEMATIC_KEYFRAME_NEGATIVE_PROMPT,
} from '../../tools/film-production/shared/cinematography-grammar.js';

export interface AvailableEntitiesInput {
  characters?: Array<{ characterId?: string; id?: string; name: string; imageUrl?: string; referenceImageUrl?: string; identity?: string; [key: string]: any }>;
  locations?: Array<{ locationId?: string; id?: string; name: string; imageUrl?: string; referenceImageUrl?: string; spatialLayout?: string; [key: string]: any }>;
  items?: Array<{ itemId?: string; id?: string; name: string; imageUrl?: string; referenceImageUrl?: string; [key: string]: any }>;
}

export interface MatchedCharacter {
  characterId: string;
  name: string;
  imageUrl?: string;
  referenceImageUrl?: string;
  identity?: string;
}

export interface MatchedItem {
  itemId: string;
  name: string;
  imageUrl?: string;
  referenceImageUrl?: string;
}

export interface MatchedLocation {
  locationId: string;
  name: string;
  imageUrl?: string;
  referenceImageUrl?: string;
  spatialLayout?: string;
}

export interface ResolvedEntityBindings {
  characterIds: string[];
  matchedCharacters: MatchedCharacter[];
  characterImages: string[];
  itemIds: string[];
  matchedItems: MatchedItem[];
  itemImages: string[];
  locationId?: string;
  locationName?: string;
  matchedLocation?: MatchedLocation;
  locationImage?: string;
}

export interface KeyframeReferenceEntry {
  role: 'custom' | 'base_frame' | 'location' | 'character' | 'item' | 'first_frame' | 'preceding_frame';
  url: string;
  id?: string;
  name?: string;
  identity?: string;
}

export interface MediaCompileInput {
  text: string;
  entities?: AvailableEntitiesInput;
  precedingFrameUrl?: string;
  precedingFrameName?: string;
  customReferenceUrls?: string[];
  baseFrameUrl?: string; // 微调重绘原图
  instruction?: string;  // 微调指令
  poseDirective?: any;   // 动作姿态硬约束
  overrideNegativePrompt?: string;
}

export interface CompiledMediaResult {
  compiledPrompt: string;
  negativePrompt: string;
  referenceImageUrls: string[];
  mode: 'character_ref2i' | 'character_t2i';
  resolvedEntities: ResolvedEntityBindings;
  references: KeyframeReferenceEntry[];
}

function cleanMediaUrl(url?: string): string {
  if (!url) return '';
  return url.split('?')[0].trim();
}

function escapeRegExp(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 通用实体绑定解析器：
 * 从纯文本中按法定标准全名（长名优先 + 占位遮罩）提取已出现的角色、道具和场景资产引用及其对应图片
 */
export function resolveEntityBindingsFromText(
  text: string,
  entities: AvailableEntitiesInput = {}
): ResolvedEntityBindings {
  if (!text) {
    return {
      characterIds: [],
      matchedCharacters: [],
      characterImages: [],
      itemIds: [],
      matchedItems: [],
      itemImages: [],
    };
  }

  // 1. 角色匹配 (长名优先 + 占位遮罩，杜绝“陈小满爷爷”误触发子词“陈小满”)
  const availableChars: MatchedCharacter[] = (entities.characters || [])
    .map((c) => ({
      characterId: c.characterId || c.id || '',
      name: c.name?.trim() || '',
      imageUrl: cleanMediaUrl(c.imageUrl || c.referenceImageUrl),
      referenceImageUrl: cleanMediaUrl(c.referenceImageUrl || c.imageUrl),
      identity: c.identity,
    }))
    .filter((c) => c.characterId && c.name)
    .sort((a, b) => b.name.length - a.name.length);

  const matchedChars: MatchedCharacter[] = [];
  const matchedCharIds = new Set<string>();
  let charScanText = text;

  for (const c of availableChars) {
    if (charScanText.includes(c.name)) {
      matchedChars.push(c);
      matchedCharIds.add(c.characterId);
      charScanText = charScanText.replaceAll(c.name, '§'.repeat(c.name.length));
    }
  }

  matchedChars.sort((a, b) => text.indexOf(a.name) - text.indexOf(b.name));
  const characterImages = matchedChars
    .map((c) => c.imageUrl)
    .filter((img): img is string => Boolean(img));

  // 2. 道具匹配 (长名优先 + 占位遮罩)
  const availableItems: MatchedItem[] = (entities.items || [])
    .map((it) => ({
      itemId: it.itemId || it.id || '',
      name: it.name?.trim() || '',
      imageUrl: cleanMediaUrl(it.imageUrl || it.referenceImageUrl),
      referenceImageUrl: cleanMediaUrl(it.referenceImageUrl || it.imageUrl),
    }))
    .filter((it) => it.itemId && it.name)
    .sort((a, b) => b.name.length - a.name.length);

  const matchedItems: MatchedItem[] = [];
  const matchedItemIds = new Set<string>();
  let itemScanText = text;

  for (const it of availableItems) {
    if (itemScanText.includes(it.name)) {
      matchedItems.push(it);
      matchedItemIds.add(it.itemId);
      itemScanText = itemScanText.replaceAll(it.name, '§'.repeat(it.name.length));
    }
  }

  matchedItems.sort((a, b) => text.indexOf(a.name) - text.indexOf(b.name));
  const itemImages = matchedItems
    .map((it) => it.imageUrl)
    .filter((img): img is string => Boolean(img));

  // 3. 场景匹配 (长名优先 + 占位遮罩)
  const availableLocs: MatchedLocation[] = (entities.locations || [])
    .map((l) => ({
      locationId: l.locationId || l.id || '',
      name: l.name?.trim() || '',
      imageUrl: cleanMediaUrl(l.imageUrl || l.referenceImageUrl),
      referenceImageUrl: cleanMediaUrl(l.referenceImageUrl || l.imageUrl),
      spatialLayout: l.spatialLayout,
    }))
    .filter((l) => l.locationId && l.name)
    .sort((a, b) => b.name.length - a.name.length);

  let matchedLoc: MatchedLocation | undefined;
  for (const l of availableLocs) {
    if (text.includes(l.name)) {
      matchedLoc = l;
      break;
    }
  }

  return {
    characterIds: Array.from(matchedCharIds),
    matchedCharacters: matchedChars,
    characterImages,
    itemIds: Array.from(matchedItemIds),
    matchedItems: matchedItems,
    itemImages,
    locationId: matchedLoc?.locationId,
    locationName: matchedLoc?.name,
    matchedLocation: matchedLoc,
    locationImage: matchedLoc?.imageUrl,
  };
}

function appendUniqueReference(
  list: KeyframeReferenceEntry[],
  seenUrls: Set<string>,
  entry: KeyframeReferenceEntry
): void {
  const normalized = cleanMediaUrl(entry.url);
  if (!normalized || seenUrls.has(normalized)) return;
  seenUrls.add(normalized);
  list.push({ ...entry, url: normalized });
}

export function buildReferenceMappingSection(references: KeyframeReferenceEntry[]): string {
  if (!references.length) return '';

  const lines = references.map((ref, idx) => {
    const tag = `<image${idx + 1}>`;
    switch (ref.role) {
      case 'custom':
        return `- ${tag} 为参考图：参考其画面构图与光影氛围。`;
      case 'base_frame':
        return `- ${tag} 为修改基准图：保留创作者未要求修改的属性；明确要求改变的机位、构图、空间、光照或角色特征以新要求为准。`;
      case 'preceding_frame': {
        const label = ref.name ? `「${ref.name}」` : '前序镜头';
        return `- ${tag} 为${label}画面：继承其光照方向、色彩分级与时空连续性。`;
      }
      case 'location': {
        const label = ref.name ? `「${ref.name}」` : '场景';
        return `- ${tag} 为${label}环境美术与材质母本：仅提取其建筑材质、空间质感与光色风格；严禁复刻其原始拍摄机位，本镜头的摄影机角度（俯仰/平视/特写）、拍摄朝向与人物站位完全以本镜台本为准。`;
      }
      case 'character': {
        const label = ref.name ? `「${ref.name}」` : '角色';
        const desc = ref.identity ? `（${ref.identity}）` : '';
        return `- ${tag} 为${label}${desc}定妆基准：仅提取单一人脸骨相五官、发型与服装款式特征；【严禁复刻定妆图中的全身站立骨架】，当前镜头的肢体姿态、关节折叠、重心受力与道具握持完全以本镜头台本动作指令为准！`;
      }
      case 'item': {
        const label = ref.name ? `「${ref.name}」` : '道具';
        return `- ${tag} 为${label}道具设定图：继承其外形结构与材质纹理，自然融入当前场景环境中。`;
      }
      case 'first_frame':
        return `- ${tag} 为首帧实拍图：保持角色造型与光影连续，演进至尾帧状态。`;
    }
  });

  return `【参考资产映射】\n${lines.join('\n')}`;
}

/**
 * 基于引用列表与资产库编译多模态提示词
 */
export function buildMediaPromptFromReferences(
  rawBase: string,
  references: KeyframeReferenceEntry[] = [],
  instruction?: string,
  entities?: AvailableEntitiesInput
): string {
  let normalizedBase = (rawBase || '').trim();
  const referencedNames = new Set<string>();

  if (references.length > 0) {
    const indexedRefs = references
      .map((ref, originalIdx) => ({
        ref,
        originalIdx,
        tag: `<image${originalIdx + 1}>(${ref.name || ref.id})`,
        name: ref.name?.trim(),
        id: ref.id?.trim(),
      }))
      .sort((a, b) => (b.name?.length || 0) - (a.name?.length || 0));

    for (const item of indexedRefs) {
      if (item.name) {
        referencedNames.add(item.name);
        const atRegex = new RegExp(`[@＠]\\s*${escapeRegExp(item.name)}`, 'g');
        normalizedBase = normalizedBase.replace(atRegex, item.tag);

        const plainRegex = new RegExp(`(?<!<image\\d+>\\()${escapeRegExp(item.name)}`, 'g');
        normalizedBase = normalizedBase.replace(plainRegex, item.tag);
      }
      if (item.id) {
        const idRegex = new RegExp(`[@＠]\\s*${escapeRegExp(item.id)}\\b`, 'g');
        normalizedBase = normalizedBase.replace(idRegex, item.tag);
      }
    }

    // 2.1 针对 @link(...) 或 @preceding 接戏标记的精准图文映射
    const pIdx = references.findIndex((r) => r.role === 'preceding_frame');
    if (pIdx >= 0) {
      const linkTag = `<image${pIdx + 1}>(${references[pIdx].name || '前序尾帧'})`;
      normalizedBase = normalizedBase.replace(/[@＠]link(?:\([^)]*\))?/g, linkTag);
      normalizedBase = normalizedBase.replace(/[@＠](?:preceding|preceding_frame)/g, linkTag);
    }
  }

  if (entities) {
    const allEntityItems: Array<{ id?: string; characterId?: string; locationId?: string; itemId?: string; name: string; promptZh?: string; appearanceSummary?: string; atmosphere?: string }> = [
      ...(Array.isArray(entities.characters) ? entities.characters : []),
      ...(Array.isArray(entities.locations) ? entities.locations : []),
      ...(Array.isArray(entities.items) ? entities.items : []),
    ];
    allEntityItems.sort((a, b) => (b.name?.length || 0) - (a.name?.length || 0));

    for (const item of allEntityItems) {
      if (!item.name || referencedNames.has(item.name)) continue;

      const visualDesc = item.promptZh || item.appearanceSummary || item.atmosphere;
      if (!visualDesc) continue;

      const fallbackText = `${item.name}（${visualDesc}）`;
      if (normalizedBase.includes(item.name)) {
        const plainNameRegex = new RegExp(`(?<!<image\\d+>\\()${escapeRegExp(item.name)}`, 'g');
        normalizedBase = normalizedBase.replace(plainNameRegex, fallbackText);
      }
    }
  }

  normalizedBase = normalizedBase.replace(/[@＠](?:frame_0|first_frame|首帧)/g, '起幅');
  normalizedBase = normalizedBase.replace(/[@＠]([a-zA-Z0-9_\u4e00-\u9fa5]+)/g, '$1');

  const mappingSection = buildReferenceMappingSection(references);
  const editInstructionSection = instruction?.trim()
    ? `【画面微调要求】\n${instruction.trim()}\n本次明确要求修改的属性优先于旧台本、参考图和连续性默认要求；只保留未指定修改的属性。`
    : '';

  const sections = [
    normalizedBase,
    editInstructionSection,
    mappingSection,
    CINEMATIC_CONTINUITY_LOCK,
  ].filter(Boolean);

  return sections.join('\n\n');
}

/**
 * 核心媒体编译入口：
 * 接收纯自然语言提示词 + 资产库 + 辅助帧，内部全自动编译出流入 ComfyUI 的完整多模态提示词与参考图列表
 */
export function compileMediaPrompt(input: MediaCompileInput): CompiledMediaResult {
  const {
    text,
    entities = {},
    precedingFrameUrl,
    precedingFrameName,
    customReferenceUrls = [],
    baseFrameUrl,
    instruction,
    poseDirective,
    overrideNegativePrompt,
  } = input;

  const rawBase = (text || '').trim();
  const resolved = resolveEntityBindingsFromText(rawBase, entities);

  // 1. 编排参考图有序队列
  const references: KeyframeReferenceEntry[] = [];
  const seen = new Set<string>();

  // 1.1 微调基准图（最高优先级）
  if (baseFrameUrl) {
    appendUniqueReference(references, seen, {
      role: 'base_frame',
      url: baseFrameUrl,
    });
  }

  // 1.2 用户手动指定的垫图参考
  for (const url of customReferenceUrls) {
    appendUniqueReference(references, seen, {
      role: 'custom',
      url,
    });
  }

  // 1.3 前序镜头接戏末帧
  let precedingEntry: KeyframeReferenceEntry | undefined;
  if (precedingFrameUrl) {
    precedingEntry = {
      role: 'preceding_frame',
      url: precedingFrameUrl,
      name: precedingFrameName || '前序镜头尾帧',
    };
    appendUniqueReference(references, seen, precedingEntry);
  }

  // 1.4 入画角色定妆图（优先作为人物视觉锚点）
  for (const ch of resolved.matchedCharacters) {
    if (ch.imageUrl) {
      appendUniqueReference(references, seen, {
        role: 'character',
        url: ch.imageUrl,
        id: ch.characterId,
        name: ch.name,
        identity: ch.identity,
      });
    }
  }

  // 1.5 场景空间母本图（材质与色温参考）
  // ⭐ 通用景别参考图分流路由：当中景/特写镜头存在入画人物时，阻断全景场景参考图的强结构注入，杜绝居中地标家具对人像中景的结构污染
  const isMediumOrCloseUp = /中景|近景|特写|大特写|半身|MCU|CU|ECU|Medium Shot|Close-Up/i.test(rawBase);
  const hasFocusedCharacters = resolved.matchedCharacters.length > 0;
  const shouldSkipLocationImage = isMediumOrCloseUp && hasFocusedCharacters;

  if (resolved.matchedLocation?.imageUrl && !shouldSkipLocationImage) {
    appendUniqueReference(references, seen, {
      role: 'location',
      url: resolved.matchedLocation.imageUrl,
      id: resolved.matchedLocation.locationId,
      name: resolved.matchedLocation.name,
    });
  }

  // 1.6 关键剧情道具图
  for (const it of resolved.matchedItems) {
    if (it.imageUrl) {
      appendUniqueReference(references, seen, {
        role: 'item',
        url: it.imageUrl,
        id: it.itemId,
        name: it.name,
      });
    }
  }

  // 2. 智能多模态图文注意力编译：正文中的纯全名自动对齐映射为 <imageN>(实体名)
  let normalizedBase = rawBase;
  const referencedNames = new Set<string>();

  if (references.length > 0) {
    const indexedRefs = references
      .map((ref, originalIdx) => ({
        ref,
        originalIdx,
        tag: `<image${originalIdx + 1}>(${ref.name || ref.id})`,
        name: ref.name?.trim(),
        id: ref.id?.trim(),
      }))
      .sort((a, b) => (b.name?.length || 0) - (a.name?.length || 0));

    for (const item of indexedRefs) {
      if (item.name) {
        referencedNames.add(item.name);
        const atRegex = new RegExp(`[@＠]\\s*${escapeRegExp(item.name)}`, 'g');
        normalizedBase = normalizedBase.replace(atRegex, item.tag);

        const plainRegex = new RegExp(`(?<!<image\\d+>\\()${escapeRegExp(item.name)}`, 'g');
        normalizedBase = normalizedBase.replace(plainRegex, item.tag);
      }
      if (item.id) {
        const idRegex = new RegExp(`[@＠]\\s*${escapeRegExp(item.id)}\\b`, 'g');
        normalizedBase = normalizedBase.replace(idRegex, item.tag);
      }
    }

    // 2.1 针对 @link(...) 或 @preceding 接戏标记的精准图文映射
    const pIdx = references.findIndex((r) => r.role === 'preceding_frame');
    if (pIdx >= 0) {
      const linkTag = `<image${pIdx + 1}>(${references[pIdx].name || '前序尾帧'})`;
      normalizedBase = normalizedBase.replace(/[@＠]link(?:\([^)]*\))?/g, linkTag);
      normalizedBase = normalizedBase.replace(/[@＠](?:preceding|preceding_frame)/g, linkTag);
    }
  }

  // 3. 未定妆实体降级解包（若未出图，自动展开为其外貌特征描述）
  const allEntityItems: Array<{ id?: string; characterId?: string; locationId?: string; itemId?: string; name: string; promptZh?: string; appearanceSummary?: string; atmosphere?: string }> = [
    ...(Array.isArray(entities.characters) ? entities.characters : []),
    ...(Array.isArray(entities.locations) ? entities.locations : []),
    ...(Array.isArray(entities.items) ? entities.items : []),
  ];
  allEntityItems.sort((a, b) => (b.name?.length || 0) - (a.name?.length || 0));

  for (const item of allEntityItems) {
    if (!item.name || referencedNames.has(item.name)) continue;

    const visualDesc = item.promptZh || item.appearanceSummary || item.atmosphere;
    if (!visualDesc) continue;

    const fallbackText = `${item.name}（${visualDesc}）`;
    if (normalizedBase.includes(item.name)) {
      const plainNameRegex = new RegExp(`(?<!<image\\d+>\\()${escapeRegExp(item.name)}`, 'g');
      normalizedBase = normalizedBase.replace(plainNameRegex, fallbackText);
    }
  }

  // 4. 终极净化：剥离任何遗留的 @ 符号
  normalizedBase = normalizedBase.replace(/[@＠]link(?:\([^)]*\))?/g, '前序镜头接戏状态');
  normalizedBase = normalizedBase.replace(/[@＠](?:frame_0|first_frame|首帧)/g, '起幅');
  normalizedBase = normalizedBase.replace(/[@＠]([a-zA-Z0-9_\u4e00-\u9fa5]+)/g, '$1');

  // 5. 拼装结构化 Sections
  const mappingSection = buildReferenceMappingSection(references);
  const editInstructionSection = instruction?.trim()
    ? `【画面微调要求】\n${instruction.trim()}\n本次明确要求修改的属性优先于旧台本、参考图和连续性默认要求；只保留未指定修改的属性。`
    : '';

  const sections = [
    normalizedBase,
    editInstructionSection,
    mappingSection,
    CINEMATIC_CONTINUITY_LOCK,
  ].filter(Boolean);

  const referenceImageUrls = references.map((r) => r.url);
  const mode = referenceImageUrls.length > 0 ? 'character_ref2i' : 'character_t2i';
  let negativePrompt = overrideNegativePrompt || CINEMATIC_KEYFRAME_NEGATIVE_PROMPT;
  if (isMediumOrCloseUp) {
    const framingExclusions = 'wide shot, extreme wide shot, long shot, establishing shot, full room view, symmetrical wide hall, far away subject, 全景, 大全景, 全堂全景, 远景, 居中大件家具';
    if (!negativePrompt.includes('wide shot')) {
      negativePrompt = `${negativePrompt}，${framingExclusions}`;
    }
  }

  // 智能动态动作与姿态负向词排斥：当动作非站姿时物理排斥直立先验（综合正文、微调指令与姿态硬约束）
  const poseDirectiveText = poseDirective
    ? `${poseDirective.label || ''} ${poseDirective.instruction || ''} ${poseDirective.presetId || ''}`
    : '';
  const poseScanContext = `${rawBase} ${instruction || ''} ${poseDirectiveText}`;
  const isCrouchingOrLowPose = /蹲|缩|蜷缩|跪|爬|坐|卧|倒地|贴地|贴墙|低重心|crouch|squat|cower|kneel|sitting|laying/i.test(poseScanContext);
  if (isCrouchingOrLowPose) {
    const poseExclusions = 'standing, standing pose, upright, straight legs, full length standing, two legs straight, 站立, 站姿, 直立, 双腿站立, 笔直站姿';
    if (!negativePrompt.includes('standing')) {
      negativePrompt = `${negativePrompt}，${poseExclusions}`;
    }
  }

  // 智能动态手持道具负向词排斥：当持有道具时物理排斥两手空空先验
  const hasItemHoldingAction = (resolved.matchedItems.length > 0 || (entities.items && entities.items.length > 0)) &&
    /握|拿|持|抓|捏|抵住|提着|握持|grip|holding|clutching/i.test(poseScanContext);
  if (hasItemHoldingAction) {
    const propExclusions = 'empty hands, empty-handed, missing props, without props, 空手, 双手空空, 未拿道具, 道具消失';
    if (!negativePrompt.includes('empty hands')) {
      negativePrompt = `${negativePrompt}，${propExclusions}`;
    }
  }

  return {
    compiledPrompt: sections.join('\n\n'),
    negativePrompt,
    referenceImageUrls,
    mode,
    resolvedEntities: resolved,
    references,
  };
}
