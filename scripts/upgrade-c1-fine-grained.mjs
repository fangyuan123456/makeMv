import fs from 'node:fs';
import path from 'node:path';
import { safeReadJsonSync, atomicWriteJsonSync } from '../server/dist/utils/atomicFile.js';

const projectId = 'proj_1795370334832_mzzw';
const clipId = 'c1';
const projectDir = path.resolve('server/data/projects', projectId);

const sbPath = path.join(projectDir, 'storyboards.json');
const filmSpecPath = path.join(projectDir, 'film_spec.json');

const storyboards = safeReadJsonSync(sbPath) || [];
const targetClip = storyboards.find(c => c.clipId === clipId);

if (!targetClip) {
  throw new Error(`找不到分幕 ${clipId}`);
}

// 1. 保留 c1-01 已有的图和视频资产
const existing01 = targetClip.shots?.find(s => s.shotId === 'c1-01') || {};

// 2. 升级视听演绎剧本（3 大完整场面情境，含对白、拟音、时空环境锁）
const shootingScript = {
  clipId: 'c1',
  clipTitle: '第 1 幕《归乡夜忌》',
  environmentLock: {
    timeOfDay: '黄昏至深夜 (Dusk to Late Night)',
    weatherDirective: {
      label: '深秋阴冷薄雾',
      instruction: '外景深秋黄昏薄雾低能见度，寒意微风；内景入夜至深夜密闭阴湿，门缝有细微夜风流动，白烛青烟盘旋。'
    },
    lightingDirective: {
      label: '青橙逆光到极暗烛光',
      instruction: '村口为低角度橙红余晖与地表冷蓝阴影对冲；灵堂为昏暗暖黄烛光与大面积深黑阴影，高反差电影级恐怖布光。'
    },
    colorTone: {
      label: '冷峻中式民俗恐怖色调',
      instruction: '低饱和、冷暗青蓝调为主，暖黄烛光为唯一视觉焦点，营造阴森压抑氛围。'
    }
  },
  actionBeats: [
    {
      beatId: 's1',
      beatTitle: '外景 · 村口 · 黄昏 · 归乡与石碑死人名单',
      actionDescription: '陈默背着旧双肩包、右手拎着便携录音机，沿着湿泥碎石土路走向村口低矮石碑前停步。他抬头注视碑面凿刻的村名，随后绕至石碑背面蹲下，将录音机放在脚边。他伸出右手食指，顺着粗暴深凿的刻痕逐一划过，停在最后一道崭新的“陈秀兰”名字上，指尖抑制不住地微微颤抖。',
      cinematicIntent: '全景低角度仰拍建立石碑与人物的空间压迫感，随后镜头手持跟拍半圈切至过肩浅景深特写，聚焦粗糙石刻与颤抖指尖。',
      characterIds: ['char_1795370925689_5lyyj8'],
      itemIds: [],
      dialogue: '[陈默]：“十年没回来了……妈，我回来了。”\n[陈默]：“这些名字……都是死人？”',
      audioAmbience: '脚步踏在湿碎石上的沙沙声，录音机磁带空转机械微响，深秋冷风掠过枯树的呜咽，远处两声嘶哑鸦啼。',
      estimatedSeconds: 10
    },
    {
      beatId: 's2',
      beatTitle: '内景 · 灵堂 · 入夜 · 三叔公点烛立规',
      actionDescription: '灵堂内光线幽暗，母亲黑白遗照立于供桌正中，录音机静置在桌案边缘。三叔公佝偻着背站在供桌旁，右手反复摩挲左手无名指上的旧铜戒。他从供桌上拿起三根细长白烛在长明灯上点燃，烛火猛地暗了一瞬后复明。三叔公眼神闪烁，交代完毕后快步退到门槛旁，右手扶住门框，跨出门外反手虚掩木门，脚步声在门外黑暗中远去。',
      cinematicIntent: '中景双人镜头，白烛在前景形成暖黄光斑，两人面部处于半明半暗的阴影中；点烛瞬间切特写，退门时切背光剪影。',
      characterIds: ['char_1795370925689_5lyyj8', 'char_1795370925689_kekirv'],
      itemIds: ['item_1795370925689_rsh1g3'],
      dialogue: '[三叔公]：“默娃，今晚你守夜。规矩不多，但条条要命——不回头，不吹烛，不细听磁带里的杂音。”\n[陈默]：“为什么？”\n[三叔公]：“守阴人的规矩，破了，魂就没了。记住，烛灭之前，别出灵堂。”',
      audioAmbience: '铜戒与指骨摩擦声，白烛引燃噗噗声，烛火瞬暗抽吸气流声，老木门合上的沉闷吱呀声。',
      estimatedSeconds: 15
    },
    {
      beatId: 's3',
      beatTitle: '内景 · 灵堂 · 深夜 · 磁带异声与烛火自灭',
      actionDescription: '深夜，灵堂万籁俱寂，三根白烛静静燃烧。陈默独自背对镜头坐在供桌前的木椅上，录音机磁带平缓转动。镜头从背后极其缓慢地推向其后颈，磁带沙沙杂音中，一个沙哑阴冷的女声幽幽浮现。陈默浑身紧绷、喉结剧烈滚动，脊背瞬间如铁板般僵直。三根白烛的火苗突然不规则疯狂跳动，正中一根白烛“噗”地自灭，升腾起一缕笔直青烟在遗照前缭绕不散。',
      cinematicIntent: '长镜头由后景缓推至后颈营造极致窥视压迫，女声出现时切侧面特写陈默紧咬牙关与滚动的喉结，烛灭瞬间切特写熄灭青烟后猛拉全景。',
      characterIds: ['char_1795370925689_5lyyj8'],
      itemIds: [],
      dialogue: '（录音机沙沙杂音中，浮出沙哑女声）：“……默……别回头……”',
      audioAmbience: '磁带持续摩擦底噪，耳边近距离沙哑耳语，陈默急促沉重呼吸声，烛火暴跳噼啪声，一根火苗突然噗地自灭声。',
      estimatedSeconds: 12
    }
  ],
  generatedAt: new Date().toISOString()
};

