/**
 * tests/smoke-pi-game.ts
 * 真实冒烟：不走 test mock，直接驱动 Pi Agent 生成一份真实 game.html
 * 运行: npx tsx tests/smoke-pi-game.ts
 */
import path from 'path';
import fs from 'fs';
import { developWebGameWithPiAgent, validateGameHtml } from '../src/agents/text-game/pi-game-developer.js';

const workspaceDir = path.resolve('data/test_projects', `pi_smoke_${Date.now()}`);
fs.mkdirSync(workspaceDir, { recursive: true });

const gdd = `# 《深渊回响》互动文游 PRD

## 概述
赛博朋克悬疑互动小说，玩家扮演记忆侦探"凯"，潜入客户潜意识修复破损记忆。

## 节点状态机（4 节点）
- node_start：雨夜诊所，客户"银发女"请求找回丢失的 17 分钟记忆。选项：
  - A. 立即潜入 → node_memory
  - B. 先审问客户 → node_interrogate
- node_interrogate：客户言辞闪烁，透露"不要打开第三扇门"。选项：A. 追问细节 → node_memory；B. 立即潜入 → node_memory
- node_memory：记忆碎片中浮现一座燃烧的实验室与第三扇门。选项：
  - A. 推门 → node_ending_truth（真结局：发现客户即凶手）
  - B. 退出 → node_ending_escape（普通结局：收取报酬，但愧疚长存）
- node_ending_truth / node_ending_escape：结局卡，显示结语与"重新开始"按钮（回到 node_start）。

## 视觉方向
霓虹紫青配色、雨幕粒子、扫描线 UI、Ken Burns 缓动背景。

## 音频
Web Audio API 合成：低频环境嗡鸣、按钮点击 blip、结局低音收束。

## 交付要求
单文件 game.html，内嵌 style/script，实现上述状态机、分支、回滚（undo）、存档于 localStorage。
`;

console.log('=== Pi Agent 冒烟开始, 模型:', process.env.LLM_MODEL || 'qwen-plus');
const t0 = Date.now();

// 可选：传入真实项目 ID，则用其结构化 text_game.json 作为场景规格（推荐，贴近真实链路）
const projectId = process.argv[2];
let textGame: any;
if (projectId) {
  const artifactPath = path.resolve('data/projects', projectId, 'artifacts', 'text_game.json');
  textGame = JSON.parse(fs.readFileSync(artifactPath, 'utf-8'));
  console.log(`=== 加载真实场景资产: ${artifactPath} (${textGame.nodes.length} 节点)`);
}

try {
  const html = await developWebGameWithPiAgent({
    gdd,
    textGame,
    projectId: path.basename(workspaceDir),
    workspaceDir,
    onProgress: (turn, tool) => console.log(`[progress #${turn}] tool=${tool}`),
  });
  const expected = textGame?.nodes?.map((n: any) => n.id) ?? [];
  const issues = validateGameHtml(path.join(workspaceDir, 'game.html'), expected);
  console.log(`=== 交付 ${html.length} 字节, 耗时 ${Math.round((Date.now() - t0) / 1000)}s, 校验缺陷:`, issues.length ? issues : '无 ✅');
  console.log('=== 工作区:', workspaceDir);
  process.exit(issues.length === 0 ? 0 : 1);
} catch (err) {
  console.error('=== 冒烟失败:', err);
  process.exit(1);
}
