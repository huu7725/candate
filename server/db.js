import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_TIERS } from './pricing.js';
export function openDatabase(filename = process.env.DATABASE_PATH || './data/market.sqlite') {
  if (filename !== ':memory:')
    fs.mkdirSync(path.dirname(path.resolve(filename)), { recursive: true });
  const db = new Database(filename);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  db.exec(fs.readFileSync(fileURLToPath(new URL('./schema.sql', import.meta.url)), 'utf8'));
  const insert = db.prepare('INSERT OR IGNORE INTO settings (key,value) VALUES (?,?)');
  insert.run('discount_tiers', JSON.stringify(DEFAULT_TIERS));
  insert.run('shipping_fee', '25000');
  insert.run('free_shipping_threshold', '199000');
  return db;
}
