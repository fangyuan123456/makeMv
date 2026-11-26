import fs from 'fs';
import path from 'path';

const projectId = 'proj_1795483074481_bprz';
const filmSpecPath = path.join('server/data/projects', projectId, 'film_spec.json');
const storyboardsPath = path.join('server/data/projects', projectId, 'storyboards.json');

const PROMPT_B = `【核心前景主体 · 李秀兰】：位于画左前方视觉中心，身体完全呈侧身朝向画左供桌（Facing Camera Left），双手执三炷细香前伸，香头悬停在烛火上方一寸处。头部呈四分之三侧面，视线斜向下 35 度死死锁定火苗，下颌线条在下方烛火暖光照耀下坚毅冷峻。
【中景近身位 · 陈小满】：位于李秀兰身侧画中偏左位置，身体正面朝向大门方向，双肩内扣，双手将旧布老虎死死贴紧胸口，低垂头部，视线斜向下怯生生地盯着香炉边缘。
【中景右侧暗部 · 陈建国】：伫立在画右侧方的柱石阴影中，身体呈侧身微转朝向画左（Facing Left Towards Table），双手下垂贴腿，双眼目光阴鸷地斜向下投射，视线死死锁定供桌底缝深处的旧铁盒。
【后景遗照旁 · 陈明芳】：立于后堂黑白遗照左后侧阴影边缘，身体朝向正前方，头部微侧，视线死死盯向高悬的遗照相框，右手袖口半遮胸口，手指紧攥。
【远景门廊边缘 · 陈明辉】：倚立在画右后方的远景门廊阴影中，身体侧背对众人面向门外，单手下垂握持手机，拇指悬在屏幕上方，视线斜向下瞥着微弱的手机屏冷光。
【光影与空间物理】：画左下方烛火作为局部强主光，自下而上勾勒李秀兰的面庞与香炉轮廓；画右木格窗棂透入的凄冷幽蓝月光切过陈建国的后背轮廓，在潮湿青石板地上投下斑驳斜影，冷暖两极对撞，挽联在深处阴风中微摆，全员各怀鬼胎，空间层次极为深邃。`;

const imageUrl = `/media/${projectId}/keyframes/shot_c1_02_ab_version_b.png`;

function updateClips(clips: any[]) {
  for (const c of clips) {
    if (c.clipId === 'c1') {
      const shot = c.shots?.find((s: any) => s.shotId === 'c1-02');
      if (shot) {
        shot.firstFramePrompt = PROMPT_B;
        shot.firstFrameImageUrl = imageUrl;
        shot.imageUrl = imageUrl;
        if (!shot.firstFrameVersions) shot.firstFrameVersions = [];
        shot.firstFrameVersions.push({
          versionId: `ver_${Date.now()}_v_b`,
          imageUrl: imageUrl,
          fileName: 'shot_c1_02_ab_version_b.png',
          prompt: PROMPT_B,
          source: 'generate',
          createdAt: new Date().toISOString()
        });
        console.log('[Update] 镜头 c1-02 首帧及版本历史已成功写入！');
      }
    }
  }
}

if (fs.existsSync(filmSpecPath)) {
  const filmSpec = JSON.parse(fs.readFileSync(filmSpecPath, 'utf8'));
  updateClips(filmSpec.clips || []);
  fs.writeFileSync(filmSpecPath, JSON.stringify(filmSpec, null, 2), 'utf8');
}

if (fs.existsSync(storyboardsPath)) {
  const storyboards = JSON.parse(fs.readFileSync(storyboardsPath, 'utf8'));
  updateClips(storyboards);
  fs.writeFileSync(storyboardsPath, JSON.stringify(storyboards, null, 2), 'utf8');
}

console.log('[Update] 项目持久化产物同步成功！');
