import assert from 'node:assert/strict';
import fs from 'node:fs';
import { ProjectStore } from '../src/project-store/ProjectStore.js';
import {
  computeReviewArtifactHash,
  markReviewRunning,
  saveReviewResult,
  getReviewWithFreshness,
} from '../src/tools/review/shared/review-store.js';
import { buildScreenplayReviewerSystemPrompt } from '../src/tools/review/screenplay-review/prompt.js';

async function runScreenplayReviewTests() {
  console.log('🧪 开始测试剧本质量审查 1:1 存档与新鲜度机制...');

  const store = ProjectStore.getInstance();
  const projectId = `test_review_${Date.now()}`;
  store.getProject(projectId);

  try {
    const scriptV1 = '## 第 1 幕《测试》\n【场景：实验室】\n[林深]：“把芯片交出来。”';
    const hashV1 = computeReviewArtifactHash(scriptV1);
    assert.ok(hashV1.length === 16, '指纹长度为 16 位十六进制');

    // 1. 未审查前为 idle，且有正文时 isStale = true
    const idleView = getReviewWithFreshness(projectId, 'screenplay', scriptV1);
    assert.equal(idleView.status, 'idle');
    assert.equal(idleView.isStale, true);

    // 2. 标记审查中
    markReviewRunning(projectId, 'screenplay', scriptV1);
    const runningView = getReviewWithFreshness(projectId, 'screenplay', scriptV1);
    assert.equal(runningView.status, 'reviewing');
    assert.equal(runningView.isStale, false);

    // 3. 保存审查报告 (1:1 存档)
    saveReviewResult(projectId, 'screenplay', hashV1, scriptV1, {
      passed: false,
      summary: '发现 1 处微观文字依赖',
      issues: [
        {
          id: 'issue_1',
          severity: 'warning',
          category: 'AI 视频可生成性',
          actNumber: 1,
          excerpt: '屏幕显示47%',
          reason: 'AI 视频模型难以稳定渲染精确百分比数字',
          fixInstruction: '将屏幕显示47%改为指示灯由蓝转红闪烁',
        },
      ],
    });

    const savedView = getReviewWithFreshness(projectId, 'screenplay', scriptV1);
    assert.equal(savedView.status, 'issues_found');
    assert.equal(savedView.isStale, false);
    assert.equal(savedView.artifactHash, hashV1);
    assert.equal(savedView.artifactSnapshot, scriptV1);
    assert.equal(savedView.report?.issues.length, 1);
    console.log('  ✅ 1:1 存档与状态读取验证通过');

    // 4. 剧本正文发生变化 -> 自动标为 isStale = true（待重审）
    const scriptV2 = '## 第 1 幕《测试》\n【场景：实验室】\n[林深]：“把芯片交出来，快！”';
    const staleView = getReviewWithFreshness(projectId, 'screenplay', scriptV2);
    assert.equal(staleView.status, 'issues_found');
    assert.equal(staleView.isStale, true, '剧本变更后必须自动标脏待重审');
    console.log('  ✅ 产物变更自动标脏 (isStale) 验证通过');

    // 5. 防过时写回覆盖测试：V2 已进入 reviewing，V1 的晚到结果不能覆盖 V2
    const hashV2 = computeReviewArtifactHash(scriptV2);
    markReviewRunning(projectId, 'screenplay', scriptV2);
    const lateSave = saveReviewResult(projectId, 'screenplay', hashV1, scriptV1, {
      passed: true,
      summary: '旧版本延迟结果',
      issues: [],
    });
    assert.equal(lateSave, null, '旧指纹结果禁止覆盖新指纹状态');
    const v2Running = getReviewWithFreshness(projectId, 'screenplay', scriptV2);
    assert.equal(v2Running.status, 'reviewing');
    assert.equal(v2Running.artifactHash, hashV2);
    console.log('  ✅ 并发防乱序覆盖保护验证通过');

    // 6. 验证审查员提示词正确注入 ai-interactive-screenplay 规范
    const sysPrompt = buildScreenplayReviewerSystemPrompt();
    assert.ok(sysPrompt.includes('ai-interactive-screenplay') || sysPrompt.includes('抉择即命运'));
    console.log('  ✅ 审查员技能规范注入验证通过');

    console.log('\n🎉 剧本质量审查与 1:1 存档机制全部验证通过！');
  } finally {
    const projectDir = store.getProjectDir(projectId);
    if (fs.existsSync(projectDir)) {
      fs.rmSync(projectDir, { recursive: true, force: true });
    }
  }
}

runScreenplayReviewTests().catch((err) => {
  console.error('❌ 测试失败:', err);
  process.exit(1);
});
