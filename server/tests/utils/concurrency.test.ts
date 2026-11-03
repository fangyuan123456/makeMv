import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { asyncPool, asyncPoolSettled } from '../../src/utils/concurrency.js';

describe('asyncPool 异步并发池控制', () => {
  it('严格限制最大并发数：并发数不超过指定上限', async () => {
    let currentActive = 0;
    let maxActive = 0;
    const items = Array.from({ length: 20 }, (_, i) => i);

    const results = await asyncPool(3, items, async (item) => {
      currentActive++;
      maxActive = Math.max(maxActive, currentActive);
      await new Promise((r) => setTimeout(r, 10));
      currentActive--;
      return item * 2;
    });

    assert.equal(maxActive, 3, '并发数必须受控且不超过 3');
    assert.equal(results.length, 20);
    for (let i = 0; i < 20; i++) {
      assert.equal(results[i], i * 2, '返回结果必须严格保持输入原始索引顺序');
    }
  });

  it('空输入处理：传入空数组时立即返回空数组', async () => {
    const results = await asyncPool(5, [], async (x) => x);
    assert.deepEqual(results, []);
  });

  it('异常快速短路：当任一子任务失败时，阻止后续新任务派发并抛出异常', async () => {
    const items = Array.from({ length: 20 }, (_, i) => i);
    let executedCount = 0;

    await assert.rejects(
      async () => {
        await asyncPool(2, items, async (item) => {
          executedCount++;
          if (item === 2) {
            throw new Error('模拟第 2 项计算异常');
          }
          await new Promise((r) => setTimeout(r, 15));
          return item;
        });
      },
      /模拟第 2 项计算异常/
    );

    assert.ok(executedCount < 20, `短路防御生效，已执行任务数 [${executedCount}] 必须远小于总数 20`);
  });

  it('AbortSignal 提前取消：若信号已处于 aborted 状态，立即拒绝并不执行任何子任务', async () => {
    const ac = new AbortController();
    ac.abort();

    let executed = false;
    await assert.rejects(
      async () => {
        await asyncPool(
          3,
          [1, 2, 3],
          async (x) => {
            executed = true;
            return x;
          },
          undefined,
          ac.signal
        );
      },
      /异步并发任务已被提前取消/
    );

    assert.equal(executed, false, '已取消时不应执行任何子任务');
  });

  it('asyncPoolSettled 容错并发池保全部分成功项', async () => {
    const items = [1, 2, 3, 4];
    const results = await asyncPoolSettled(2, items, async (item) => {
      if (item === 2) throw new Error('第 2 项失败');
      return item * 10;
    });

    assert.equal(results.length, 4);
    assert.equal(results[0].status, 'fulfilled');
    assert.equal(results[0].value, 10);
    assert.equal(results[1].status, 'rejected');
    assert.equal(results[2].status, 'fulfilled');
    assert.equal(results[2].value, 30);
  });
});
