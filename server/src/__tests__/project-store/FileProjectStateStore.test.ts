import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { ProjectStore } from '../../project-store/ProjectStore.js';
import { WorkflowStage, SessionStatus } from '../../types/index.js';

describe('FileProjectStateStore 多会话并发与状态一致性', () => {
  const store = ProjectStore.getInstance();
  const testProjectId = 'test_proj_concurrent_sessions';

  before(() => {
    const now = new Date().toISOString();
    store.saveProject({
      projectId: testProjectId,
      title: '并发测试工程',
      status: SessionStatus.IDLE,
      currentStage: WorkflowStage.NARRATIVE_DESIGN,
      stageArtifacts: {},
      history: [],
      meta: { idea: '并发测试', style: '写实', videoRatio: '16:9', videoResolution: '720P' },
      createdAt: now,
      updatedAt: now,
    });
  });

  after(() => {
    try {
      store.deleteProject(testProjectId);
    } catch {}
  });

  it('多会话隔离性：不同会话的消息流与白板互不干扰', async () => {
    const sessA = store.createSession(testProjectId, '会话 A');
    const sessB = store.createSession(testProjectId, '会话 B');

    assert.notEqual(sessA.sessionId, sessB.sessionId);

    store.appendMessage(testProjectId, sessA.sessionId, {
      id: 'msg_a_1',
      role: 'user',
      content: '来自会话 A 的需求',
      createdAt: new Date().toISOString(),
    });

    store.appendMessage(testProjectId, sessB.sessionId, {
      id: 'msg_b_1',
      role: 'user',
      content: '来自会话 B 的独立讨论',
      createdAt: new Date().toISOString(),
    });

    const msgsA = store.getMessages(testProjectId, sessA.sessionId);
    const msgsB = store.getMessages(testProjectId, sessB.sessionId);

    assert.equal(msgsA.length, 1);
    assert.equal(msgsA[0].id, 'msg_a_1');
    assert.equal(msgsB.length, 1);
    assert.equal(msgsB[0].id, 'msg_b_1');
  });

  it('多会话并发写入消息：高频交错写入时无数据丢失或覆写', async () => {
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

    assert.equal(msgs1.length, totalEach, '会话 1 的所有消息必须完整落盘且无丢失');
    assert.equal(msgs2.length, totalEach, '会话 2 的所有消息必须完整落盘且无丢失');
  });

  it('setArtifact 时效性保全：自动注入 createdAt 与 updatedAt 时间戳', () => {
    const sampleArtifact = {
      title: '时效测试大纲',
      content: '测试内容',
    };

    store.setArtifact(testProjectId, 'narrative_design', sampleArtifact);

    const saved = store.getArtifact<any>(testProjectId, 'narrative_design');
    assert.ok(saved);
    assert.equal(saved.title, '时效测试大纲');
    assert.ok(saved.createdAt, '必须包含 createdAt');
    assert.ok(saved.updatedAt, '必须包含 updatedAt');
  });
});
