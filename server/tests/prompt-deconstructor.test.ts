import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractStructuredVisuals,
  extractStructuredVideoDirectives,
  reconstructShotPrompt,
  reconstructVideoPrompt,
} from '../../client/src/components/studio/canvas/presets/promptDeconstructor.js';

test('🎬 验证开放视听元数据契约与动态装配引擎 (Open Visual Directive SSOT)', async (t) => {
  // 模拟由 AI 动态规划生成的仙侠/科幻复合独特镜头（不在客户端预设列表里）
  const mockAiShot = {
    shotId: 'c1-01',
    cameraDirective: {
      label: '御剑腾空贴地仰拍',
      instruction: '镜头紧贴地面向上大角度仰拍主角御剑腾空而起的视觉冲击',
    },
    colorDirective: {
      label: '幽冥冷紫微光',
      instruction: '画面泛着幽暗冰冷的深紫色魔幻微光氛围',
    },
    poseDirective: {
      label: '单手掐诀御剑',
      instruction: '角色左手持剑诀指向天空，身姿挺拔悬浮',
    },
    sceneSubject: '仙门长阶之上，主角凌空祭出飞剑斩断虚空',
    firstFramePrompt: '仙门长阶之上，主角凌空祭出飞剑斩断虚空',
  };

  await t.test('1. 开放元数据直读：AI 生成不在客户端列表的生僻机位/姿态，100% 动态挂载', () => {
    const { directives, pureSubject } = extractStructuredVisuals(mockAiShot);

    assert.equal(directives.camera?.label, '御剑腾空贴地仰拍', '必须动态回显 AI 规划的机位名称');
    assert.equal(directives.color?.label, '幽冥冷紫微光', '必须动态回显 AI 规划的调色名称');
    assert.equal(directives.pose?.label, '单手掐诀御剑', '必须动态回显 AI 规划的姿态名称');
    assert.equal(pureSubject, `${mockAiShot.sceneSubject}。`, '直接读取纯净叙事主体（规范化句号闭环）');
  });

  await t.test('2. 零干扰干净重构：一键替换为好莱坞经典预设，新指令干净覆盖旧属性', () => {
    const { pureSubject } = extractStructuredVisuals(mockAiShot);

    // 创作者在界面将机位一键替换为经典的“低机位仰拍”，调色替换为“好莱坞青橙冷暖”
    const newDirectives = {
      camera: {
        label: '低机位仰拍',
        instruction: '将镜头机位调整为低机位仰拍视角（Low Angle Hero Shot）',
        presetId: 'cam_low_angle',
      },
      color: {
        label: '好莱坞青橙',
        instruction: '画面采用好莱坞经典青橙冷暖电影调色（Teal & Orange LUT）',
        presetId: 'color_teal_orange',
      },
      pose: mockAiShot.poseDirective, // 保留原姿态
    };

    const reassembled = reconstructShotPrompt(pureSubject, newDirectives, '增加剑刃破空风压');

    assert.ok(reassembled.includes('低机位仰拍视角'), '重构提示词必须包含新机位指令');
    assert.ok(reassembled.includes('青橙冷暖电影调色'), '重构提示词必须包含新调色指令');
    assert.ok(reassembled.includes('角色左手持剑诀指向天空'), '保留的姿态指令正常生效');
    assert.ok(!reassembled.includes('幽冥冷紫'), '重构提示词绝对不含已被替换的旧调色');
    assert.ok(reassembled.includes('增加剑刃破空风压'), '自定义细节正常追加');
  });

  await t.test('3. 默认兜底机制：无明确机位描述时自适应赋予平视标准机位', () => {
    const legacyShot = {
      firstFramePrompt: '指挥官站在窗前沉思',
    };
    const { directives, pureSubject } = extractStructuredVisuals(legacyShot);

    assert.equal(directives.camera?.label, '平视标准', '默认赋予平视标准机位');
    assert.equal(directives.camera?.presetId, 'cam_eye_level');
    assert.equal(directives.color, undefined, '无色调特征时不强行猜测');
    assert.equal(pureSubject, '指挥官站在窗前沉思。', '纯净主体保持原文（规范化句号闭环）');
  });

  await t.test('4. 视频专属运镜元数据直读与重构 (Video Directives SSOT)', () => {
    const mockVideoShot = {
      shotId: 'c1-02',
      motionDirective: {
        label: '环绕巡视',
        instruction: 'cinematic 360-degree orbit camera movement around subject',
        presetId: 'motion_orbit_arc',
      },
      dynamicDirective: {
        label: '电影级平缓 (5/10)',
        instruction: 'smooth 5/10 cinematic motion dynamic',
        presetId: 'dynamic_smooth_5',
      },
      focusDirective: {
        label: '锁定主体',
        instruction: 'keep main subject tightly locked in visual center',
        presetId: 'focus_subject',
      },
      videoPrompt: '主角缓缓拔出腰间长剑，眼神坚定直视前方',
    };

    const { directives, pureAction } = extractStructuredVideoDirectives(mockVideoShot);

    assert.equal(directives.motion?.label, '环绕巡视');
    assert.equal(directives.dynamic?.label, '电影级平缓 (5/10)');
    assert.equal(directives.focus?.label, '锁定主体');
    assert.equal(pureAction, '主角缓缓拔出腰间长剑，眼神坚定直视前方');

    // 模拟创作者在视频上拉菜单中修改运镜为“缓缓推近”
    const updatedDirectives = {
      ...directives,
      motion: {
        label: '缓缓推近',
        instruction: 'cinematic slow dolly in towards subject',
        presetId: 'motion_dolly_in',
      },
    };

    const reassembledVideo = reconstructVideoPrompt(pureAction, updatedDirectives, '微风拂过发丝');
    assert.ok(reassembledVideo.includes('cinematic slow dolly in'), '包含新推镜运镜指令');
    assert.ok(reassembledVideo.includes('主角缓缓拔出腰间长剑'), '包含核心表演文本');
    assert.ok(reassembledVideo.includes('smooth 5/10 cinematic motion dynamic'), '包含动力学平缓控制');
    assert.ok(reassembledVideo.includes('微风拂过发丝'), '包含自定义细节');
  });
});
