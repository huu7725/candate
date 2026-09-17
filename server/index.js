import './env.js';
import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { openDatabase } from './db.js';
import { createApp } from './app.js';
import { bootstrapDatabase } from './bootstrap.js';
const dist = fileURLToPath(new URL('../dist', import.meta.url));
if (process.env.NODE_ENV === 'production' && !fs.existsSync(path.join(dist, 'index.html'))) {
  throw new Error('Chưa có frontend build. Chạy npm run build trước npm start.');
}
const db = openDatabase();
try {
  const result = await bootstrapDatabase(db);
  if (result.created) console.log('Đã khởi tạo Admin và danh mục trên database của dịch vụ.');
} catch (error) {
  db.close();
  throw error;
}
const app = createApp(db);
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get('*', (req, res) => res.sendFile(path.join(dist, 'index.html')));
}
const host = process.env.HOST || (process.env.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1');
const server = app.listen(Number(process.env.PORT || 3001), host, () =>
  console.log(`Cận API: http://${host}:${server.address().port}`)
);
function shutdown() {
  server.close(() => {
    db.close();
    process.exit(0);
  });
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
