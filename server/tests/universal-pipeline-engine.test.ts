/**
 * tests/universal-pipeline-engine.test.ts
 * 楠岃瘉閫氱敤搴曞眰娴佹按绾垮紩鎿?(Pipeline SOP Engine) 涓?Agent 澹版槑寮忛『浣嶆灦鏋? */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { renderPipelineSopGuidance, formatPipelineEntityLabel } from '../src/agents/runtime/pipeline.js';
import { StoryboardAgent } from '../src/agents/storyboard/agent.js';
import { LookdevAgent } from '../src/agents/lookdev/agent.js';
import { PlannerAgent } from '../src/agents/planner/agent.js';
import { DirectorIntentResolver } from '../src/agents/runtime/intent-resolver.js';
import { AgentRunner } from '../src/agents/runtime/runner.js';
import { storyboardCapabilities } from '../src/agents/storyboard/capabilities.js';
import { plannerCapabilities } from '../src/agents/planner/capabilities.js';

describe('閫氱敤搴曞眰宸ュ簭娴佹按绾?SOP 寰唴鏍?(Universal Pipeline SOP Engine)', () => {
  it('1. StoryboardAgent 娉ㄥ叆宸ュ簭鎵ц椤哄簭涓庝弗绂侀樁娈典箣澶栨彁璁殑閫氱敤閾佸緥', () => {
    const agent = new StoryboardAgent({ projectId: 'test_p1', clipId: 'c1' });
    const mockTask: any = {
      toolName: 'film.shot_video',
      input: {
        projectId: 'test_p1',
        clipId: 'c1',
        shotId: 'c1-02',
        frame: 'first',
      },
    };

    const prompt = agent.getPostTaskPrompt(mockTask, '棣栧抚鍏抽敭甯ф覆鏌?);
    assert.match(prompt, /闀?2/);
    assert.match(prompt, /鏈伐搴忓婕旀爣鍑嗘墽琛岄『搴忥紙SOP锛?);
    assert.match(prompt, /淇敼浣滅敤鍩熺簿纭唴鑱?);
    assert.match(prompt, /浜虹被鎰忔効绗竴浣嶅噯鍒?);
    assert.match(prompt, /涓ョ闃舵涔嬪鐨勪吉鎻愯/);
    assert.match(prompt, /缁濆涓ョ灏嗏€滃鐩樷€濄€佲€滆嚜鎰堚€濄€佲€滃緟瀹＄‘璁も€濈瓑鍏冩寚浠や綔涓哄崱鐗囧彂璧?);
  });

  it('2. LookdevAgent 娉ㄥ叆 4 姝ュ畾濡嗛『搴忎笌閫氱敤鎺ㄦ紨閾佸緥', () => {
    const agent = new LookdevAgent({ projectId: 'test_p1' });
    const mockTask: any = {
      toolName: 'film.entity_spec',
      input: {
        projectId: 'test_p1',
        targetKind: 'character',
        targetId: 'char_linxiu',
        name: '鏋椾慨',
      },
    };

    const prompt = agent.getPostTaskPrompt(mockTask, '鍗曞疄浣撹瑙夎鏍兼帹婕?);
    assert.match(prompt, /鏋椾慨/);
    assert.match(prompt, /瑙嗚璧勪骇瀹氬/);
    assert.match(prompt, /淇敼浣滅敤鍩熺簿纭唴鑱?);
    assert.match(prompt, /浜虹被鎰忔効绗竴浣嶅噯鍒?);
    assert.match(prompt, /涓ョ闃舵涔嬪鐨勪吉鎻愯/);
    assert.match(prompt, /缁堟€佽嚜鐭?);
  });

  it('3. PlannerAgent 娉ㄥ叆绛栧垝涓ゆ椤哄簭涓庨€氱敤鎺ㄦ紨閾佸緥', () => {
    const agent = new PlannerAgent({ projectId: 'test_p1' });
    const mockTask: any = {
      toolName: 'planner.screenplay_writer',
      input: {
        projectId: 'test_p1',
      },
    };

    const prompt = agent.getPostTaskPrompt(mockTask, '鍏ㄦ櫙鍓ф湰鎺ㄦ紨');
    assert.match(prompt, /鍏ㄦ櫙鍓ф湰鎺ㄦ紨/);
    assert.match(prompt, /鍏ㄥ墽鍒嗗箷鎷撴墤鎷嗚В/);
    assert.match(prompt, /淇敼浣滅敤鍩熺簿纭唴鑱?);
    assert.match(prompt, /浜虹被鎰忔効绗竴浣嶅噯鍒?);
    assert.match(prompt, /涓ョ闃舵涔嬪鐨勪吉鎻愯/);
  });

  it('4. DirectorIntentResolver 鍒氭€ч槻浼棬绂侊細褰诲簳鍑€鍖栤€滃鐩?鑷剤鈥濅吉鏍囬', () => {
    const specs = storyboardCapabilities('c1');
    const resolved = DirectorIntentResolver.resolve({
      args: {
        action: 'propose',
        tool: 'film.shot_video',
        title: '闀?2宸插畬鎴?路 澶嶇洏涓庤嚜鎰堟彁妗?,
        params: {
          shotId: 'c1-02',
          frame: 'first',
        },
      },
      projectId: 'test_p1',
      specs,
      clipId: 'c1',
    });

    assert.ok(resolved);
    assert.strictEqual(resolved.action, 'propose');
    assert.strictEqual(resolved.title, '闀?2 路 棣栧抚鍏抽敭甯ф覆鏌?);
    assert.doesNotMatch(resolved.title, /澶嶇洏/);
    assert.doesNotMatch(resolved.title, /鑷剤/);
  });

  it('5. AgentRunner 鎰忓浘婕忔枟涓?P0 鍘嬭酱缃簳楠岃瘉', () => {
    const funnel = AgentRunner.renderFunnelPromptMatrix();
    assert.match(funnel, /鏈€楂樹紭鍏堢骇 P0 路 寰呭鎻愭瑁佸喅/);
    assert.match(funnel, /淇敼浣滅敤鍩熺簿纭唴鑱氬叕鐞?);
    assert.match(funnel, /鍏ㄥ眬鍗曢樁娈垫帹杩涗笌浜虹被鎰忓織绗竴浣嶅噯鍒?);
    assert.match(funnel, /涓ョ闃舵涔嬪鐨勪吉鎻愯/);
    assert.match(funnel, /宸ュ簭鑷不銆佹潈鑳借竟鐣屼笌缁堟€佽嚜鐭ュ叕鐞?);
  });
});
