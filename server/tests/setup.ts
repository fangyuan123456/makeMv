/**
 * __tests__/setup.ts
 * 全局测试环境引导与沙箱强制隔离 (SSOT)
 */
import fs from 'fs';
import path from 'path';
import { registerDirectorWorkflows } from '../src/agents/director/workflows/index.js';

// 刚性设置测试环境变量，确保所有配置与存储路由至沙箱
process.env.NODE_ENV = 'test';

// 引导注册总导演影视工序状态机 (微内核 IoC 装配)
registerDirectorWorkflows();

// 确保测试工程根目录存在
const testProjectsDir = path.resolve(process.cwd(), 'data', 'test_projects');
if (!fs.existsSync(testProjectsDir)) {
  fs.mkdirSync(testProjectsDir, { recursive: true });
}
