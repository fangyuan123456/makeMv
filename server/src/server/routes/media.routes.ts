import { Hono } from 'hono';
import fs from 'fs';
import path from 'path';
import { config } from '../../config/index.js';

export const mediaRoutes = new Hono();

// Static MIME types helper
const getMimeType = (filePath: string) => {
  const ext = path.extname(filePath).toLowerCase();
  const map: Record<string, string> = {
    '.mp4': 'video/mp4',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.json': 'application/json',
  };
  return map[ext] || 'application/octet-stream';
};

// Serve generated media & project files
mediaRoutes.get('/media/:projectId/:type/:filename', async (c) => {
  const { projectId, type, filename } = c.req.param();
  const filePath = path.join(config.paths.projects, projectId, type, filename);
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    return c.notFound();
  }
  const bytes = fs.readFileSync(filePath);
  return c.body(bytes, 200, { 'Content-Type': getMimeType(filePath) });
});

// Serve data folder (/data/projects/..., /data/uploads/...)
mediaRoutes.get('/data/*', async (c) => {
  const subPath = c.req.path.replace(/^\/data\//, '');
  const filePath = path.join(config.paths.data, subPath);
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    return c.notFound();
  }
  const bytes = fs.readFileSync(filePath);
  return c.body(bytes, 200, { 'Content-Type': getMimeType(filePath) });
});

// Media upload endpoint
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
