import { Hono } from 'hono';
import fs from 'fs';
import path from 'path';
import { config } from '../../config/index.js';

export const mediaRoutes = new Hono();

// 静态文件 MIME 类型辅助映射
const getMimeType = (filePath: string) => {
  const ext = path.extname(filePath).toLowerCase();
  const map: Record<string, string> = {
    '.mp4': 'video/mp4',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.json': 'application/json',
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.md': 'text/markdown; charset=utf-8',
    '.txt': 'text/plain; charset=utf-8',
  };
  return map[ext] || 'application/octet-stream';
};

// 提供生成媒体与项目静态文件访问（支持嵌套通配符路由）
// 支持 /media/:projectId/videos/clip.mp4 以及 /media/:projectId/fmv/loops/loop_1.mp4 等嵌套路径
mediaRoutes.get('/media/:projectId/*', async (c) => {
  const projectId = c.req.param('projectId');
  const prefix = `/media/${projectId}/`;
  const relativePath = decodeURIComponent(c.req.path.substring(prefix.length));

  const projectRoot = path.resolve(config.paths.projects, projectId);
  const targetPath = path.resolve(projectRoot, relativePath);

  // 安全防护：防止路径穿越逃逸到项目目录之外
  if (!targetPath.startsWith(projectRoot)) {
    return c.notFound();
  }

  // 禁止通过公开媒体路由访问内部 .agent_debug 审计目录
  if (relativePath.startsWith('.agent_debug') || relativePath.includes('/.agent_debug')) {
    return c.notFound();
  }

  if (!fs.existsSync(targetPath) || fs.statSync(targetPath).isDirectory()) {
    return c.notFound();
  }

  const bytes = fs.readFileSync(targetPath);
  return c.body(bytes, 200, { 'Content-Type': getMimeType(targetPath) });
});

// 提供 data 资产目录访问 (/data/projects/..., /data/uploads/...)
mediaRoutes.get('/data/*', async (c) => {
  const subPath = c.req.path.replace(/^\/data\//, '');
  const dataRoot = path.resolve(config.paths.data);
  const filePath = path.resolve(dataRoot, decodeURIComponent(subPath));

  if (!filePath.startsWith(dataRoot)) {
    return c.notFound();
  }

  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    return c.notFound();
  }
  const bytes = fs.readFileSync(filePath);
  return c.body(bytes, 200, { 'Content-Type': getMimeType(filePath) });
});

// 本地媒体文件上传接口
mediaRoutes.post('/api/upload_media', async (c) => {
  try {
    const body = await c.req.parseBody();
    const file = body['file'];
    if (!file || typeof file === 'string') {
      return c.json({ error: 'No file uploaded' }, 400);
    }
    const uploadsDir = path.join(config.paths.data, 'uploads');
    fs.mkdirSync(uploadsDir, { recursive: true });
    const filename = `${Date.now()}_${(file as File).name}`;
    const destPath = path.join(uploadsDir, filename);
    const arrayBuffer = await (file as File).arrayBuffer();
    fs.writeFileSync(destPath, Buffer.from(arrayBuffer));
    const relPath = `/data/uploads/${filename}`;
    return c.json({ filename, file_path: relPath });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});
