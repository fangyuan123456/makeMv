import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { ProjectStore } from '../../src/project-store/ProjectStore.js';
import { config } from '../../src/utils/config.js';
import { trace } from '../../src/utils/trace.js';
import { WorkflowStage, SessionStatus } from '../../src/types/index.js';

describe('FileProjectStateStore 生产级文件状态黑板 (SSOT)', () => {
  const store = ProjectStore.getInstance();
  const testProjectId = 'test_proj_concurrent_sessions';

  before(() => {
    // 幂等清理旧残留
    try {
      store.deleteProject(testProjectId);
    } catch {}

    const now = new Date().toISOString();
    store.saveProject({
      projectId: testProjectId,
      title: '自动化测试工程',
      status: SessionStatus.IDLE,
      currentStage: WorkflowStage.NARRATIVE_DESIGN,
      stageArtifacts: {},
      history: [],
      meta: { idea: '自动化单测', style: '写实', videoRatio: '16:9', videoResolution: '720P' },
      createdAt: now,
      updatedAt: now,
    });
  });

  after(() => {
    try {
      store.deleteProject(testProjectId);
    } catch {}
    try {
      store.deleteProject('../../malicious_project_name');
    } catch {}
    try {
      store.deleteProject('test_proj_appearance_ssot');
    } catch {}
  });

  it('1. 多会话隔离性：不同会话的消息流与白板互不干扰', async () => {
    const sessA = store.createSession(testProjectId, '会话 A');
    const sessB = store.createSession(testProjectId, '会话 B');
    assert.notEqual(sessA.sessionId, sessB.sessionId);

    store.appendMessage(testProjectId, sessA.sessionId, {
      id: 'msg_a_1',
      role: 'user',
      content: '会话 A 专有指令',
      createdAt: new Date().toISOString(),
    });

    store.appendMessage(testProjectId, sessB.sessionId, {
      id: 'msg_b_1',
      role: 'user',
      content: '会话 B 独立讨论',
      createdAt: new Date().toISOString(),
    });

    const msgsA = store.getMessages(testProjectId, sessA.sessionId);
    const msgsB = store.getMessages(testProjectId, sessB.sessionId);
    assert.equal(msgsA.length, 1);
    assert.equal(msgsA[0].id, 'msg_a_1');
    assert.equal(msgsB.length, 1);
    assert.equal(msgsB[0].id, 'msg_b_1');
  });

  it('2. 高并发交错写盘：多会话高频并发追加消息零丢失', async () => {
    const sess1 = store.createSession(testProjectId, '并发会话 1');
    const sess2 = store.createSession(testProjectId, '并发会话 2');
    const totalEach = 15;
    const writePromises: Promise<void>[] = [];

    for (let i = 0; i < totalEach; i++) {
      writePromises.push(
        (async (idx) => {
          store.appendMessage(testProjectId, sess1.sessionId, {
            id: `msg_s1_${idx}`,
            role: 'user',
            content: `会话1 消息 ${idx}`,
            createdAt: new Date().toISOString(),
          });
        })(i)
      );
      writePromises.push(
        (async (idx) => {
          store.appendMessage(testProjectId, sess2.sessionId, {
            id: `msg_s2_${idx}`,
            role: 'assistant',
            content: `会话2 回复 ${idx}`,
            createdAt: new Date().toISOString(),
          });
        })(i)
      );
    }

    await Promise.all(writePromises);
    const msgs1 = store.getMessages(testProjectId, sess1.sessionId);
    const msgs2 = store.getMessages(testProjectId, sess2.sessionId);
    assert.equal(msgs1.length, totalEach, '会话 1 必须完整写入 15 条消息');
    assert.equal(msgs2.length, totalEach, '会话 2 必须完整写入 15 条消息');
  });

  it('3. 产物时效保全与来源追溯：自动注入 createdAt, updatedAt 及 __meta', () => {
    const sampleArtifact = { title: '测试大纲', content: '内容' };
    store.setArtifact(testProjectId, 'narrative_design', sampleArtifact, {
      skill: 'story-bible',
      model: 'qwen-plus',
    });

    const saved = store.getArtifact<any>(testProjectId, 'narrative_design');
    assert.ok(saved);
    assert.equal(saved.title, '测试大纲');
    assert.ok(saved.createdAt);
    assert.ok(saved.updatedAt);
    assert.equal(saved.__meta?.skill, 'story-bible');
    assert.equal(saved.__meta?.model, 'qwen-plus');
  });

  it('4. 历史版本快照归档与回溯：覆写产物时自动按 timestamp 归档至 artifacts/ 目录', () => {
    // 首次产物写入
    store.setArtifact(testProjectId, 'storyboard', { version: 1, desc: '初始分镜' });
    // 二次产物覆写，触发自动快照归档
    store.setArtifact(testProjectId, 'storyboard', { version: 2, desc: '调整后分镜' });

    const current = store.getArtifact<any>(testProjectId, 'storyboard');
    assert.equal(current.version, 2);

    const projectDir = store.getProjectDir(testProjectId);
    const artifactsDir = path.join(projectDir, 'artifacts');
    assert.ok(fs.existsSync(artifactsDir), 'artifacts 归档目录必须存在');

    const snapshots = fs.readdirSync(artifactsDir).filter((f) => f.startsWith('storyboard.'));
    assert.ok(snapshots.length >= 1, '必须至少生成 1 份历史快照');

    const archivedContent = JSON.parse(fs.readFileSync(path.join(artifactsDir, snapshots[0]), 'utf-8'));
    assert.equal(archivedContent.version, 1, '归档快照内容必须为旧版本产物');

    // 校验 getSnapshot
    const snapshot = store.getSnapshot(testProjectId);
    assert.ok(snapshot);
    assert.equal(snapshot.project.projectId, testProjectId);
    assert.equal(snapshot.projectDir, projectDir);
  });

  it('5. 路径穿越安全防护：相对路径越界与非法字符 100% 刚性阻断抛错 (Fail-Fast)', () => {
    const maliciousId = '../../malicious_project_name';

    // 1. getProjectDir 遇到恶意路径直接抛出 Error，彻底废除隐式创建下划线目录
    assert.throws(
      () => store.getProjectDir(maliciousId),
      /非法的 projectId/
    );

    // 2. getProject 刚性拦截
    assert.throws(
      () => store.getProject(maliciousId),
      /非法的 projectId/
    );

    // 3. deleteProject 刚性拦截
    assert.throws(
      () => store.deleteProject(maliciousId),
      /非法的 projectId/
    );

    // 4. getArtifact 刚性拦截
    assert.throws(
      () => store.getArtifact(maliciousId, 'narrative_design'),
      /非法的 projectId/
    );

    // 5. setArtifact 刚性拦截 (防线生效，杜绝向 trace.ts 透传恶意路径)
    assert.throws(
      () => store.setArtifact(maliciousId, 'narrative_design', {}),
      /非法的 projectId/
    );

    // 6. createSession 刚性拦截
    assert.throws(
      () => store.createSession(maliciousId),
      /非法的 projectId/
    );
  });

  it('6. 会话阶段权威跟随：会话 currentStage 始终动态跟随项目 currentStage (SSOT)', () => {
    const session = store.createSession(testProjectId, '工序跟随会话');
    assert.equal(session.currentStage, WorkflowStage.NARRATIVE_DESIGN);

    const project = store.getProject(testProjectId)!;
    project.currentStage = WorkflowStage.CHARACTER_DESIGN;
    store.saveProject(project);

    // 重新获取会话，验证 currentStage 动态对齐项目阶段
    const refreshed = store.getSession(testProjectId, session.sessionId);
    assert.equal(refreshed?.currentStage, WorkflowStage.CHARACTER_DESIGN);
  });

  it('7. SSOT 契约继承：createSession 从故事圣经标准 appearance 字段继承人设，拒绝 appearancePrompt 别名', () => {
    const bibleProjectId = 'test_proj_appearance_ssot';
    const now = new Date().toISOString();
    store.saveProject({
      projectId: bibleProjectId,
      title: '外貌测试工程',
      status: SessionStatus.IDLE,
      currentStage: WorkflowStage.NARRATIVE_DESIGN,
      stageArtifacts: {
        narrative_design: {
          title: '外貌测试',
          characters: [
            {
              name: '沈墨',
              role: '男主角',
              motivation: '寻找真相',
              appearance: '剑眉星目，身着黑色风衣',
            },
          ],
        },
      },
      history: [],
      meta: { idea: '测试', style: '悬疑', videoRatio: '16:9', videoResolution: '720P' },
      createdAt: now,
      updatedAt: now,
    });

    const session = store.createSession(bibleProjectId, '测试会话');
    assert.ok(session.scratchpad.charactersSummary?.includes('骨相特征: 剑眉星目，身着黑色风衣'));
    store.deleteProject(bibleProjectId);
  });

  it('8. 刚性防御：非法或空 projectId 访问触发 Fail-Fast 异常抛出', () => {
    assert.throws(
      () => store.getProject(''),
      /非法的 projectId/
    );
    assert.throws(
      () => store.getProject('   '),
      /非法的 projectId/
    );
  });

  it('9. 会话可见性保障：新建空白会话 (0 消息) 与含消息活跃会话共存时，listSessions 完整返回所有有效会话', () => {
    // 1. 创建已有消息的活跃会话
    const activeSession = store.createSession(testProjectId, '活跃会话');
    store.appendMessage(testProjectId, activeSession.sessionId, {
      id: 'active_msg_1',
      role: 'user',
      content: '已有消息',
      createdAt: new Date().toISOString(),
    });

    // 2. 创建刚新建的空白会话 (无消息)
    const emptySession = store.createSession(testProjectId, '新建空白会话');

    // 3. 遍历会话
    const sessions = store.listSessions(testProjectId);

    // 4. 断言两个会话都必须在列表中存在
    assert.ok(sessions.length >= 2, '必须至少包含 2 个会话');
    const foundActive = sessions.find((s) => s.sessionId === activeSession.sessionId);
    const foundEmpty = sessions.find((s) => s.sessionId === emptySession.sessionId);
    assert.ok(foundActive, '活跃会话必须存在');
    assert.ok(foundEmpty, '刚创建的空白会话必须在列表中正常可见，不得被误杀过滤');
  });

  it('10. Fail-Fast 异常刚性冒泡：持久化写盘失败或项目不存在时拒绝假收敛，必须向外 throw 异常', () => {
    // 1. setArtifact 遭遇不存在的项目时刚性抛错
    assert.throws(
      () => store.setArtifact('non_existent_project_id', 'story_bible', { title: '测试' }),
      /setArtifact 失败: 未找到项目/,
      '未找到项目时 setArtifact 必须刚性抛错，禁止静默 warn'
    );

    // 2. 注入循环引用无法序列化对象验证 saveProject 刚性抛错
    const circularProject: any = {
      projectId: 'test_circular_project',
      title: '循环引用测试',
    };
    circularProject.self = circularProject;
    assert.throws(
      () => store.saveProject(circularProject),
      /(circular|Converting circular structure to JSON)/i,
      'saveProject 写入循环引用必须刚性抛出序列化异常'
    );

    // 3. 验证 saveSession 写入循环引用刚性抛错
    const circularSession: any = {
      projectId: testProjectId,
      sessionId: 'test_circular_session',
      title: '循环引用会话',
    };
    circularSession.self = circularSession;
    assert.throws(
      () => store.saveSession(circularSession),
      /(circular|Converting circular structure to JSON)/i,
      'saveSession 写入循环引用必须刚性抛出序列化异常'
    );

    // 4. 验证 saveMessages 写入循环引用刚性抛错
    const circularMessage: any = {
      id: 'msg_circ',
      role: 'user',
      content: '循环引用消息',
    };
    circularMessage.self = circularMessage;
    assert.throws(
      () => store.saveMessages(testProjectId, 'some_session', [circularMessage]),
      /(circular|Converting circular structure to JSON)/i,
      'saveMessages 写入循环引用必须刚性抛出序列化异常'
    );
  });

  it('11. trace.ts 路径逃逸防御：非法或越界 projectId 安全静默忽略，绝不在沙箱外建目录', () => {
    const maliciousId = '../../malicious_trace_escape';
    trace(maliciousId, 'test.escape', { foo: 'bar' });

    // 验证沙箱外部绝对没有创建恶意目录与文件
    const escapedDir = path.resolve(config.paths.projects, maliciousId);
    assert.ok(!fs.existsSync(escapedDir), '沙箱外部严禁创建任何 trace 目录');
  });
});
