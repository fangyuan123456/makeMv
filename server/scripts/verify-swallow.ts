/**
 * scripts/verify-swallow.ts
 * 验证 Mastra run.start 步骤失败时不抛异常、WorkflowItem.execute 吞掉失败的 bug。
 * 运行：cd server && npx tsx scripts/verify-swallow.ts
 */
import { z } from 'zod';
import { Workflow } from '../src/workflow-engine/index.js';

const InnerSchema = z.object({ projectId: z.string(), lastSummary: z.string().optional(), toolResult: z.any().optional() });

async function main() {
  const boomWf = Workflow.create({
    id: `test-boom-${Date.now()}`,
    description: '第二步必炸的测试工作流',
    inputSchema: InnerSchema,
    outputSchema: InnerSchema,
    steps: [
      {
        step: {
          id: 'ok-step',
          description: '正常步',
          inputSchema: InnerSchema,
          outputSchema: InnerSchema,
          execute: async ({ inputData }: any) => ({ ...inputData, lastSummary: '第一步完成' }),
        },
        weight: 50,
        name: '正常步',
      },
      {
        step: {
          id: 'boom-step',
          description: '必炸步',
          inputSchema: InnerSchema,
          outputSchema: InnerSchema,
          execute: async (): Promise<any> => {
            throw new Error('【模拟失败】setArtifact: 未找到项目');
          },
        },
        weight: 50,
        name: '必炸步',
      },
    ],
  });

  const output = await (boomWf as any).execute({ inputData: { projectId: 'test_x' } });
  console.log('== execute 返回值诊断 ==');
  console.log('keys:', Object.keys(output || {}));
  console.log('status:', (output as any)?.status);
  console.log('error:', JSON.stringify((output as any)?.error, null, 2)?.slice(0, 800));
  console.log('lastSummary:', (output as any)?.lastSummary);
  console.log('\n结论:', (output as any)?.status === 'failed'
    ? '❌ 确认 bug：步骤失败被静默吞掉，execute 正常返回无 lastSummary 的对象，底座会误标"执行成功"'
    : '✅ 异常正常抛出');
  process.exit(0);
}

main().catch((e) => {
  console.log('== execute 抛出了异常 ==');
  console.log('message:', e?.message);
  console.log('✅ 异常正常抛出（底座 catch 后会正确标记提案失败）');
  process.exit(0);
});
