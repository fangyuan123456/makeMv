/**
 * agents/text-game/artifact-writer.ts
 * 阶段二产物落盘：按「阶段/工序」编号写 .debug 全量 md 与外层交付文档。
 *
 * 运行时数据（scenes/*.json、text-game/*、assets/*）仍由各工序按原路径写出，
 * 它们被 SceneLoader / 前端 iframe / 媒体 URL 硬引用，不在此收编。
 */

import {
  STAGE,
  TEXT_GAME_STEP,
  writeArtifactFile,
  renderArtifactMarkdown,
} from '../../project-store/artifact-fs.js';

/** 把一幕切片渲染成可直接拿去生图 / 生成视频的剧本文档 */
export function renderSceneMarkdown(scene: any): string {
  const s = scene || {};
  const anchor = s.visualAnchor || {};
  const play = s.screenplay || {};
  const interaction = s.interaction || {};
  const dialogues = Array.isArray(play.dialogues) ? play.dialogues : [];
  const choices = Array.isArray(interaction.choices) ? interaction.choices : [];
  const entities = Array.isArray(s.entityIds) ? s.entityIds : [];

  const lines: string[] = [
    `# 第 ${s.level ?? '?'} 幕 · ${s.title || s.sceneId || '未命名'}`,
    '',
    `> 切片 ID：${s.sceneId || '-'}　｜　目标视频：${s.targetVideoClipName || '-'}　｜　预估时长：${s.estimatedDurationSeconds ?? '-'} 秒`,
    '',
    '## 剧本正文',
    '',
    play.storyContext || '（无）',
    '',
    '## 对白',
    '',
    ...(dialogues.length
      ? dialogues.map((d: any) => `- 【${d.speaker || '角色'}】${d.line || ''}${d.emotion ? `（${d.emotion}）` : ''}`)
      : ['（无对白）']),
    '',
    '## 视频动作',
    '',
    play.videoActionDescription || '（无）',
    '',
    '## 尾帧视觉母本（统一单张成图）',
    '',
    `- **尾帧定格画面**：${anchor.endFrameMoment || '-'}`,
    `- **机位**：${anchor.cameraAngle || '-'}`,
    `- **光线**：${anchor.lighting || '-'}`,
    `- **中文尾帧提示词**：${anchor.promptZh || '-'}`,
    `- **英文尾帧提示词**：${anchor.promptEn || '-'}`,
    ...(anchor.assembledPrompt ? [`- **多定妆融合生图词**：\n\`\`\`\n${anchor.assembledPrompt}\n\`\`\``] : []),
    `- **尾帧场景图**：${anchor.sceneImageUrl || anchor.sceneImagePath || '-'}`,
    `- **尾帧出场实体**：${entities.length ? entities.join('、') : '无'}`,
    '',
    '## 互动与去向',
    '',
    ...(choices.length
      ? choices.map((c: any) => `- **${c.text || c.choiceId}** → \`${c.nextSceneJson || '未指定'}\``)
      : ['（本幕无选择）']),
    `- **是否结局**：${interaction.isEnding ? '是' : '否'}`,
  ];

  if (interaction.isEnding) {
    lines.push(
      `- **结局类型**：${interaction.endingType || '-'}`,
      `- **结局标题**：${interaction.endingTitle || '-'}`,
      `- **判词**：${interaction.verdict || '-'}`
    );
    if (interaction.rewindTargetScene) {
      lines.push(`- **回溯目标**：\`${interaction.rewindTargetScene}\``);
    }
  }

  return `${lines.join('\n')}\n`;
}

/** 从 Mastra workflow 的 results 中收集各工序产物并落盘 */
export function persistTextGameArtifacts(
  projectId: string,
  title: string,
  results: Record<string, any>
): void {
  const writeDebug = (step: string, file: string, heading: string, value: unknown) =>
    writeArtifactFile(
      projectId,
      'debug',
      STAGE.textGame,
      step,
      file,
      renderArtifactMarkdown(heading, value)
    );

  const out = (stepId: string) => (results[stepId] as any)?.output;

  const imageGen = out('image-gen-pool-step');
  const entities = imageGen?.entities || out('entity-extract-step');
  const scenePackaging = out('scene-packaging-step');
  const scenes: any[] = imageGen?.scenes || scenePackaging?.scenes || [];

  writeDebug(TEXT_GAME_STEP.entities, 'entities.md', `《${title}》人物与道具字典`, entities || {});
  // 工序级索引：正文已按幕拆成 S1.md / S1.1.md 等，这里只留清单，不重复铺一遍剧本
  writeDebug(TEXT_GAME_STEP.scenes, 'scenes.md', `《${title}》分幕打包`, {
    summary: scenePackaging?.summary || '',
    totalScenes: scenes.length,
    scenes: scenes.map((s: any) => ({
      sceneId: s.sceneId,
      level: s.level,
      title: s.title,
      isEnding: Boolean(s.interaction?.isEnding),
    })),
  });
  writeDebug(TEXT_GAME_STEP.images, 'image_gen_pool.md', `《${title}》视觉资产生成报告`, {
    totalScenes: imageGen?.totalScenes ?? 0,
    renderedCount: imageGen?.renderedCount ?? 0,
    skippedCount: imageGen?.skippedCount ?? 0,
    failedCount: imageGen?.failedCount ?? 0,
  });
  writeDebug(TEXT_GAME_STEP.techPlan, 'tech_plan.md', `《${title}》技术架构方案`, out('tech-plan-step') || {});
  writeDebug(TEXT_GAME_STEP.codegen, 'generated_files.md', `《${title}》源码生成清单`, out('codegen-step') || {});
  writeDebug(TEXT_GAME_STEP.bundler, 'text_game_manifest.md', `《${title}》可玩产物清单`, out('bundler-step') || {});

  // 每幕剧本文档是给生图 / 视频用的交付物：.debug 留镜像，外层留真实形态
  for (const scene of scenes) {
    if (!scene?.sceneId) continue;
    const filename = `${scene.sceneId}.md`;
    const content = renderSceneMarkdown(scene);
    writeArtifactFile(projectId, 'debug', STAGE.textGame, TEXT_GAME_STEP.scenes, filename, content);
    writeArtifactFile(projectId, 'delivery', STAGE.textGame, TEXT_GAME_STEP.scenes, filename, content);
  }
}
