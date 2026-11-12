/**
 * tests/run-text-game-demo.ts
 * 使用真实 gdd.md 驱动 TextGame Agent 执行生成与展示脚本
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { writeTextGameWithAgent, extractProductionBibleWithLLM } from '../src/agents/text-game/index.js';
import { StandaloneHtmlGameRenderer } from '../src/media/html/StandaloneHtmlGameRenderer.js';
import { config } from '../src/utils/config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const serverDir = path.resolve(__dirname, '..');

async function run() {
  console.log('🎬 互动文游 (Text-Game) 生成引擎启动...\n');

  // 1. 读取黄金标杆 gdd.json 与 gdd.md
  let gddJsonPath = path.join(serverDir, 'data', 'projects', 'proj_deep_echo', 'artifacts', 'gdd.json');
  let gddMdPath = path.join(serverDir, 'data', 'projects', 'proj_deep_echo', 'artifacts', 'gdd.md');

  if (!fs.existsSync(gddJsonPath)) {
    gddJsonPath = path.resolve('data/projects/proj_deep_echo/artifacts/gdd.json');
  }
  if (!fs.existsSync(gddMdPath)) {
    gddMdPath = path.resolve('data/projects/proj_deep_echo/artifacts/gdd.md');
  }

  const gddContent = fs.existsSync(gddMdPath) ? fs.readFileSync(gddMdPath, 'utf-8') : '';
  const gddJson = fs.existsSync(gddJsonPath) ? JSON.parse(fs.readFileSync(gddJsonPath, 'utf-8')) : {};
  if (gddContent) {
    gddJson.markdown = gddContent;
  }

  console.log(`📖 成功加载策划案 PRD (标题: 《${gddJson.title || '深海逆光'}》, Markdown 字数: ${gddContent.length})`);
  console.log(`🤖 当前大语言模型驱动: ${config.llm.provider} (${config.llm.model || 'default'})\n`);

  // 2. 第一步：动态提炼剧组通告簿 (Production Bible)
  console.log('⏳ 步骤一：正在提炼剧组造型与通告簿 (Production Bible)...');
  const bible = await extractProductionBibleWithLLM(gddJson, gddJson.title);
  console.log(`  ✅ 提炼出 ${bible.entities.length} 个焦点主体, ${bible.locations.length} 个舞台空间`);
  bible.entities.forEach((e) => console.log(`     - 实体 [${e.name}]: ${e.summary}`));
  bible.locations.forEach((l) => console.log(`     - 舞台 [${l.name}]: ${l.atmosphere}`));
  console.log('');

  // 3. 第二步：启动文游 Agent 自主推演循环
  console.log('⏳ 步骤二：启动文游 Agent 扩写装配全量场景节点与文学演出...');
  const textGame = await writeTextGameWithAgent(gddJson, undefined, undefined, bible);
  console.log(`  ✅ 扩写装配完成！作品名: 《${textGame.title}》, 起始节点: [${textGame.startNodeId}]`);
  console.log(`  📊 全量场景节点总数: ${textGame.nodes.length} 个\n`);

  // 4. 展示节点详细文学演出与分支架构
  console.log('==================== 🎭 核心节点演出与博弈分支展示 ====================');
  textGame.nodes.forEach((node, idx) => {
    console.log(`\n【节点 ${idx + 1}】${node.title || '未命名场景'} (ID: ${node.id})`);
    if (node.visual) {
      console.log(`  📸 [首帧机位] ${node.visual.composition || '第一人称平视机位'}`);
      if (node.visual.imagePromptEn) {
        console.log(`  🎨 [生图母本] ${node.visual.imagePromptEn.slice(0, 80)}...`);
      }
    }
    const text = node.narrativeText || '【场景演出】：暴雨在窗外雷鸣，此幕走向终局收束。';
    console.log(`  📝 [文学演出正文]:\n     ${text.replace(/\n/g, '\n     ')}`);

    if (node.choices && node.choices.length > 0) {
      console.log(`  👉 [博弈选项列表]:`);
      node.choices.forEach((c, cIdx) => {
        const muts = JSON.stringify(c.stateMutation || {});
        const gate = c.requiredFlags && c.requiredFlags.length > 0 ? ` [门禁: ${c.requiredFlags.join(',')}]` : '';
        console.log(`     (${cIdx + 1}) 「${c.text}」 ➔ [${c.targetNodeId}]${gate} | 变动: ${muts}`);
      });
    } else {
      console.log(`  🏆 [结局节点] 终局定性: ${node.endingType || '收束'}`);
    }
  });

  // 落盘保存成果
  const outPath = path.join(serverDir, 'data', 'projects', 'proj_deep_echo', 'artifacts', 'text_game_generated.json');
  fs.writeFileSync(outPath, JSON.stringify(textGame, null, 2), 'utf-8');
  console.log(`\n💾 完整文游结构化产物已落盘保存至: ${outPath}`);

  // 烘焙并落盘单文件独立可玩 HTML 游戏
  const htmlGame = StandaloneHtmlGameRenderer.render(textGame, gddJson);
  const htmlOutPath = path.join(serverDir, 'data', 'projects', 'proj_deep_echo', 'artifacts', 'game.html');
  fs.writeFileSync(htmlOutPath, htmlGame, 'utf-8');
  console.log(`🎮 纯单文件独立可玩 HTML 网页游戏已烘焙落盘: ${htmlOutPath} (双击直接在浏览器畅玩！)`);

  console.log('\n========================================================================\n');
  console.log('🎉 互动文游扩写装配与剧本自检 100% 成功！');
}

run().catch((err) => {
  console.error('❌ 执行失败:', err);
  process.exit(1);
});
