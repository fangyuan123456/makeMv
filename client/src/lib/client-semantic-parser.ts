/**
 * client/src/lib/client-semantic-parser.ts
 * 客户端通用语义解析器 (Client Semantic Mention & View Resolver SSOT)
 *
 * 核心职责：
 * 1. 词法分词与长词优先匹配：扫描纯净剧本正文，精准命中角色/场景/道具法定全名；
 * 2. 视图层投影转换：将纯文本投影为带「@」的高亮 Mention 胶囊与 Tiptap 富文本 AST；
 * 3. 输入态纯净化导出：创作者在输入框输入「@」只是快速选资产的交互糖，向 API 提交时 100% 还原为纯净自然语言；
 * 4. 彻底解耦：客户端拥有完全自治的视觉表现与超链 Hover 关联，绝不污染底层数据。
 */

export interface MentionEntityItem {
  id: string;
  name: string;
  type: 'character' | 'location' | 'item';
  typeLabel: string;
  identity?: string;
  imageUrl?: string;
  promptZh?: string;
  spatialLayout?: string;
}

export interface EntityContainer {
  characters?: any[];
  locations?: any[];
  items?: any[];
  [key: string]: any;
}

export interface ParsedSegment {
  type: 'text' | 'entity';
  content: string;
  entity?: MentionEntityItem;
}

/**
 * 1. 扁平化提取实体清单并按名称长度降序排列（确保长词优先匹配，如“老宅正厅”优先于“老宅”）
 */
export function extractSortedEntities(entities?: EntityContainer | null): MentionEntityItem[] {
  if (!entities) return [];
  const list: MentionEntityItem[] = [];

  // 1. 角色
  if (Array.isArray(entities.characters)) {
    for (const c of entities.characters) {
      const id = c.characterId || c.id;
      const name = c.name?.trim();
      if (id && name) {
        list.push({
          id,
          name,
          type: 'character',
          typeLabel: '角色',
          identity: c.identity || c.role || c.appearanceSummary,
          imageUrl: c.imageUrl || c.referenceImageUrl,
          promptZh: c.promptZh,
        });
      }
    }
  }

  // 2. 场景
  if (Array.isArray(entities.locations)) {
    for (const l of entities.locations) {
      const id = l.locationId || l.id;
      const name = l.name?.trim();
      if (id && name) {
        list.push({
          id,
          name,
          type: 'location',
          typeLabel: '场景',
          identity: l.identity || l.atmosphere,
          imageUrl: l.imageUrl || l.referenceImageUrl,
          promptZh: l.promptZh,
          spatialLayout: l.spatialLayout,
        });
      }
    }
  }

  // 3. 道具
  if (Array.isArray(entities.items)) {
    for (const it of entities.items) {
      const id = it.itemId || it.id;
      const name = it.name?.trim();
      if (id && name) {
        list.push({
          id,
          name,
          type: 'item',
          typeLabel: '道具',
          identity: it.identity || it.functionDescription || it.appearanceSummary,
          imageUrl: it.imageUrl || it.referenceImageUrl,
          promptZh: it.promptZh,
        });
      }
    }
  }

  // 按名称长度降序排列
  return list.sort((a, b) => b.name.length - a.name.length);
}

/**
 * 2. 词法分词器：将任意输入文本（纯净文学正文）精准切分为文本片段与实体命中片段
 */
