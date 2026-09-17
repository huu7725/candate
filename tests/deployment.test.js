import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openDatabase } from '../server/db.js';
import { bootstrapDatabase } from '../server/bootstrap.js';
import { verifyPassword } from '../server/auth.js';
import { createApp } from '../server/app.js';

const adminEnv = {
  NODE_ENV: 'production',
  ADMIN_EMAIL: 'owner@example.test',
  ADMIN_PASSWORD: 'PrivateTestPassword2026!',
};

test('first production start creates a private admin and categories without demo accounts', async () => {
  const db = openDatabase(':memory:');
  try {
    const result = await bootstrapDatabase(db, adminEnv);
    assert.equal(result.created, true);
    const users = db.prepare('SELECT * FROM users').all();
    assert.equal(users.length, 1);
    assert.equal(users[0].role, 'admin');
    assert.equal(users[0].email, adminEnv.ADMIN_EMAIL);
    assert.notEqual(users[0].password_hash, adminEnv.ADMIN_PASSWORD);
    assert.equal(await verifyPassword(adminEnv.ADMIN_PASSWORD, users[0].password_hash), true);
    assert.equal(await verifyPassword('CanDate2026!', users[0].password_hash), false);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM categories').get().n, 4);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM products').get().n, 0);
  } finally {
    db.close();
  }
});

test('production refuses absent or invalid bootstrap credentials without partial writes', async () => {
  for (const env of [
    { NODE_ENV: 'production' },
    { ...adminEnv, ADMIN_EMAIL: 'not-an-email' },
    { ...adminEnv, ADMIN_PASSWORD: 'short' },
    { ...adminEnv, ADMIN_NAME: 'x' },
  ]) {
    const db = openDatabase(':memory:');
    try {
      await assert.rejects(bootstrapDatabase(db, env), /ADMIN_EMAIL/);
      assert.equal(db.prepare('SELECT COUNT(*) AS n FROM users').get().n, 0);
      assert.equal(db.prepare('SELECT COUNT(*) AS n FROM categories').get().n, 0);
    } finally {
      db.close();
    }
  }
});

test('bootstrap never promotes an existing account with a matching email', async () => {
  const db = openDatabase(':memory:');
  try {
    db.prepare('INSERT INTO users(name,email,password_hash,role) VALUES (?,?,?,?)').run(
      'Customer',
      adminEnv.ADMIN_EMAIL,
      'existing-hash',
      'customer'
    );
    await assert.rejects(bootstrapDatabase(db, adminEnv), /đã thuộc về/);
    const customer = db.prepare('SELECT role,password_hash FROM users').get();
    assert.equal(customer.role, 'customer');
    assert.equal(customer.password_hash, 'existing-hash');
  } finally {
    db.close();
  }
});

test('redeploy preserves SQLite data and never resets the admin password', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'candate-deploy-test-'));
  const filename = path.join(dir, 'persistent.sqlite');
  const first = openDatabase(filename);
  await bootstrapDatabase(first, adminEnv);
  const original = first.prepare('SELECT password_hash FROM users').get().password_hash;
  first.prepare("UPDATE settings SET value='12345' WHERE key='shipping_fee'").run();
  first
    .prepare("INSERT INTO categories(name,slug) VALUES ('Danh mục đã tạo','saved-category')")
    .run();
  first.close();

  const second = openDatabase(filename);
  try {
    assert.equal(
      (
        await bootstrapDatabase(second, {
          ...adminEnv,
          ADMIN_PASSWORD: 'ChangedButNotApplied2026!',
        })
      ).created,
      false
    );
    assert.equal((await bootstrapDatabase(second, { NODE_ENV: 'production' })).created, false);
    assert.equal(second.prepare('SELECT password_hash FROM users').get().password_hash, original);
    assert.equal(
      second.prepare("SELECT value FROM settings WHERE key='shipping_fee'").get().value,
      '12345'
    );
    assert.equal(second.prepare('SELECT COUNT(*) AS n FROM categories').get().n, 5);
    assert.equal(second.prepare('SELECT COUNT(*) AS n FROM users').get().n, 1);
  } finally {
    second.close();
  }
});

test('local development can still use the explicit demo seed without bootstrap variables', async () => {
  const db = openDatabase(':memory:');
  try {
    assert.equal((await bootstrapDatabase(db, { NODE_ENV: 'development' })).created, false);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM users').get().n, 0);
  } finally {
    db.close();
  }
});

test('simultaneous startup does not create duplicate administrator accounts', async () => {
  const db = openDatabase(':memory:');
  try {
    const results = await Promise.all([
      bootstrapDatabase(db, adminEnv),
      bootstrapDatabase(db, adminEnv),
    ]);
    assert.equal(results.filter((r) => r.created).length, 1);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM users').get().n, 1);
  } finally {
    db.close();
  }
});

test('Render proxy rate limiting uses client IPs and production sessions use Secure cookies', async () => {
  const oldMode = process.env.NODE_ENV;
  const oldProxy = process.env.TRUST_PROXY_HOPS;
  process.env.NODE_ENV = 'production';
  process.env.TRUST_PROXY_HOPS = '1';
  const db = openDatabase(':memory:');
  let server;
  try {
    await bootstrapDatabase(db, adminEnv);
    server = createApp(db).listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    const url = `http://127.0.0.1:${server.address().port}/api/auth/login`;
    async function login(clientIp) {
      return fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Forwarded-For': clientIp,
          'X-Forwarded-Proto': 'https',
        },
        body: JSON.stringify({ email: adminEnv.ADMIN_EMAIL, password: adminEnv.ADMIN_PASSWORD }),
      });
    }
    const a = await login('192.0.2.10');
    const b = await login('192.0.2.20');
    const again = await login('192.0.2.10');
    assert.equal(a.status, 200);
    assert.equal(b.status, 200);
    assert.match(a.headers.get('set-cookie'), /; Secure/);
    assert.match(a.headers.get('set-cookie'), /HttpOnly/);
    assert.match(a.headers.get('ratelimit'), /remaining=39/);
    assert.match(b.headers.get('ratelimit'), /remaining=39/);
    assert.match(again.headers.get('ratelimit'), /remaining=38/);
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    db.close();
    if (oldMode === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = oldMode;
    if (oldProxy === undefined) delete process.env.TRUST_PROXY_HOPS;
    else process.env.TRUST_PROXY_HOPS = oldProxy;
  }
});
