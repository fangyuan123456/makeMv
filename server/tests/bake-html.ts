import fs from 'fs';
import path from 'path';
import { StandaloneHtmlGameRenderer } from '../src/media/html/StandaloneHtmlGameRenderer.js';

const baseDir = path.resolve('server/data/projects/proj_deep_echo/artifacts');
const textGame = JSON.parse(fs.readFileSync(path.join(baseDir, 'text_game_generated.json'), 'utf-8'));
const gdd = JSON.parse(fs.readFileSync(path.join(baseDir, 'gdd.json'), 'utf-8'));

const html = StandaloneHtmlGameRenderer.render(textGame, gdd);
const htmlPath = path.join(baseDir, 'game.html');
fs.writeFileSync(htmlPath, html, 'utf-8');
console.log(`🎮 单文件独立可玩 HTML 网页游戏烘焙成功！`);
console.log(`📂 文件绝对路径: ${htmlPath}`);
console.log(`📊 包含场景节点: ${textGame.nodes.length} 个, 起始节点: ${textGame.startNodeId}`);