export function parseTextToSegments(
  text: string,
  entities?: EntityContainer | null
): ParsedSegment[] {
  if (!text) return [];
  const sorted = extractSortedEntities(entities);
  if (sorted.length === 0) {
    return [{ type: 'text', content: text }];
  }

  const names = sorted.map((e) => e.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  // 支持纯名字匹配，也容错带有 @/＠ 前缀的输入
  const pattern = new RegExp(`[@＠]*(${names.join('|')})`, 'g');

  const segments: ParsedSegment[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    const matchStart = match.index;
    const entityName = match[1];

    if (matchStart > lastIndex) {
      segments.push({
        type: 'text',
        content: text.substring(lastIndex, matchStart),
      });
    }

    const entity = sorted.find((e) => e.name === entityName);
    if (entity) {
      segments.push({
        type: 'entity',
        content: entity.name,
        entity,
      });
    } else {
      segments.push({
        type: 'text',
        content: match[0],
      });
    }

    lastIndex = matchStart + match[0].length;
  }

  if (lastIndex < text.length) {
    segments.push({
      type: 'text',
      content: text.substring(lastIndex),
    });
  }

  return segments;
}

/**
 * 3. 纯净文学数据导出守门人 (To Pure Literary Text)
 * 仅将属于已注册实体的 @前缀 还原为纯净法定全名，绝不粗暴误杀文本中其他字符
 */
export function toPureText(text: string, entities?: EntityContainer | null): string {
  if (!text) return '';
  const sorted = extractSortedEntities(entities).filter((e) => !e.name.startsWith('link('));
  if (sorted.length === 0) return text;

  const names = sorted.map((e) => e.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const pattern = new RegExp(`[@＠](${names.join('|')})`, 'g');
  return text.replace(pattern, '$1');
}

/**
 * 3.1 视图输入态基准对齐守门人 (To Mention Text)
 * 将纯文本中的已注册实体统一标准化加上单一 @ 符号（用于编辑态初始基准值严格对齐，杜绝因 @ 差异导致脏检查误报）
 */
export function toMentionText(text: string, entities?: EntityContainer | null): string {
  if (!text) return '';
  const sorted = extractSortedEntities(entities);
  if (sorted.length === 0) return text;

  const names = sorted.map((e) => e.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  // 匹配带或不带 @ 的实体名称，统一规约为单一 @实体名
  const pattern = new RegExp(`[@＠]*(${names.join('|')})`, 'g');
  return text.replace(pattern, '@$1');
}

/**
 * 4. 视图投影转换：将纯文本投影为 Tiptap 富文本 HTML
 */
export function convertTextToTiptapHtml(
  text: string,
  sortedEntities: MentionEntityItem[]
): string {
  if (!text) return '<p></p>';
  if (sortedEntities.length === 0) {
    const escaped = text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    return `<p>${escaped.replace(/\n/g, '<br>')}</p>`;
  }

  const names = sortedEntities.map((e) => e.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const pattern = new RegExp(`[@＠]*(${names.join('|')})`, 'g');

  const lines = text.split('\n');
  const lineHtmls = lines.map((line) => {
    let html = '';
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = pattern.exec(line)) !== null) {
      const matchStart = match.index;
      const entityName = match[1];

      if (matchStart > lastIndex) {
        const seg = line.substring(lastIndex, matchStart);
        html += seg.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      }

      const entity = sortedEntities.find((e) => e.name === entityName);
      if (entity) {
        html += `<span data-type="mention" data-id="${entity.id}" data-label="${entity.name}" data-entity-type="${entity.type}">@${entity.name}</span>`;
      } else {
        html += match[0];
      }

      lastIndex = matchStart + match[0].length;
    }

    if (lastIndex < line.length) {
      const seg = line.substring(lastIndex);
      html += seg.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    return html || '<br>';
  });

  return `<p>${lineHtmls.join('<br>')}</p>`;
}

/**
 * 5. 提取正文中已被引用的实体对象列表（用于卡片底部已绑定资产徽标呈现）
 */
export function getBoundEntities(
  text: string,
  entities?: EntityContainer | null
): MentionEntityItem[] {
  if (!text) return [];
  const segments = parseTextToSegments(text, entities);
  const foundMap = new Map<string, MentionEntityItem>();

  for (const seg of segments) {
    if (seg.type === 'entity' && seg.entity) {
      foundMap.set(seg.entity.id, seg.entity);
    }
  }

  return Array.from(foundMap.values());
}
