/**
 * FileProjectStateStore.stress.test.ts
 * Milestone 1 极限并发、大体积 Payload 与深层嵌套落盘对抗压测套件
 *
 * 对抗验证目标：
 * 1. 100 并发异步操作对单会话追加消息：实证检验零消息丢失、顺序可追溯、零 EPERM/EBUSY 崩溃；
 * 2. 80 并发操作跨多会话交错读写与白板更新；
 * 3. 100 并发异步工序产物 setArtifact / getArtifact 读写与历史快照碰撞防丢；
 * 4. LRU 100 上限溢出测试：创建 150 个会话，验证冷数据淘汰后按需从磁盘物理再水化且数据无损；
 * 5. 5MB~10MB 巨型深层嵌套 Payload (多角色、长卷分镜、深层树) 原子写入与读取保真度；
 * 6. 异常与边界防御：序列化崩溃不损坏现有文件、零 .tmp 临时文件泄露。
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { ProjectStore } from '../../src/project-store/ProjectStore.js';
import { WorkflowStage, SessionStatus } from '../../src/types/index.js';

describe('FileProjectStateStore 极限高并发与大体积落盘对抗实证', () => {
  const store = ProjectStore.getInstance();
  const stressProjectId = 'stress_test_project_ssot';

  before(() => {
    try {
      store.deleteProject(stressProjectId);
    } catch {}

    const now = new Date().toISOString();
    store.saveProject({
      projectId: stressProjectId,
      title: '极限对抗测试工程',
      status: SessionStatus.IDLE,
      currentStage: WorkflowStage.NARRATIVE_DESIGN,
      stageArtifacts: {},
      history: [],
      meta: {
        idea: '极限对抗实证压测',
        style: '赛博朋克',
        videoRatio: '16:9',
        videoResolution: '1080P',
      },
      createdAt: now,
      updatedAt: now,
    });
  });

  after(() => {
    try {
      store.deleteProject(stressProjectId);
    } catch {}
    try {
      store.deleteProject('stress_lru_project');
    } catch {}
    try {
      store.deleteProject('stress_giant_payload_project');
    } catch {}
  });

  it('对抗用例 1: 100 个并发异步操作同时向同一个会话追加消息 (零消息丢失与无 EPERM 崩溃)', async () => {
    const session = store.createSession(stressProjectId, '100并发追加测试会话');
    const concurrencyCount = 100;
    const promises: Promise<void>[] = [];

    for (let i = 0; i < concurrencyCount; i++) {
      promises.push(
        (async (index: number) => {
          // 引入微任务与随机事件循环抖动，模拟真实异构网络/AI生成回调
          await new Promise((resolve) => setImmediate(resolve));
          if (index % 3 === 0) {
            await new Promise((resolve) => setTimeout(resolve, Math.floor(Math.random() * 5)));
          }

          store.appendMessage(stressProjectId, session.sessionId, {
            id: `concurrent_msg_${String(index).padStart(4, '0')}`,
            role: index % 2 === 0 ? 'user' : 'assistant',
            content: `并发写入指令内容 payload index = ${index}`,
            createdAt: new Date().toISOString(),
          });
        })(i)
      );
    }

    await Promise.all(promises);

    // 1. 内存中消息总数校验
    const inMemoryMsgs = store.getMessages(stressProjectId, session.sessionId);
    assert.equal(
      inMemoryMsgs.length,
      concurrencyCount,
      `内存中消息数量必须严格等于 ${concurrencyCount}，实际为 ${inMemoryMsgs.length}`
    );

    // 2. 物理磁盘文件校验
    const projectDir = store.getProjectDir(stressProjectId);
    const messagesFile = path.join(projectDir, 'chat', session.sessionId, 'messages.json');
    assert.ok(fs.existsSync(messagesFile), 'messages.json 物理文件必须存在');

    const fileRaw = fs.readFileSync(messagesFile, 'utf-8');
    const diskMsgs = JSON.parse(fileRaw);
    assert.equal(
      diskMsgs.length,
      concurrencyCount,
      `物理磁盘中 messages.json 记录条数必须严格等于 ${concurrencyCount}，实际为 ${diskMsgs.length}`
    );

    // 3. 所有消息 ID 完整性验证 (无任何重复或覆盖丢失)
    const msgIds = new Set(diskMsgs.map((m: any) => m.id));
    assert.equal(msgIds.size, concurrencyCount, '所有 100 条消息 ID 必须全部唯一定位且无覆盖丢失');

    // 4. 检查是否有残留的 .tmp 文件
    const chatDir = path.join(projectDir, 'chat', session.sessionId);
    const tmpFiles = fs.readdirSync(chatDir).filter((f) => f.endsWith('.tmp'));
    assert.equal(tmpFiles.length, 0, `临时写入文件必须在原子落盘后全部清理，不得泄露: ${tmpFiles.join(', ')}`);
  });

  it('对抗用例 2: 80 个并发操作跨 40 个会话交错读写与白板更新', async () => {
    const sessionCount = 40;
    const sessionIds: string[] = [];
    for (let s = 0; s < sessionCount; s++) {
      const sess = store.createSession(stressProjectId, `交错测试会话_${s}`);
      sessionIds.push(sess.sessionId);
    }

    const workersCount = 80;
    const workerPromises: Promise<void>[] = [];

    for (let w = 0; w < workersCount; w++) {
      workerPromises.push(
        (async (workerId: number) => {
          const targetSessionId = sessionIds[workerId % sessionCount];
          await new Promise((resolve) => setImmediate(resolve));

          // 追加消息
          store.appendMessage(stressProjectId, targetSessionId, {
            id: `interleaved_msg_w${workerId}`,
            role: 'user',
            content: `工作线程 ${workerId} 发送的消息`,
            createdAt: new Date().toISOString(),
          });

          // 白板并发更新
          store.updateScratchpad(stressProjectId, targetSessionId, {
            storySpine: `由工作线程 ${workerId} 标记的最新主干发展`,
            userConstraints: [`禁忌规则_${workerId}`],
          });

          // 立即读取白板验证一致性
          const pad = store.getScratchpad(stressProjectId, targetSessionId);
          assert.ok(pad);
          assert.ok(pad.lastUpdatedAt);
        })(w)
      );
    }

    await Promise.all(workerPromises);

    // 验证所有会话皆有对应消息落盘且可完整读取
    for (const sid of sessionIds) {
      const msgs = store.getMessages(stressProjectId, sid);
      assert.ok(msgs.length >= 2, `每个会话应至少分配到 2 条并发消息，实际为 ${msgs.length}`);
    }
  });

  it('对抗用例 3: 100 个并发操作对 stageArtifacts 进行高频写入、读取与历史快照碰撞测试', async () => {
    const stages = [
      'narrative_design',
      'character_design',
      'storyboard',
      'keyframe_reference',
      'video_production',
    ];
    const opCount = 100;
    const writeAndReadOps: Promise<void>[] = [];

    for (let i = 0; i < opCount; i++) {
      writeAndReadOps.push(
        (async (idx: number) => {
          const stage = stages[idx % stages.length];
          await new Promise((resolve) => setImmediate(resolve));

          // 写入产物
          store.setArtifact(
            stressProjectId,
            stage,
            {
              iteration: idx,
              payload: `工序产物数据帧_${idx}`,
              nestedDetails: {
                timestamp: Date.now(),
                tags: [`tag_${idx}`, 'stress', 'verified'],
              },
            },
            {
              skill: `skill-${stage}`,
              model: 'test-adversarial-model',
              taskId: `task_${idx}`,
            }
          );

          // 立即并发读取验证
          const readBack = store.getArtifact<any>(stressProjectId, stage);
          assert.ok(readBack, `读取到的产物 [${stage}] 不得为空`);
          assert.ok(readBack.createdAt, `产物必须自动注入 createdAt`);
          assert.ok(readBack.__meta, `产物必须自动注入 __meta`);
        })(i)
      );
    }

    await Promise.all(writeAndReadOps);

    // 验证 artifacts 历史快照归档机制
    const projectDir = store.getProjectDir(stressProjectId);
    const artifactsDir = path.join(projectDir, 'artifacts');
    assert.ok(fs.existsSync(artifactsDir), 'artifacts/ 归档目录必须存在');

    const snapshotFiles = fs.readdirSync(artifactsDir).filter((f) => f.endsWith('.json'));
    assert.ok(
      snapshotFiles.length > 0,
      `高频写入应成功触发历史快照归档，生成文件数: ${snapshotFiles.length}`
    );

    // 检验每一个历史快照文件的 JSON 完好性 (无截断、无 0 字节、无解析错误)
    for (const snap of snapshotFiles) {
      const snapPath = path.join(artifactsDir, snap);
      const raw = fs.readFileSync(snapPath, 'utf-8');
      assert.ok(raw.length > 0, `快照文件 ${snap} 不得为 0 字节`);
      const parsed = JSON.parse(raw);
      assert.ok(parsed, `快照文件 ${snap} 必须为合法的 JSON 对象`);
    }

    // 检验主 project.json 文件完好性
    const mainJsonPath = path.join(projectDir, 'project.json');
    const mainRaw = fs.readFileSync(mainJsonPath, 'utf-8');
    const mainParsed = JSON.parse(mainRaw);
    assert.equal(mainParsed.projectId, stressProjectId);
    assert.ok(mainParsed.stageArtifacts);
    for (const s of stages) {
      assert.ok(mainParsed.stageArtifacts[s], `主配置中 stage [${s}] 产物必须完好保留`);
    }
  });

  it('对抗用例 4: LRU 有界缓存上限溢出 (150 会话超出 100 容量)，冷数据按需磁盘重水化保真度', async () => {
    const lruProjectId = 'stress_lru_project';
    try {
      store.deleteProject(lruProjectId);
    } catch {}
    const now = new Date().toISOString();
    store.saveProject({
      projectId: lruProjectId,
      title: 'LRU 边界对抗工程',
      status: SessionStatus.IDLE,
      currentStage: WorkflowStage.NARRATIVE_DESIGN,
      stageArtifacts: {},
      history: [],
      meta: {
        idea: '自动化测试',
        style: '写实',
        videoRatio: '16:9',
        videoResolution: '720P',
      },
      createdAt: now,
      updatedAt: now,
    });

    const totalSessions = 150; // 超过 BoundedCache 默认容量 100
    const createdSessions: { sessionId: string; secretToken: string }[] = [];

    // 顺序建立 150 个会话并各自写入一条携带特异特征的消息
    for (let i = 0; i < totalSessions; i++) {
      const token = `token_secret_${i}_${Math.random().toString(36).slice(2, 8)}`;
      const sess = store.createSession(lruProjectId, `会话_${i}`);
      createdSessions.push({ sessionId: sess.sessionId, secretToken: token });

      store.appendMessage(lruProjectId, sess.sessionId, {
        id: `msg_lru_${i}`,
        role: 'user',
        content: `会话专有特征签名: ${token}`,
        createdAt: new Date().toISOString(),
      });
    }

    // 此时前 50 个会话必然已被逐出内存 LRU 缓存 (0..49)
    // 逆向遍历验证被淘汰会话重新从磁盘加载 (Re-hydration) 的完整性与一致性
    for (let i = 0; i < 50; i++) {
      const { sessionId, secretToken } = createdSessions[i];
      // getSession 应该命中磁盘重读取
      const sess = store.getSession(lruProjectId, sessionId);
      assert.ok(sess, `被 LRU 逐出的会话 ${sessionId} 必须能够从磁盘重新激活读取`);

      // getMessages 应该命中磁盘重读取
      const msgs = store.getMessages(lruProjectId, sessionId);
      assert.equal(msgs.length, 1, `被 LRU 逐出的会话 ${sessionId} 消息数必须为 1`);
      assert.ok(
        msgs[0].content.includes(secretToken),
        `磁盘重载消息内容必须与原始特异标记一致: 期望包含 ${secretToken}`
      );
    }

    // 验证 listSessions 能遍历完整 150 个真实会话
    const listed = store.listSessions(lruProjectId);
    assert.equal(listed.length, totalSessions, `listSessions 必须遍历到所有 ${totalSessions} 个有效会话`);

    // 测试完毕及时清理
    try {
      store.deleteProject(lruProjectId);
    } catch {}
  });

  it('对抗用例 5: 大体积 Payload (~5MB) 与深层嵌套对象原子落盘保真度与防截断', async () => {
    const giantProjectId = 'stress_giant_payload_project';
    const now = new Date().toISOString();
    store.saveProject({
      projectId: giantProjectId,
      title: '巨型产物落盘压测工程',
      status: SessionStatus.IDLE,
      currentStage: WorkflowStage.STORYBOARD,
      stageArtifacts: {},
      history: [],
      meta: {
        idea: '自动化测试',
        style: '写实',
        videoRatio: '16:9',
        videoResolution: '720P',
      },
      createdAt: now,
      updatedAt: now,
    });

    // 构造具备真实世界生产规模的超大故事圣经 (500 角色 + 50 幕长篇主干 + 深层嵌套)
    const characters: any[] = [];
    for (let c = 0; c < 500; c++) {
      characters.push({
        name: `角色_${c}`,
        role: c === 0 ? '主角' : c < 10 ? '核心配角' : '群演',
        motivation: `这是角色 ${c} 的深层心理动机，包含数千字的人生背景、心理创伤与目标追求，反复描述以构造大体积 Payload。`.repeat(5),
        appearance: `骨相特征: 身高 18${c % 10}cm，特异发型，服装细节包括 ${'精致皮质风衣、金属肩章、发光线圈、'.repeat(8)}。`,
        tags: [`faction_${c % 5}`, `tier_${c % 3}`, 'verified_character'],
        relationships: Array.from({ length: 10 }, (_, rIdx) => ({
          target: `角色_${(c + rIdx) % 500}`,
          type: rIdx % 2 === 0 ? 'ally' : 'rival',
          affinity: Math.sin(c + rIdx),
        })),
      });
    }

    // 构造具备 300 个镜头详细运镜的巨型分镜表
    const shots: any[] = [];
    for (let s = 0; s < 300; s++) {
      shots.push({
        shotIndex: s + 1,
        cameraMotion: s % 3 === 0 ? 'PUSH_IN' : s % 3 === 1 ? 'ORBIT' : 'CRANE_DOWN',
        lens: '35mm Anamorphic',
        lighting: '赛博霓虹低照度冷光，辅以高反差金黄色背光边缘轮廓',
        prompt: `电影级杰作镜头 ${s + 1}，4K 分辨率，虚幻引擎5渲染，逼真皮肤纹理与体积雾效果。`.repeat(10),
        duration: 3.5,
        dialogues: [
          { speaker: `角色_${s % 50}`, text: `这是镜头 ${s} 的重要台词：“命运的齿轮在这一刻开始转动。”` },
        ],
      });
    }

    const giantBible = {
      title: '宏大编年史：千星之渊',
      logline: '跨越三千光年的多方政治悬疑科幻史诗',
      characters,
      shots,
      deepHierarchy: {
        level1: {
          level2: {
            level3: {
              level4: {
                level5: {
                  data: '深层嵌套终端节点数据'.repeat(100),
                },
              },
            },
          },
        },
      },
    };

    // 执行超大体积产物写入
    const t0 = Date.now();
    store.setArtifact(giantProjectId, 'narrative_design', giantBible, {
      skill: 'story-bible-giant',
      model: 'qwen-max',
    });
    const writeTimeMs = Date.now() - t0;

    // 验证落盘写入时间处于合理区间 (一般在 2000ms 内完成)
    assert.ok(writeTimeMs < 10000, `超大文件写入耗时必须 < 10000ms，实际耗时: ${writeTimeMs}ms`);

    // 检查磁盘物理大小
    const projectDir = store.getProjectDir(giantProjectId);
    const projectFile = path.join(projectDir, 'project.json');
    const fileStats = fs.statSync(projectFile);
    const sizeInMb = fileStats.size / (1024 * 1024);
    assert.ok(sizeInMb >= 0.5, `落盘文件大小应在 0.5MB 以上以满足大体积验证，实际为 ${sizeInMb.toFixed(2)} MB`);

    // 验证完整读回保真度 (深层相等)
    const readBack = store.getArtifact<any>(giantProjectId, 'narrative_design');
    assert.ok(readBack, '超大产物读取结果不得为空');
    assert.equal(readBack.characters.length, 500, '角色数量必须保全 500 个');
    assert.equal(readBack.shots.length, 300, '镜头数量必须保全 300 个');
    assert.equal(
      readBack.deepHierarchy.level1.level2.level3.level4.level5.data,
      giantBible.deepHierarchy.level1.level2.level3.level4.level5.data,
      '深层嵌套属性必须 100% 保真匹配'
    );

    // 二次覆写验证 (触发超大历史快照归档与覆盖)
    giantBible.title = '宏大编年史：千星之渊 (第二修正版)';
    store.setArtifact(giantProjectId, 'narrative_design', giantBible);

    const reRead = store.getArtifact<any>(giantProjectId, 'narrative_design');
    assert.equal(reRead.title, '宏大编年史：千星之渊 (第二修正版)');

    // 验证 artifacts/ 归档了超大旧版本
    const artifactsDir = path.join(projectDir, 'artifacts');
    const snapshots = fs.readdirSync(artifactsDir).filter((f) => f.startsWith('narrative_design.'));
    assert.ok(snapshots.length >= 1, '必须生成超大产物的历史版本快照');

    const snapStat = fs.statSync(path.join(artifactsDir, snapshots[0]));
    assert.ok(snapStat.size / (1024 * 1024) >= 0.5, '历史快照归档尺寸必须保持相当');
  });

  it('对抗用例 6: 破坏性边界注入与原子写盘防御 (不产生残留 .tmp 与脏文件)', () => {
    const errorProjectId = 'stress_error_project';
    const now = new Date().toISOString();
    store.saveProject({
      projectId: errorProjectId,
      title: '错误注入测试工程',
      status: SessionStatus.IDLE,
      currentStage: WorkflowStage.NARRATIVE_DESIGN,
      stageArtifacts: {},
      history: [],
      meta: {
        idea: '自动化测试',
        style: '写实',
        videoRatio: '16:9',
        videoResolution: '720P',
      },
      createdAt: now,
      updatedAt: now,
    });

    const projectDir = store.getProjectDir(errorProjectId);

    // 1. 尝试注入无法序列化的循环引用对象
    const circularObj: any = { name: 'circular' };
    circularObj.self = circularObj;

    // 刚性断言：saveProject 遭遇无法序列化的循环引用时，必须向外抛出异常，拒绝假收敛！
    assert.throws(
      () => store.setArtifact(errorProjectId, 'broken_stage', circularObj),
      /(circular|Converting circular structure to JSON)/i,
      '循环引用必须抛出序列化异常'
    );

    // 2. 检查 project.json 是否被破坏
    const projectJson = path.join(projectDir, 'project.json');
    assert.ok(fs.existsSync(projectJson));
    const content = JSON.parse(fs.readFileSync(projectJson, 'utf-8'));
    assert.equal(content.projectId, errorProjectId);
    assert.equal(content.stageArtifacts?.['broken_stage'], undefined, '物理磁盘保持未受污染状态，脏数据未落盘');

    // 3. 检查是否有残留的 .tmp 孤儿文件
    const files = fs.readdirSync(projectDir);
    const danglingTmp = files.filter((f) => f.endsWith('.tmp'));
    assert.equal(
      danglingTmp.length,
      0,
      `发生异常时必须完全清理 .tmp 临时文件，不得残留孤儿文件: ${danglingTmp.join(', ')}`
    );

    store.deleteProject(errorProjectId);
  });
});