// 3. 升级 13 个细分分镜镜头（单任务、无歧义、对白与动作精准锚定）
const shots = [
  {
    ...existing01,
    shotId: 'c1-01',
    title: '镜01 · 村口石碑定场 (外景·黄昏)',
    sceneSubject: '黄昏薄雾中，陈默背着旧双肩包、手持录音机，沿泥泞土路走到村口矮石碑前停步，目光垂落凝视碑上刻着的村名。',
    dialogue: '陈默：“十年没回来了……妈，我回来了。”',
    audioPrompt: '脚步踏在湿碎石上的沙沙声，深秋冷风吹过枯树的呜咽。',
    sliceSummary: '陈默提录音机驻足石碑前，低语归乡。',
    weatherDirective: shootingScript.environmentLock.weatherDirective,
    durationSec: 5,
  },
  {
    shotId: 'c1-02',
    title: '镜02 · 绕至石碑背面 (外景·黄昏)',
    sceneSubject: '陈默脚步绕过石碑侧面来到背面，蹲下身将录音机放在脚边碎石上，目光被石碑背面密集的深痕吸引。',
    cameraDirective: {
      label: '中景跟拍转俯角',
      instruction: '手持半弧形跟拍，由人物侧后方平移跟随至蹲姿俯角，浅景深虚化背景。',
      presetId: 'tracking-shot'
    },
    colorDirective: {
      label: '青橙冷调',
      instruction: '暗部青灰冷调，高光带微弱暖橙余晖。'
    },
    dialogue: '',
    audioPrompt: '录音机金属外壳轻磕碎石轻响，衣物摩擦微响。',
    sliceSummary: '陈默绕至碑后蹲下，发现石面异样。',
    weatherDirective: shootingScript.environmentLock.weatherDirective,
    durationSec: 4,
    characterIds: ['char_1795370925689_5lyyj8'],
  },
  {
    shotId: 'c1-03',
    title: '镜03 · 碑背刻名死人特写 (外景·黄昏)',
    sceneSubject: '石碑背面特写：碑面刻满被粗暴深凿划掉的名字，划痕深及石骨。陈默右手食指微颤，指尖抚摸停在最新一道“陈秀兰”划痕上。',
    cameraDirective: {
      label: '微距浅景深特写',
      instruction: '微距特写聚焦石面粗糙刻痕与颤抖指尖，背景薄雾与老槐树完全虚化。',
      presetId: 'macro-close-up'
    },
    colorDirective: {
      label: '高反差冷色',
      instruction: '冷暗阴影凸显刀凿刻痕的阴森质感。'
    },
    dialogue: '陈默：“这些名字……都是死人？”',
    audioPrompt: '指腹摩擦粗糙石刻的沙沙微响，远处两声沙哑鸦啼。',
    sliceSummary: '陈默抚摸母亲被划掉的名字，惊疑这都是死人。',
    weatherDirective: shootingScript.environmentLock.weatherDirective,
    durationSec: 5,
    characterIds: ['char_1795370925689_5lyyj8'],
  },
  {
    shotId: 'c1-04',
    title: '镜04 · 灵堂内景全景定场 (内景·入夜)',
    sceneSubject: '夜间灵堂内光线幽暗，正中供桌摆放母亲黑白遗照与三根白烛。三叔公佝偻背影立于桌侧，陈默肃立于堂前面对遗照。',
    cameraDirective: {
      label: '全景深景深定场',
      instruction: '固定全景机位，正对供桌遗照，画面两侧白幡低垂，白烛火光在暗调中形成视觉重心。',
      presetId: 'establishing-interior'
    },
    colorDirective: {
      label: '昏暗暖烛深阴影',
      instruction: '大面积冷黑死黑阴影，暖黄烛光为唯一主光源。'
    },
    dialogue: '',
    audioPrompt: '夜风拍打窗棂声，长明灯火微弱哔剥声。',
    sliceSummary: '灵堂入夜定场，三叔公与陈默面对母亲遗照。',
    weatherDirective: { label: '灵堂夜间密闭', instruction: '室内阴冷密闭，火苗受穿堂风轻微扰动。' },
    durationSec: 4,
    characterIds: ['char_1795370925689_5lyyj8', 'char_1795370925689_kekirv'],
  },
  {
    shotId: 'c1-05',
    title: '镜05 · 三叔公立规 (内景·入夜)',
    sceneSubject: '过肩中景：三叔公面部半明半暗，右手反复摩挲左手无名指上的旧铜戒，眼神冷酷严肃，交代守夜三忌。',
    cameraDirective: {
      label: '过肩中景',
      instruction: '机位设于陈默肩后，带陈默右肩轮廓，焦点对准三叔公阴郁侧脸。',
      presetId: 'over-shoulder-medium'
    },
    colorDirective: {
      label: '侧光高反差',
      instruction: '侧逆烛光勾勒出三叔公深陷的眼窝与面部沟壑。'
    },
    dialogue: '三叔公：“默娃，今晚你守夜。规矩不多，但条条要命——不回头，不吹烛，不细听磁带里的杂音。”',
    audioPrompt: '铜戒与枯瘦指骨摩擦的金属细响，压抑低沉的人声。',
    sliceSummary: '三叔公严肃交代守夜三忌：不回头、不吹烛、不细听杂音。',
    weatherDirective: { label: '灵堂夜间密闭', instruction: '室内阴冷密闭。' },
    durationSec: 6,
    characterIds: ['char_1795370925689_kekirv', 'char_1795370925689_5lyyj8'],
  },
  {
    shotId: 'c1-06',
    title: '镜06 · 陈默追问正打 (内景·入夜)',
    sceneSubject: '中景正打：陈默正对供桌，身体微微前倾，眉头紧锁，眼神透出困惑与警觉，开口追问。',
    cameraDirective: {
      label: '中景正打微推',
      instruction: '正对陈默上半身，机位极其缓慢地向其面部推近半步，强化压迫感。',
      presetId: 'slow-push-medium'
    },
    colorDirective: {
      label: '正向暖冷交错',
      instruction: '烛光微映陈默前额，背景漆黑。'
    },
    dialogue: '陈默：“为什么？”',
    audioPrompt: '陈默短促急切的疑问声，灵堂死一般的寂静。',
    sliceSummary: '陈默皱眉向前一步追问为什么。',
    weatherDirective: { label: '灵堂夜间密闭', instruction: '室内阴冷密闭。' },
    durationSec: 3,
    characterIds: ['char_1795370925689_5lyyj8'],
  },
  {
    shotId: 'c1-07',
    title: '镜07 · 三叔公引燃三烛 (内景·入夜)',
    sceneSubject: '供桌近景特写：三叔公枯瘦的手取过三根白烛，在供桌火种上依次引燃，稳稳插进香炉中央。',
    cameraDirective: {
      label: '近景特写',
      instruction: '斜俯拍供桌桌面，焦点锁定白烛引燃与香炉插入过程。',
      presetId: 'insert-close-up'
    },
    colorDirective: {
      label: '暖黄火光',
      instruction: '引燃火光照亮桌面旧木纹与香灰。'
    },
    dialogue: '',
    audioPrompt: '烛芯引燃的嗤嗤声，白烛插进香灰的沉闷细响。',
    sliceSummary: '三叔公点燃三根白烛插入香炉。',
    weatherDirective: { label: '灵堂夜间密闭', instruction: '室内阴冷密闭。' },
    durationSec: 4,
    characterIds: ['char_1795370925689_kekirv'],
  },
  {
    shotId: 'c1-08',
    title: '镜08 · 烛火骤暗与致命警告 (内景·入夜)',
    sceneSubject: '三根刚点燃的白烛火苗突然诡异地同时向下一缩、骤然暗了一瞬后复明。三叔公眼角抽动，眼神闪烁，冷酷给出警告。',
    cameraDirective: {
      label: '特写反打',
      instruction: '正对三叔公阴沉面部，前景带跳动的白烛火焰，捕捉眼神瞬间的恐惧与威严。',
      presetId: 'close-up-reverse'
    },
    colorDirective: {
      label: '阴暗闪烁',
      instruction: '火光骤暗瞬间全画幅微变暗冷，复明后恢复暖黄高光。'
    },
    dialogue: '三叔公：“守阴人的规矩，破了，魂就没了。”',
    audioPrompt: '烛火骤暗时气流抽吸声，低沉沙哑的告诫声。',
    sliceSummary: '烛火骤暗复明，三叔公警告破了规矩魂就没了。',
    weatherDirective: { label: '灵堂夜间密闭', instruction: '气流诡异抽缩。' },
    durationSec: 4,
    characterIds: ['char_1795370925689_kekirv'],
  },
  {
    shotId: 'c1-09',
    title: '镜09 · 三叔公退门离场 (内景·入夜)',
    sceneSubject: '三叔公快步退到门槛旁，右手扶住门框回头深深看了陈默一眼，跨出门外反手虚掩木门，脚步声在门外黑暗中远去。',
    cameraDirective: {
      label: '内景向外中景',
      instruction: '机位在灵堂内部朝向大门，拍三叔公退出门槛与合门动作，形成背光轮廓。',
      presetId: 'doorway-exit'
    },
    colorDirective: {
      label: '外黑内昏',
      instruction: '门外为浓重的深夜死黑，门内为昏暗烛光。'
    },
    dialogue: '三叔公：“记住，烛灭之前，别出灵堂。”',
    audioPrompt: '老木门闭合的沉重吱呀声，脚步踏碎石远去的声响。',
    sliceSummary: '三叔公退出灵堂闭门，叮嘱烛灭前别出灵堂。',
    weatherDirective: { label: '灵堂夜间密闭', instruction: '门缝有夜风流动。' },
    durationSec: 5,
    characterIds: ['char_1795370925689_kekirv'],
  },
  {
    shotId: 'c1-10',
    title: '镜10 · 陈默独守启动磁带 (内景·深夜)',
    sceneSubject: '深夜灵堂阒寂。陈默独自在供桌旁木椅上坐下，按下桌上录音机播放键，磁带缓缓转动，他目光凝视母亲遗照。',
    cameraDirective: {
      label: '对称全景固定',
      instruction: '对称全景机位，陈默与供桌构成寂静中轴，三根白烛静静燃烧。',
      presetId: 'static-symmetric'
    },
    colorDirective: {
      label: '深夜幽闭冷暖对比',
      instruction: '极简光影，烛光成为暗室中的唯一光源。'
    },
    dialogue: '',
    audioPrompt: '录音机按键的清脆咔嗒声，磁带平缓转动的沙沙底噪。',
    sliceSummary: '深夜陈默独坐供桌前按下录音机播放键。',
    weatherDirective: { label: '灵堂深夜死寂', instruction: '空气凝滞湿冷。' },
    durationSec: 5,
    characterIds: ['char_1795370925689_5lyyj8'],
  },
  {
    shotId: 'c1-11',
    title: '镜11 · 背后窥视长镜头推进 (内景·深夜)',
    sceneSubject: '长镜头由陈默背后极其缓慢地向其后颈推近，录音机红色指示灯在阴暗中微微闪烁，陈默呼吸声逐渐加重。',
    cameraDirective: {
      label: '低机位过肩慢推',
      instruction: '低机位自后景平滑向前推近，景深逐渐收窄，营造无形存在逼近的压迫感。',
      presetId: 'slow-creepy-push'
    },
    colorDirective: {
      label: '暗调冷光',
      instruction: '后颈微弱边缘光，阴暗处泛冷青。'
    },
    dialogue: '',
    audioPrompt: '磁带沙沙杂音逐渐加重，沉重粗粝的呼吸声。',
    sliceSummary: '长镜头自背后缓慢逼近陈默后颈。',
    weatherDirective: { label: '灵堂深夜死寂', instruction: '压迫感倍增。' },
    durationSec: 6,
    characterIds: ['char_1795370925689_5lyyj8'],
  },
  {
    shotId: 'c1-12',
    title: '镜12 · 女声低语与脊背僵直 (内景·深夜)',
    sceneSubject: '磁带杂音中突兀浮出沙哑阴冷的女声。陈默后颈汗毛直竖，脊背如铁板般瞬间僵直，喉结剧烈滚动，双手死死扣住椅子扶手，极度恐惧却不敢回头。',
    cameraDirective: {
      label: '侧面紧凑特写',
      instruction: '紧凑特写聚焦陈默紧咬的侧脸下颌与暴起的颈部青筋，眼神极度恐惧。',
      presetId: 'chilling-close-up'
    },
    colorDirective: {
      label: '冷汗高反差',
      instruction: '冷光照亮额头与后颈冷汗，阴影深暗。'
    },
    dialogue: '（录音机沙哑女声）：“……默……别回头……”',
    audioPrompt: '近距离沙哑阴冷的女声低语，陈默屏息倒抽冷气声。',
    sliceSummary: '录音机浮出沙哑女声别回头，陈默脊背僵直不敢回头。',
    weatherDirective: { label: '灵堂深夜死寂', instruction: '极度寒意。' },
    durationSec: 5,
    characterIds: ['char_1795370925689_5lyyj8'],
  },
  {
    shotId: 'c1-13',
    title: '镜13 · 烛火暴跳一根自灭 (内景·深夜)',
    sceneSubject: '三根白烛火苗突然像被狂乱阴风撕扯般剧烈乱跳！其中一根“噗”地自灭，一缕笔直青烟升腾而起在遗照前缭绕不散。',
    cameraDirective: {
      label: '特写急切拉远全景',
      instruction: '特写聚焦狂跳的白烛自灭冒烟瞬间，随即快速拉远至灵堂大全景，定格在青烟与僵立的背影上。',
      presetId: 'snap-zoom-out'
    },
    colorDirective: {
      label: '青烟缭绕残光',
      instruction: '仅存两根烛火照亮升起的青烟，遗照被青烟遮蔽。'
    },
    dialogue: '',
    audioPrompt: '烛火狂跳呼呼声，火苗猝然自灭的沉闷爆破音，青烟升腾细响。',
    sliceSummary: '烛火剧烈跳动，一根白烛噗地自灭青烟缭绕。',
    weatherDirective: { label: '灵堂深夜死寂', instruction: '阴风袭来青烟缭绕。' },
    durationSec: 5,
    characterIds: ['char_1795370925689_5lyyj8'],
  }
];

targetClip.shootingScript = shootingScript;
targetClip.shots = shots;
atomicWriteJsonSync(sbPath, storyboards);

let filmSpec = safeReadJsonSync(filmSpecPath) || { clips: [] };
filmSpec.clips = Array.isArray(filmSpec.clips) ? filmSpec.clips : [];
let fc = filmSpec.clips.find(c => c.clipId === clipId);
if (!fc) {
  fc = { clipId, title: targetClip.title, shots: [] };
  filmSpec.clips.push(fc);
}
fc.shootingScript = shootingScript;
fc.shots = shots;
atomicWriteJsonSync(filmSpecPath, filmSpec);

console.log('Update success! Shots count:', shots.length);
console.log('Shooting script beats count:', shootingScript.actionBeats.length);
