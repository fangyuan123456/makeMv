import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { ProjectStore } from '../../project-store/ProjectStore.js';
import { FileProjectStateStore } from '../../project-store/FileProjectStateStore.js';
import { ProposalStore } from '../../project-store/ProposalStore.js';
import { config } from '../../utils/config.js';
import { WorkflowStage, SessionStatus } from '../../types/index.js';
import type { ActionProposal } from '../../chat/session/types.js';

describe('Milestone 1 对抗实证验证 (Adversarial Verification Suite)', () => {
  const store = ProjectStore.getInstance();
  const proposalStore = ProposalStore.getInstance();
  const baseProjectsDir = path.resolve(config.paths.projects);

  const testValidProjectId = 'test_adv_valid_project';

  before(() => {
    // 确保清理
    try {
      store.deleteProject(testValidProjectId);
    } catch {}

    const now = new Date().toISOString();
    store.saveProject({
      projectId: testValidProjectId,
      title: '对抗实证基准工程',
      status: SessionStatus.IDLE,
      currentStage: WorkflowStage.NARRATIVE_DESIGN,
      stageArtifacts: {},
      history: [],
      meta: { idea: '对抗测试', style: '写实', videoRatio: '16:9', videoResolution: '720P' },
      createdAt: now,
      updatedAt: now,
    });
  });

  after(() => {
    try {
      store.deleteProject(testValidProjectId);
    } catch {}

    // 清理可能产生的恶意测试目录
    const cleanupIds = [
      '../../etc/passwd',
      '../secret',
      '../../../../windows/system32/cmd.exe',
      'test_proj_alias_eradication',
      'test_corrupted_proj',
      'test_no_pid_proj',
    ];
    for (const id of cleanupIds) {
      try {
        store.deleteProject(id);
      } catch {}
      try {
        const safeId = id.replace(/[^a-zA-Z0-9_\-]/g, '_');
        const targetDir = path.resolve(baseProjectsDir, safeId);
        if (fs.existsSync(targetDir)) {
          fs.rmSync(targetDir, { recursive: true, force: true });
        }
      } catch {}
    }
  });

  // =========================================================================
  // 任务 1: 路径穿越与恶意输入投毒对抗
  // =========================================================================
  describe('任务 1: 路径穿越与恶意输入投毒对抗', () => {
    const invalidTypeProjectIds = [
      '',
      '   ',
      null as any,
      undefined as any,
      12345 as any,
      { evil: true } as any,
      ['array_id'] as any,
    ];

    it('1.1 空字符串与非字符串类型投毒：全黑板所有 API 100% 刚性拦截抛出异常', () => {
      for (const invalidId of invalidTypeProjectIds) {
        // 1. getProject
        assert.throws(
          () => store.getProject(invalidId),
          /非法的 projectId/,
          `getProject 应阻断非法 projectId: ${String(invalidId)}`
        );

        // 2. saveProject
        assert.throws(
          () => store.saveProject({ projectId: invalidId } as any),
          /projectId/,
          `saveProject 应阻断非法 projectId: ${String(invalidId)}`
        );

        // 3. deleteProject
        assert.throws(
          () => store.deleteProject(invalidId),
          /非法的 projectId/,
          `deleteProject 应阻断非法 projectId: ${String(invalidId)}`
        );

        // 4. getArtifact
        assert.throws(
          () => store.getArtifact(invalidId, 'narrative_design'),
          /非法的 projectId/,
          `getArtifact 应阻断非法 projectId: ${String(invalidId)}`
        );

        // 5. setArtifact
        assert.throws(
          () => store.setArtifact(invalidId, 'narrative_design', {}),
          /非法的 projectId/,
          `setArtifact 应阻断非法 projectId: ${String(invalidId)}`
        );

        // 6. createSession
        assert.throws(
          () => store.createSession(invalidId),
          /非法的 projectId/,
          `createSession 应阻断非法 projectId: ${String(invalidId)}`
        );

        // 7. getSession
        assert.throws(
          () => store.getSession(invalidId, 'session_1'),
          /非法的 projectId/,
          `getSession 应阻断非法 projectId: ${String(invalidId)}`
        );

        // 8. listSessions
        assert.throws(
          () => store.listSessions(invalidId),
          /非法的 projectId/,
          `listSessions 应阻断非法 projectId: ${String(invalidId)}`
        );

        // 9. saveSession
        assert.throws(
          () => store.saveSession({ projectId: invalidId, sessionId: 's1' } as any),
          /saveSession 失败|非法的 projectId/,
          `saveSession 应阻断非法 projectId: ${String(invalidId)}`
        );

        // 10. getMessages
        assert.throws(
          () => store.getMessages(invalidId, 'session_1'),
          /非法的 projectId/,
          `getMessages 应阻断非法 projectId: ${String(invalidId)}`
        );

        // 11. saveMessages
        assert.throws(
          () => store.saveMessages(invalidId, 'session_1', []),
          /非法的 projectId/,
          `saveMessages 应阻断非法 projectId: ${String(invalidId)}`
        );

        // 12. appendMessage
        assert.throws(
          () => store.appendMessage(invalidId, 'session_1', { id: 'm1', role: 'user', content: 'test', createdAt: '' }),
          /非法的 projectId/,
          `appendMessage 应阻断非法 projectId: ${String(invalidId)}`
        );

        // 13. getScratchpad
        assert.throws(
          () => store.getScratchpad(invalidId, 'session_1'),
          /非法的 projectId/,
          `getScratchpad 应阻断非法 projectId: ${String(invalidId)}`
        );

        // 14. updateScratchpad
        assert.throws(
          () => store.updateScratchpad(invalidId, 'session_1', {}),
          /非法的 projectId/,
          `updateScratchpad 应阻断非法 projectId: ${String(invalidId)}`
        );

        // 15. getProjectDir
        assert.throws(
          () => store.getProjectDir(invalidId),
          /非法的 projectId/,
          `getProjectDir 应阻断非法 projectId: ${String(invalidId)}`
        );

        // 16. getSnapshot
        assert.throws(
          () => store.getSnapshot(invalidId),
          /非法的 projectId/,
          `getSnapshot 应阻断非法 projectId: ${String(invalidId)}`
        );

        // 17. destroy
        assert.throws(
          () => store.destroy(invalidId),
          /非法的 projectId/,
          `destroy 应阻断非法 projectId: ${String(invalidId)}`
        );

        // 18. ProposalStore APIs
        assert.throws(
          () => proposalStore.saveProposal(invalidId, { actionId: 'p1', actionType: 'TRIGGER_STAGE', label: 't', status: 'pending' }),
          /非法的 projectId/,
          `ProposalStore.saveProposal 应阻断非法 projectId: ${String(invalidId)}`
        );
        assert.throws(
          () => proposalStore.getProposal(invalidId, 'p1'),
          /非法的 projectId/,
          `ProposalStore.getProposal 应阻断非法 projectId: ${String(invalidId)}`
        );
        assert.throws(
          () => proposalStore.listProposals(invalidId),
          /非法的 projectId/,
          `ProposalStore.listProposals 应阻断非法 projectId: ${String(invalidId)}`
        );
        assert.throws(
          () => proposalStore.updateProposalStatus(invalidId, 'p1', 'executed'),
          /非法的 projectId/,
          `ProposalStore.updateProposalStatus 应阻断非法 projectId: ${String(invalidId)}`
        );
        assert.throws(
          () => proposalStore.dismissProposalsForStage(invalidId, 'narrative_design'),
          /非法的 projectId/,
          `ProposalStore.dismissProposalsForStage 应阻断非法 projectId: ${String(invalidId)}`
        );
      }
    });

    it('1.2 会话标识 sessionId 恶意投毒与非空拦截', () => {
      const invalidSessionIds = ['', '   ', null as any, undefined as any, 12345 as any, { evil: true } as any];

      for (const invalidSessId of invalidSessionIds) {
        // createSession with customSessionId
        if (invalidSessId !== undefined) {
          assert.throws(
            () => store.createSession(testValidProjectId, '测试会话', undefined, invalidSessId),
            /非法的 customSessionId/,
            `createSession 应阻断非法 customSessionId: ${String(invalidSessId)}`
          );
        }

        // getMessages
        assert.throws(
          () => store.getMessages(testValidProjectId, invalidSessId),
          /非法的 sessionId/,
          `getMessages 应阻断非法 sessionId: ${String(invalidSessId)}`
        );

        // saveMessages
        assert.throws(
          () => store.saveMessages(testValidProjectId, invalidSessId, []),
          /非法的 sessionId/,
          `saveMessages 应阻断非法 sessionId: ${String(invalidSessId)}`
        );

        // appendMessage
        assert.throws(
          () => store.appendMessage(testValidProjectId, invalidSessId, { id: 'm1', role: 'user', content: 'test', createdAt: '' }),
          /非法的 sessionId/,
          `appendMessage 应阻断非法 sessionId: ${String(invalidSessId)}`
        );

        // getSession: 包含空格的字符串触发 getChatDir 刚性阻断，空字符串或非字符串安全返回 undefined
        if (typeof invalidSessId === 'string' && invalidSessId.trim() === '' && invalidSessId.length > 0) {
          assert.throws(
            () => store.getSession(testValidProjectId, invalidSessId),
            /非法的 sessionId/,
            `getSession 应阻断纯空格 sessionId: "${invalidSessId}"`
          );
        } else {
          assert.equal(store.getSession(testValidProjectId, invalidSessId), undefined);
        }
      }
    });

    it('1.3 路径穿越攻击投毒：../../etc/passwd 与 ../secret 100% 刚性拦截抛错 (Fail-Fast)', () => {
      const traversalIds = ['../../etc/passwd', '../secret', '../../../../windows/system32/cmd.exe'];

      for (const maliciousId of traversalIds) {
        // getProjectDir 刚性阻断
        assert.throws(
          () => store.getProjectDir(maliciousId),
          /非法的 projectId/,
          `getProjectDir 应刚性阻断非法路径穿越 projectId: ${maliciousId}`
        );

        // getProject 刚性阻断
        assert.throws(
          () => store.getProject(maliciousId),
          /非法的 projectId/,
          `getProject 应刚性阻断非法路径穿越 projectId: ${maliciousId}`
        );

        // ProposalStore 路径穿越投毒刚性阻断
        assert.throws(
          () => proposalStore.saveProposal(maliciousId, {
            actionId: 'prop_malicious_test',
            actionType: 'TRIGGER_STAGE',
            label: '恶意提案',
            status: 'pending',
          }),
          /非法的 projectId/,
          `ProposalStore.saveProposal 应刚性阻断非法路径穿越 projectId: ${maliciousId}`
        );
      }
    });

    it('1.4 Windows 保留名投毒防御 (CON, PRN, AUX, NUL)：刚性阻断禁止落盘破坏文件系统 (Fail-Fast)', () => {
      const reservedNames = ['CON', 'PRN', 'AUX', 'NUL', 'con', 'prn', 'aux', 'nul', 'com1', 'lpt1'];

      for (const name of reservedNames) {
        // ProjectStore 路径解析与落盘验证全部刚性阻断
        assert.throws(
          () => store.getProjectDir(name),
          /非法的 projectId|保留设备名称/,
          `getProjectDir 应刚性阻断 Windows 保留名: ${name}`
        );

        assert.throws(
          () => store.getProject(name),
          /非法的 projectId|保留设备名称/,
          `getProject 应刚性阻断 Windows 保留名: ${name}`
        );

        assert.throws(
          () => store.saveProject({
            projectId: name,
            title: `保留名工程_${name}`,
            status: SessionStatus.IDLE,
            currentStage: WorkflowStage.NARRATIVE_DESIGN,
            stageArtifacts: {},
            history: [],
            meta: { idea: 'test', style: 'realistic', videoRatio: '16:9', videoResolution: '720P' },
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          }),
          /非法的 projectId|保留设备名称/,
          `saveProject 应刚性阻断 Windows 保留名: ${name}`
        );

        // ProposalStore 存储刚性阻断
        assert.throws(
          () => proposalStore.saveProposal(name, {
            actionId: `prop_reserved_${name}`,
            actionType: 'TRIGGER_STAGE',
            label: `保留名测试_${name}`,
            status: 'pending',
          }),
          /非法的 projectId|保留设备名称/,
          `ProposalStore.saveProposal 应刚性阻断 Windows 保留名: ${name}`
        );
      }
    });
  });

  // =========================================================================
  // 任务 2: 法典 0.4 历史别名消亡验证
  // =========================================================================
  describe('任务 2: 法典 0.4 历史别名消亡验证', () => {
    const aliasProjectId = 'test_proj_alias_eradication';

    before(() => {
      try {
        store.deleteProject(aliasProjectId);
      } catch {}
    });

    after(() => {
      try {
        store.deleteProject(aliasProjectId);
      } catch {}
    });

    it('2.1 故事圣经废弃字段 c.appearancePrompt 彻底消亡：createSession 绝不读取旧别名', () => {
      const now = new Date().toISOString();
      // 故意注入包含已废弃 c.appearancePrompt 的历史故事圣经产物，同时保持标准 appearance 为空
      store.saveProject({
        projectId: aliasProjectId,
        title: '别名消亡测试工程',
        status: SessionStatus.IDLE,
        currentStage: WorkflowStage.NARRATIVE_DESIGN,
        stageArtifacts: {
          narrative_design: {
            title: '测试圣经',
            theme: '科技探索',
            characters: [
              {
                name: '林澈',
                role: '探险家',
                motivation: '揭示星门秘密',
                // ⚠️ 历史废弃别名字段
                appearancePrompt: '银白色短发，佩戴战术护目镜，身穿深蓝宇航服',
                // 标准字段未提供
              },
            ],
          },
        },
        history: [],
        meta: { idea: 'test', style: 'realistic', videoRatio: '16:9', videoResolution: '720P' },
        createdAt: now,
        updatedAt: now,
      });

      // 调用 createSession 生成新会话人设备忘录
      const session = store.createSession(aliasProjectId, '别名消除验证会话');
      const charSummary = session.scratchpad.charactersSummary || '';

      // 断言 1：绝不包含旧别名字段内容！
      assert.ok(
        !charSummary.includes('银白色短发，佩戴战术护目镜，身穿深蓝宇航服'),
        '新会话人设备忘录绝对禁止读取已废弃别名字段 appearancePrompt'
      );

      // 断言 2：由于未提供标准 appearance 字段，骨相特征必须显示为未详
      assert.ok(
        charSummary.includes('骨相特征: 未详'),
        '未提供标准 appearance 字段时，骨相特征应优雅显示为未详，拒绝隐式降级回退'
      );

      // 补充断言：当故事圣经规范提供标准 appearance 字段时，白板精准消费标准字段
      const validProject = store.getProject(aliasProjectId)!;
      (validProject.stageArtifacts!['narrative_design'] as any).characters[0].appearance = '利落黑色短发，左额有一道浅疤';
      store.saveProject(validProject);

      const validSession = store.createSession(aliasProjectId, '标准契约会话');
      assert.ok(
        validSession.scratchpad.charactersSummary?.includes('骨相特征: 利落黑色短发，左额有一道浅疤'),
        '新会话人设备忘录必须正确继承标准契约 appearance 字段'
      );
    });

    it('2.2 ProposalStore.dismissProposalsForStage 彻底无视旧别名 targetStage', () => {
      // 注入仅包含旧别名 targetStage 而无标准 stage 属性的门禁提案
      const legacyActionId = 'gate_prop_legacy_target_stage';
      const legacyProposal: ActionProposal = {
        actionId: legacyActionId,
        actionType: 'CRITIC_DEBATE',
        isGateIntercept: true,
        label: '旧格式拦截提案',
        status: 'pending',
        payload: { targetStage: WorkflowStage.NARRATIVE_DESIGN }, // 仅包含旧别名 targetStage
      };
      proposalStore.saveProposal(aliasProjectId, legacyProposal);

      // 注入标准契约提案
      const standardActionId = 'gate_prop_standard_stage';
      const standardProposal: ActionProposal = {
        actionId: standardActionId,
        actionType: 'CRITIC_DEBATE',
        isGateIntercept: true,
        label: '标准契约拦截提案',
        status: 'pending',
        payload: { stage: WorkflowStage.NARRATIVE_DESIGN }, // 标准契约 stage
      };
      proposalStore.saveProposal(aliasProjectId, standardProposal);

      // 触发阶段门禁解除
      const dismissedCount = proposalStore.dismissProposalsForStage(
        aliasProjectId,
        WorkflowStage.NARRATIVE_DESIGN,
        '对辩通过解除'
      );

      // 断言 1：仅解除了 1 个提案（即标准契约提案）
      assert.equal(dismissedCount, 1, 'dismissProposalsForStage 必须仅解除包含标准 stage 契约的提案');

      // 断言 2：标准提案已流转为 dismissed
      const standardFetched = proposalStore.getProposal(aliasProjectId, standardActionId);
      assert.equal(standardFetched?.status, 'dismissed');

      // 断言 3：仅含旧别名 targetStage 的提案被刚性无视，仍然处于 pending
      const legacyFetched = proposalStore.getProposal(aliasProjectId, legacyActionId);
      assert.equal(
        legacyFetched?.status,
        'pending',
        '包含历史别名 targetStage 的提案必须被刚性无视，严禁被隐式解除'
      );
    });
  });

  // =========================================================================
  // 任务 3: 物理文件断网损坏自愈测试
  // =========================================================================
  describe('任务 3: 物理文件断网损坏自愈测试', () => {
    const corruptProjDir = path.join(baseProjectsDir, 'test_corrupted_proj');
    const noPidProjDir = path.join(baseProjectsDir, 'test_no_pid_proj');

    before(() => {
      // 创建物理损坏的项目文件：非法 JSON 格式
      if (!fs.existsSync(corruptProjDir)) {
        fs.mkdirSync(corruptProjDir, { recursive: true });
      }
      fs.writeFileSync(path.join(corruptProjDir, 'project.json'), '{{{ INVALID JSON FILE CONTENT - BROKEN SYNTAX &&&', 'utf-8');

      // 创建契约不匹配的项目文件：缺失合法 projectId 契约
      if (!fs.existsSync(noPidProjDir)) {
        fs.mkdirSync(noPidProjDir, { recursive: true });
      }
      fs.writeFileSync(path.join(noPidProjDir, 'project.json'), JSON.stringify({ title: '无 projectId 的非法快照' }), 'utf-8');
    });

    after(() => {
      try {
        if (fs.existsSync(corruptProjDir)) {
          fs.rmSync(corruptProjDir, { recursive: true, force: true });
        }
        if (fs.existsSync(noPidProjDir)) {
          fs.rmSync(noPidProjDir, { recursive: true, force: true });
        }
      } catch {}
    });

    it('3.1 磁盘冷启动水合 (hydrateFromDisk) 遭遇物理损坏与非法契约文件时零未捕获崩溃', () => {
      // 实例化全新的物理状态黑板，触发全量磁盘扫描与水合加载
      assert.doesNotThrow(() => {
        const freshStore = new FileProjectStateStore();
        const projects = freshStore.listProjects();
        assert.ok(Array.isArray(projects));

        // 验证损坏文件被安全跳过，未注入内存黑板
        const corruptLoaded = projects.find((p) => p.projectId === 'test_corrupted_proj');
        assert.equal(corruptLoaded, undefined, '损坏项目必须被安全跳过');

        const noPidLoaded = projects.find((p) => (p as any).title === '无 projectId 的非法快照');
        assert.equal(noPidLoaded, undefined, '缺少 projectId 契约的项目必须被安全跳过');
      }, 'hydrateFromDisk 在遭遇磁盘非法损坏文件时绝不能抛出未捕获崩溃');
    });

    it('3.2 getProject 直接读取物理损坏文件时优雅容错返回 undefined，不崩溃', () => {
      // 对已有损坏目录直接发起读取
      assert.doesNotThrow(() => {
        const res = store.getProject('test_corrupted_proj');
        assert.equal(res, undefined, '读取损坏项目应优雅捕获并返回 undefined');
      });
    });

    it('3.3 会话与消息文件物理损坏时的防御自愈与零崩溃', () => {
      // 在有效项目中伪造损坏的会话文件与消息流文件
      const validProjDir = store.getProjectDir(testValidProjectId);
      const chatDir = path.join(validProjDir, 'chat', 'broken_session_folder');
      if (!fs.existsSync(chatDir)) {
        fs.mkdirSync(chatDir, { recursive: true });
      }
      fs.writeFileSync(path.join(chatDir, 'session.json'), 'CORRUPTED SESSION CONTENT {[[', 'utf-8');
      fs.writeFileSync(path.join(chatDir, 'messages.json'), 'CORRUPTED MESSAGES CONTENT }}}}', 'utf-8');

      // 验证读取损坏会话与消息流时不崩溃并优雅返回空/默认值
      assert.doesNotThrow(() => {
        const sess = store.getSession(testValidProjectId, 'broken_session_folder');
        assert.equal(sess, undefined, '损坏的会话快照读取应优雅返回 undefined');

        const msgs = store.getMessages(testValidProjectId, 'broken_session_folder');
        assert.deepEqual(msgs, [], '损坏的消息流读取应优雅返回空数组 []');
      });

      // 清理损坏会话目录
      try {
        fs.rmSync(chatDir, { recursive: true, force: true });
      } catch {}
    });

    it('3.4 ProposalStore 提案持久化文件物理损坏时的防御与自愈', () => {
      const propDir = path.join(baseProjectsDir, 'test_corrupt_prop_proj');
      if (!fs.existsSync(propDir)) {
        fs.mkdirSync(propDir, { recursive: true });
      }
      fs.writeFileSync(path.join(propDir, 'proposals.json'), 'ILLEGAL PROPOSALS DATA ---***', 'utf-8');

      assert.doesNotThrow(() => {
        const list = proposalStore.listProposals('test_corrupt_prop_proj');
        assert.deepEqual(list, [], '损坏的 proposals.json 应优雅返回空列表');

        // 验证写入自愈能力：保存新提案应直接覆写损坏文件完成修复
        proposalStore.saveProposal('test_corrupt_prop_proj', {
          actionId: 'healed_prop_1',
          actionType: 'TRIGGER_STAGE',
          label: '自愈提案',
          status: 'pending',
        });
        const healedList = proposalStore.listProposals('test_corrupt_prop_proj');
        assert.equal(healedList.length, 1);
        assert.equal(healedList[0].actionId, 'healed_prop_1');
      });

      // 清理
      try {
        fs.rmSync(propDir, { recursive: true, force: true });
      } catch {}
    });
  });
});
