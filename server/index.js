import './env.js';
import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { openDatabase } from './db.js';
import { createApp } from './app.js';
const db = openDatabase();
const app = createApp(db);
const dist = fileURLToPath(new URL('../dist', import.meta.url));
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get('*', (req, res) => res.sendFile(path.join(dist, 'index.html')));
}
const server = app.listen(Number(process.env.PORT || 3001), process.env.HOST || '127.0.0.1', () =>
  console.log(`Cận API: http://${process.env.HOST || '127.0.0.1'}:${process.env.PORT || 3001}`)
);
function shutdown() {
  server.close(() => {
    db.close();
    process.exit(0);
  });
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
