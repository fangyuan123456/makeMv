import pc from 'picocolors';
import { orchestrator } from './orchestrator/orchestrator.js';
import { WorkflowStage, SessionStatus } from './types/workflow.js';

async function main() {
  console.log(pc.bold(pc.cyan('\n==============================================')));
  console.log(pc.bold(pc.cyan('   🎬 FMV-Agent TypeScript AI Director CLI   ')));
  console.log(pc.bold(pc.cyan('==============================================\n')));

  const idea = '在暴风雨之夜，侦探沈墨与宿敌在废弃码头货柜前对决，发现多年前案件的惊天秘密。';
  console.log(pc.yellow(`[1/6] 创建项目: "逆转之夜 (Night of Reversal)"`));
  console.log(pc.gray(`故事灵感: ${idea}\n`));

  const session = orchestrator.createProject('逆转之夜', {
    idea,
    style: '电影质感，冷调暗黑，高对比度光影',
    videoRatio: '16:9',
    videoResolution: '720P',
    isInteractiveFMV: true,
  });

  console.log(pc.green(`✔ 项目已创建，ID: ${session.id}`));

  let current = session;

  while (current.status !== SessionStatus.COMPLETED && current.status !== SessionStatus.FAILED) {
    console.log(pc.magenta(`\n▶ 推进工作流阶段 -> [${current.currentStage}] ...`));
    current = await orchestrator.continue(current.id);

    if (current.currentStopPoint) {
      console.log(pc.bold(pc.green(`\n🛑 命中暂停点 [${current.currentStopPoint.title}]`)));
      console.log(pc.white(`   ${current.currentStopPoint.description}`));
    }
  }

  if (current.status === SessionStatus.COMPLETED) {
    console.log(pc.bold(pc.green('\n🎉 全流程 7 阶段流水线执行完毕！')));
    const finalArtifact = current.stageArtifacts[WorkflowStage.FMV_PACKAGING] || current.stageArtifacts[WorkflowStage.VIDEO_PRODUCTION];
    console.log(pc.cyan(`\n成片输出文件: ${finalArtifact?.outputVideoPath}`));
    console.log(pc.cyan(`成片总时长: ${finalArtifact?.totalDuration} 秒`));
    console.log(pc.cyan(`时间线及交互分支配置: ${finalArtifact?.timelineJsonPath}\n`));
  } else {
    console.log(pc.red(`\n❌ 工作流失败: ${current.status}`));
  }
}

main().catch((err) => {
  console.error(pc.red(`\n[CLI Error] ${err.stack || err.message}`));
  process.exit(1);
});
