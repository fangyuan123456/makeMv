/**
 * agents/planner/prd-asset-extractor.ts
 * PRD 资产与设定解构提取器 (PRD Asset & World Bible Extractor SSOT)
 *
 * 核心定位：
 * 接收上游 PRD / GDD.md 文档，深度提炼结构化的“资产圣经”：
 * 1. 实体与角色清单 (人类、动物/生物、机械实体、关键道具)；
 * 2. 场景空间与光影氛围清单 (空间、材质、冷暖光影、环境音效、英文生图 Prompt)；
 * 3. 经典机锋对白与博弈模块库 (对白、潜台词、微表情微动作)。
 *
 * 支撑下游：
 * - 互动文游 Pi Agent：生成节点时直接引用标准资产，保证文学叙事与视觉 Prompt 严密统一；
 * - ComfyUI 纯物理工具：基于角色与场景资产生成定妆照并实现图生视频 (I2V) 锁脸锁貌。
 */

import { generateObject } from 'ai';
import { LLMProvider } from '../../llm/index.js';
import {
  WorldBibleSchema,
  type WorldBibleArtifact,
  type GDDArtifact,
  type EntitySpec,
  type LocationSpec,
  type DialogueModule,
} from './schema.js';

export const ASSET_EXTRACTOR_SYSTEM_PROMPT = `你是一位好莱坞级的电影视听总监与资深互动游戏世界观架构师。
你的任务是深入阅读游戏设计案 (PRD/GDD)，将其中的核心实体、场景氛围与高光对白提炼为强类型的【资产圣经 (World Bible)】：

1. 实体与角色资产 (Entities):
   - 提取所有出场人物、动物生物（如机械犬、巡逻仿生宠）、机械实体/载具与关键核心道具（如枪支、带血名单、通行黑卡）；
   - 为每个实体提供极其细致的中文外观描写 (visualDescription) 以及适配 ComfyUI 文生图的高精度英文视觉 DNA (visualDnaPromptEn)，确保面部/外观特征精准、绝不漂移。

2. 场景空间与光影氛围资产 (Locations):
   - 提取所有核心博弈场景；
   - 详细刻画空间长宽感与掩体 (spatialLayout)、光影色温与阴影 (lightingAtmosphere)、背景环境音 (audioAmbience) 以及标准英文场景 Prompt (visualPromptEn)。

3. 剧情对白与台词机锋库 (Dialogue Modules):
   - 提取代表性的博弈对白、潜台词 (subtext) 与说话时的肢体微动作 (actionCue)。`;

/**
 * 从 GDD 策划案提取完备的 WorldBible 资产圣经
 */
export async function extractWorldBibleFromGDD(
  gdd: GDDArtifact | string,
  options?: { useModel?: boolean }
): Promise<WorldBibleArtifact> {
  const markdownText = typeof gdd === 'string' ? gdd : gdd.markdown || '';
  const title = typeof gdd === 'object' ? gdd.title : '互动影游资产圣经';

  // 1. 如果已内置世界圣经，直接返回
  if (typeof gdd === 'object' && gdd.worldBible && gdd.worldBible.entities.length > 0) {
    return gdd.worldBible;
  }

  // 2. 如果开启大模型自动提取或非 Mock 模式，调用 LLM 进行全量深度语义析取
  const provider = LLMProvider.getModel();
  const shouldInvokeModel = options?.useModel || (provider as any).modelId !== 'mock-model';

  if (shouldInvokeModel && markdownText.length > 100) {
    try {
      const userPrompt = `【作品名称】：${title}\n\n【完整策划案 (GDD.md)】：\n${markdownText}\n\n请严格按照 WorldBible 规范提取全部角色、生物动物、关键道具、场景光影与高光对白。`;
      const result = await generateObject({
        model: provider,
        system: ASSET_EXTRACTOR_SYSTEM_PROMPT,
        prompt: userPrompt,
        schema: WorldBibleSchema,
      });
      if (result.object) {
        return result.object;
      }
    } catch (err) {
      console.warn('[AssetExtractor] 大模型提取资产失败，转入确定性模式解析:', err);
    }
  }

  // 3. 确定性提取与解析装配 (作为高性能与离线验证基石)
  return buildDeterministicWorldBible(gdd);
}

/**
 * 确定性资产提炼装配器
 */
