import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { asyncPool } from '../../utils/concurrency.js';

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

  it('海量大批次 (60 项) 调度：所有项准确收敛且保持顺序', async () => {
    const items = Array.from({ length: 60 }, (_, i) => `item_${i}`);
    let completedCallbackCount = 0;

    const results = await asyncPool(
      5,
      items,
      async (item, idx) => {
        return { item, idx, square: idx * idx };
      },
      (completed, total) => {
        completedCallbackCount++;
        assert.equal(total, 60);
      }
    );

    assert.equal(results.length, 60);
    assert.equal(completedCallbackCount, 60);
    assert.equal(results[0].item, 'item_0');
    assert.equal(results[59].item, 'item_59');
    assert.equal(results[59].square, 59 * 59);
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

    // 短路拦截：由于并发为 2，第 2 项失败后，后续项（如第 10~19 项）绝不应被全部派发
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

  it('AbortSignal 运行时取消：执行过程中触发 abort 时立即中断后续调度', async () => {
    const ac = new AbortController();
    const items = Array.from({ length: 30 }, (_, i) => i);
    let runCount = 0;

    await assert.rejects(
      async () => {
        await asyncPool(
          2,
          items,
          async (item) => {
            runCount++;
            if (item === 3) {
              ac.abort();
            }
            await new Promise((r) => setTimeout(r, 10));
            return item;
          },
          undefined,
          ac.signal
        );
      },
      /已被中断取消/
    );

    assert.ok(runCount < 30, `中断防御生效，实际执行项 [${runCount}] 应小于 30`);
  });
});