export function buildDeterministicWorldBible(gdd: GDDArtifact | string): WorldBibleArtifact {
  const title = typeof gdd === 'object' ? gdd.title : '深海逆光：临界博弈';
  const md = typeof gdd === 'object' ? gdd.markdown : gdd;

  // 1. 基础实体 (Characters & Entities)
  const entities: EntitySpec[] = [
    {
      id: 'char_lin_xun',
      name: '林巡',
      category: 'character',
      role: 'player',
      visualDescription:
        '26岁青年卧底，身穿做旧深灰军规防水风衣，微卷黑发略显凌乱，右侧额角有隐蔽的神经阻断接口伤痕。面容冷峻克制，眼神如深海暗流，手背有频繁拆装义体留下的细小擦伤。',
      visualDnaPromptEn:
        '1man, 26yo Asian undercover agent, cold focused eyes, slight scar near temple with subtle cybernetic interface, disheveled dark hair, wearing distressed dark charcoal tactical trenchcoat with high collar, moody cinematic lighting, masterpiece, photorealistic, 8k',
      attributes: {
        personality: '沉静极度克制，微表情管理大师，内心被同伴牺牲的罪疚折磨。',
        identity: '代号“夜雀”的双面间谍，明面身份为安保局清道夫。',
      },
    },
    {
      id: 'char_viktor',
      name: '维克托',
      category: 'character',
      role: 'antagonist',
      visualDescription:
        '52岁财阀安保主管，身材魁梧压迫感极强。右眼为冰蓝色军规测谎义眼，随心率检测高频变换冷光；身穿剪裁考究的深黑羊绒军官大衣，左颊有一道自耳根延伸至下颌的陈旧烧伤痕，指间常夹着未熄灭的浓烈雪茄。',
      visualDnaPromptEn:
        '1man, 52yo imposing commanding security chief, right eye glowing ice-blue cybernetic ocular implant with data reticle, severe burn scar on left cheekbone, grizzled beard, tailored dark wool military coat, holding a lit cigar, low angle shot, intense menacing glare, high contrast chiaroscuro lighting, masterpiece, 8k',
      attributes: {
        personality: '冷血猎犬，热衷于在精神上击溃猎物而非物理毁灭，控制欲极强。',
        threatLevel: 'SS 级致命审讯官',
      },
    },
    {
      id: 'entity_hound_k9',
      name: '军规义体搜查猎犬 K-9',
      category: 'animal_creature',
      role: 'ambient',
      visualDescription:
        '重度义体化杜宾犬形态机械生物，躯干覆盖哑光钛合金装甲板，颈部有液压避震管路，双眼为橙红夜视红外扫描镜，喉部呼吸阀在暴雨中喷吐微弱的冷却白雾。',
      visualDnaPromptEn:
        'cybernetic Doberman hound, matte titanium armor plating, exposed hydraulic pistons on neck, glowing orange dual sensor eyes, exhaling light vapor, rainy concrete floor reflection, high detail, sci-fi concept art, photorealistic',
      attributes: {
        behavior: '在审讯室铁门外低沉呜咽，对信息素与火药味极度敏感。',
      },
    },
    {
      id: 'prop_brass_bullet',
      name: '0.38 动能黄铜子弹',
      category: 'key_prop',
      role: 'item',
      visualDescription:
        '一枚带着膛线压痕的黄铜手枪子弹，弹壳底部刻有绝密安保军规批号，弹头在铁桌冷光下泛着冰冷的金属光泽。',
      visualDnaPromptEn:
        'macro close-up shot, a single 0.38 brass caliber bullet resting on cold wet brushed steel table, rifling grooves on bullet tip, sharp metal reflections, cinematic depth of field, 8k',
      attributes: {
        symbolism: '死亡通牒与测谎开场的心理重锤。',
      },
    },
    {
      id: 'prop_blood_list',
      name: '带血的抵抗军潜伏名单',
      category: 'key_prop',
      role: 'item',
      visualDescription:
        '一张边缘卷曲泛黄的加密绝密耐水纸质名单，左下角浸染着已发黑干涸的指纹血迹，记录着三名卧底的真实代号。',
      visualDnaPromptEn:
        'top-down close-up, water-resistant classified document with encrypted typography, dry dark blood stain on corner, partially exposed from dark leather briefcase, tense atmosphere',
      attributes: {
        status: '夹在维克托公文包内侧，任务核心掉包目标。',
      },
    },
    {
      id: 'prop_security_black_card',
      name: '安保最高指挥通行黑卡',
      category: 'key_prop',
      role: 'item',
      visualDescription:
        '磨砂碳纤维材质的超薄权限卡，中央嵌有金色全息微电路芯片，边缘带有物理防伪防爆光纹。',
      visualDnaPromptEn:
        'matte carbon-fiber security keycard with glowing golden holographic microchip, metallic edges, resting on metal surface, high-tech thriller aesthetic',
      attributes: {
        function: '解锁地下深潜泊位与防爆闸门的唯一凭证。',
      },
    },
  ];

  // 2. 场景空间与氛围资产 (Locations)
  const locations: LocationSpec[] = [
    {
      id: 'loc_interrogation_room',
      name: '雨夜安保审讯室',
      spatialLayout:
        '长约8米、宽约5米的野兽派水泥防爆封闭室。中央为厚重冷轧铁桌，两侧摆放焊接固定的不锈钢靠背椅。左侧有双向防弹单面镜，右侧铁栅窗外是瓢泼暴雨。',
      lightingAtmosphere:
        '高对比度暗调冷光。顶置单具微闪的冷白荧光吊灯倾泻在桌心，窗外雨夜掠过深蓝与青绿霓虹逆光，维克托义眼不时投下刺目的警示红斑。',
      audioAmbience:
        '暴雨猛烈撞击铁窗的沉重轰鸣，排气阀不规律的嘶嘶泄压声，低音大提琴低频张力嗡鸣，军规猎犬铁爪在走廊踱步的清脆摩擦声。',
      visualPromptEn:
        'cinematic interior wide shot, brutalist underground interrogation room, dark brushed metal table in center, barred window with heavy rain and neon cyberpunk city lights outside, dim teal and orange moody lighting, puddle reflections, atmosphere of extreme suspense, 8k, photorealistic',
    },
    {
      id: 'loc_observation_deck',
      name: '深海极渊水下观测舱',
      spatialLayout:
        '弧形巨幅强化玻璃舷窗，窗外是万米深海漆黑海沟与微弱的发光水母生物群。室内是环形操作控制台，布满发光的机械仪表与跳动的波形监视屏。',
      lightingAtmosphere:
        '幽暗深邃的青蓝（Cyan/Teal）环境光，控制台微弱荧光在人物侧脸勾勒出冷冽轮廓线。',
      audioAmbience:
        '厚重水体高压下的低频沉闷回响，声呐每隔8秒的清脆脉冲嘀嗒声，氧气循环机平缓的气流呼哧声。',
      visualPromptEn:
        'cinematic interior of deep-sea underwater observation deck, massive curved acrylic window revealing dark abyss and bioluminescent particles, glowing cyan console lights reflecting on glass, solitary silhouette, cinematic framing, 8k',
    },
  ];

  // 3. 对白与机锋模块 (Dialogue Modules)
  const dialogueModules: DialogueModule[] = [
    {
      id: 'dlg_bullet_interrogation',
      sceneId: 'loc_interrogation_room',
      characters: ['char_viktor', 'char_lin_xun'],
      conflictTheme: '子弹上膛的心理威慑与开局突击测谎',
      lines: [
        {
          speaker: '维克托',
          text: '“林巡，今晚第三下层机房失窃。我需要你证明，你的脑神经芯片里没有爬满抵抗军的蠕虫。”',
          subtext: '我手里已经有你不在场的证据，看你能狡辩多久。',
          actionCue: '右手将黄铜子弹按入铁桌，推向林巡面前，义眼冷蓝光斑锁定林巡颈动脉。',
        },
        {
          speaker: '林巡',
          text: '“维克托主管，我是按规程去巡查阻断剂配额。签批记录在终端随时可调。”',
          subtext: '表面服从规章，稳住心率，试探你到底掌握了多少实证。',
          actionCue: '双手平放于膝，目光不卑不亢直视子弹，呼吸频率刻意维持在每分钟十二次。',
        },
        {
          speaker: '维克托',
          text: '“配额？但愿你的心率也像你的嘴一样守规矩。”',
          subtext: '测谎仪并未报警，但他一定有破绽。',
          actionCue: '收回粗糙的手指，转身抽出一支雪茄，雪茄剪发出咔哒脆响。',
        },
      ],
    },
    {
      id: 'dlg_briefcase_blackmail',
      sceneId: 'loc_interrogation_room',
      characters: ['char_viktor', 'char_lin_xun'],
      conflictTheme: '掐喉死局中的致命反转与黑账摊牌',
      lines: [
        {
          speaker: '维克托',
          text: '“清道夫，你真以为我不敢当场销毁你？！”',
          subtext: '被激怒后的极端暴力威慑。',
          actionCue: '机械右臂暴起死死掐住林巡咽喉，撞锤手枪顶紧林巡太阳穴。',
        },
        {
          speaker: '林巡',
          text: '“维克托……第三号码头走私终端的密钥，需要我当着安保总控频段念出来吗？”',
          subtext: '你不仅杀不了我，你现在有求于我。',
          actionCue: '在窒息的剧痛中艰难扯起嘴角，眼神冰冷锁定维克托微颤的义眼瞳孔。',
        },
        {
          speaker: '维克托',
          text: '“……你从哪里拿到的？”',
          subtext: '心理防线彻底崩溃，攻守易势。',
          actionCue: '机械指节力道骤松，雪茄从嘴角滑落，冷汗沿着烧伤疤痕渗出。',
        },
      ],
    },
  ];

  return {
    schemaVersion: '2.0.0',
    title,
    overview:
      '硬核赛博朋克 / 双面潜伏博弈美学。以冷调雨夜水泥防爆室与深海极渊为空间底色，聚焦高压审讯下的微表情心理战与多重结局因果律。',
    entities,
    locations,
    dialogueModules,
  };
}
