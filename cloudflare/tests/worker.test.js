import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { deriveCredential } from '../../shared/credentials.js';
import { hashCredential } from '../auth.js';
import { adminInsertSQL } from '../setup-lib.js';
import { priceLot, todayVN } from '../../server/pricing.js';

const secret = 'test-pepper-only-not-for-production-'.repeat(2);
const password = 'WorkerTestPassword2026!';
let mf, db;
const accounts = {};
let lotNumber = 0;
const options = {
  modules: true,
  scriptPath: path.resolve('test-results/cf-bundle/index.js'),
  compatibilityDate: '2026-09-17',
  bindings: { AUTH_SECRET: secret },
  d1Databases: ['DB'],
};
function future(days) {
  const d = new Date(`${todayVN()}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
async function req(url, { role, method = 'GET', body, headers = {} } = {}) {
  const response = await mf.dispatchFetch(
    `https://can.example${url.startsWith('/api/') ? url : '/api' + url}`,
    {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(role ? { Cookie: accounts[role].cookie } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    }
  );
  const data = await response.json();
  return { status: response.status, data, headers: response.headers };
}
async function createLot({
  days = 7,
  stock = 10,
  vendor = 'vendor',
  price = 100000,
  name = 'Sữa yến mạch',
} = {}) {
  const result = await req('/manage/products', {
    role: vendor,
    method: 'POST',
    body: {
      name,
      brand: 'TEST',
      category_id: 1,
      description: 'Sản phẩm kiểm thử',
      unit: 'Hộp',
      visual: 'oat',
      expiry_date: future(days),
      original_price: price,
      stock,
      lot_code: `CF-${++lotNumber}`,
    },
  });
  assert.equal(result.status, 201, JSON.stringify(result.data));
  return result.data;
}
async function put(role, lot, quantity) {
  return req(`/cart/${lot.id}`, { role, method: 'PUT', body: { quantity } });
}
async function checkout(role, extra = {}) {
  const cart = await req('/cart', { role });
  assert.equal(cart.status, 200);
  return req('/orders', {
    role,
    method: 'POST',
    body: {
      recipient: 'Khách thử',
      phone: '0901234567',
      address: '123 Đường thử, TP Hồ Chí Minh',
      payment_method: 'cod',
      request_key: crypto.randomUUID(),
      expected_total: cart.data.total,
      ...extra,
    },
  });
}
async function change(orderId, role, status) {
  return req(`/orders/${orderId}/status`, { role, method: 'PATCH', body: { status } });
}
before(async () => {
  mf = new Miniflare(convertV4MiniflareOptions(options));
  db = await mf.getD1Database('DB');
  const sql = fs
    .readFileSync('cloudflare/migrations/0001_market.sql', 'utf8')
    .replace(/--[^\n]*/g, '');
  await db.batch(
    sql
      .split(';')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => db.prepare(s))
  );
  for (const role of [
    'admin',
    'manager',
    'customer',
    'customer2',
    'vendor',
    'vendor2',
    'shipper',
    'shipper2',
  ]) {
    const email = `${role}@worker.test`;
    const credential = await deriveCredential(email, password);
    const hash = await hashCredential(credential, secret);
    const account = await db
      .prepare('INSERT INTO users(name,email,password_hash,role) VALUES (?,?,?,?) RETURNING id')
      .bind(role, email, hash, role.replace('2', ''))
      .first();
    const result = await req('/auth/login', {
      method: 'POST',
      body: { email, credential, credential_version: 'cf-v1' },
    });
    assert.equal(result.status, 200, JSON.stringify(result.data));
    accounts[role] = {
      id: account.id,
      email,
      credential,
      cookie: result.headers.get('set-cookie').split(';')[0],
    };
    assert.match(result.headers.get('set-cookie'), /Secure/);
    assert.match(result.headers.get('set-cookie'), /HttpOnly/);
  }
});
after(async () => {
  if (mf) await mf.dispose();
});

test('worker is running on actual workerd/D1 and all five roles are protected', async () => {
  assert.equal((await req('/health')).status, 200);
  assert.equal((await req('/admin/users')).status, 401);
  for (const role of ['customer', 'manager', 'vendor', 'shipper'])
    assert.equal((await req('/admin/users', { role })).status, 403);
  assert.equal((await req('/manage/products', { role: 'shipper' })).status, 403);
  assert.equal((await req('/reports', { role: 'manager' })).status, 403);
  assert.equal((await req('/admin/users', { role: 'admin' })).status, 200);
});
test('registration cannot escalate; raw passwords and invalid login are rejected', async () => {
  const email = 'new@worker.test';
  const credential = await deriveCredential(email, password);
  const register = await req('/auth/register', {
    method: 'POST',
    body: { email, name: 'New Customer', credential, credential_version: 'cf-v1', role: 'admin' },
  });
  assert.equal(register.status, 201);
  assert.equal(register.data.user.role, 'customer');
  const stored = await db
    .prepare('SELECT password_hash FROM users WHERE id=?')
    .bind(register.data.user.id)
    .first();
  assert.ok(!stored.password_hash.includes(credential));
  assert.equal(
    (await req('/auth/login', { method: 'POST', body: { email, password } })).status,
    400
  );
  assert.equal(
    (
      await req('/auth/login', {
        method: 'POST',
        body: { email, credential: '0'.repeat(64), credential_version: 'cf-v1' },
      })
    ).status,
    401
  );
  assert.equal(
    (
      await req('/auth/logout', {
        role: 'customer',
        method: 'POST',
        body: {},
        headers: { Origin: 'https://attacker.example' },
      })
    ).status,
    403
  );
});
test('D1 price calculation matches SQLite business rules at every discount boundary', async () => {
  for (const days of [0, 3, 4, 7, 8, 14, 15]) {
    const item = await createLot({ days, price: 12345 });
    const expected = priceLot(item);
    assert.equal(item.price, expected.price);
    assert.equal(item.discount_percent, expected.discount_percent);
    assert.equal(item.days_left, days);
  }
  const list = await req('/products?expiry=3');
  assert.ok(list.data.items.every((i) => i.days_left <= 3));
  const search = await req('/products?q=sua');
  assert.ok(search.data.total >= 7);
  const sorted = await req('/products?sort=price_asc');
  assert.deepEqual(
    sorted.data.items.map((i) => i.price),
    sorted.data.items.map((i) => i.price).sort((a, b) => a - b)
  );
});
test('expired and empty stock cannot be listed, placed in cart or checked out', async () => {
  const expired = await createLot({ days: 0 });
  const empty = await createLot({ stock: 0 });
  await db
    .prepare('UPDATE inventory SET expiry_date=? WHERE id=?')
    .bind(future(-1), expired.id)
    .run();
  const list = await req('/products');
  assert.ok(!list.data.items.some((i) => i.id === expired.id || i.id === empty.id));
  assert.equal((await put('customer', expired, 1)).status, 409);
  assert.equal((await put('customer', empty, 1)).status, 409);
  const valid = await createLot({ days: 0 });
  assert.equal((await put('customer', valid, 1)).status, 200);
  await db
    .prepare('UPDATE inventory SET expiry_date=? WHERE id=?')
    .bind(future(-1), valid.id)
    .run();
  assert.equal((await checkout('customer')).status, 409);
  await put('customer', valid, 0);
});
test('vendor ownership is enforced for edits, new lots and reports', async () => {
  const own = await createLot();
  const other = await createLot({ vendor: 'vendor2' });
  const list = await req('/manage/products', { role: 'vendor' });
  assert.ok(list.data.every((i) => i.vendor_id === accounts.vendor.id));
  assert.equal(
    (
      await req(`/manage/products/${other.id}`, {
        role: 'vendor',
        method: 'PATCH',
        body: { stock: 999 },
      })
    ).status,
    403
  );
  assert.equal(
    (
      await req(`/manage/products/${other.id}/lots`, {
        role: 'vendor',
        method: 'POST',
        body: { lot_code: 'CROSS', stock: 3, original_price: 10000, expiry_date: future(10) },
      })
    ).status,
    403
  );
  assert.equal(
    (
      await req(`/manage/products/${own.id}/lots`, {
        role: 'vendor',
        method: 'POST',
        body: { lot_code: 'OWN', stock: 3, original_price: 10000, expiry_date: future(10) },
      })
    ).status,
    201
  );
  assert.equal(
    (
      await req(`/manage/products/${own.id}`, {
        role: 'vendor',
        method: 'PATCH',
        body: { expiry_date: '2026-02-31' },
      })
    ).status,
    400
  );
  const updated = await req(`/manage/products/${own.id}`, {
    role: 'vendor',
    method: 'PATCH',
    body: { stock: 22, name: 'Sản phẩm đổi tên' },
  });
  assert.equal(updated.status, 200);
  assert.equal(updated.data.stock, 22);
});
test('cart merge rolls back every row when one item fails its stock guard', async () => {
  const good = await createLot();
  const bad = await createLot({ stock: 0 });
  const result = await req('/cart/merge', {
    role: 'customer',
    method: 'POST',
    body: {
      items: [
        { id: good.id, quantity: 1 },
        { id: bad.id, quantity: 1 },
      ],
    },
  });
  assert.equal(result.status, 409);
  assert.equal((await req('/cart', { role: 'customer' })).data.items.length, 0);
  assert.equal(
    (
      await req('/cart/merge', {
        role: 'customer',
        method: 'POST',
        body: { items: [{ id: good.id, quantity: 2 }] },
      })
    ).status,
    200
  );
  assert.equal((await req('/cart', { role: 'customer' })).data.items[0].quantity, 2);
  await put('customer', good, 0);
});
test('checkout is atomic, snapshots prices and deduplicates simultaneous retries', async () => {
  const item = await createLot({ stock: 5 });
  await put('customer', item, 2);
  assert.equal((await checkout('customer', { expected_total: 1 })).status, 409);
  const key = crypto.randomUUID();
  const results = await Promise.all([
    checkout('customer', { request_key: key }),
    checkout('customer', { request_key: key }),
  ]);
  assert.deepEqual(
    results.map((r) => r.status),
    [201, 201]
  );
  assert.equal(results[0].data.id, results[1].data.id);
  const orderId = results[0].data.id;
  assert.equal(
    (await db.prepare('SELECT stock FROM inventory WHERE id=?').bind(item.id).first()).stock,
    3
  );
  const line = await db.prepare('SELECT * FROM order_items WHERE order_id=?').bind(orderId).first();
  assert.equal(line.unit_price, 50000);
  assert.equal(line.quantity, 2);
  assert.equal(
    (
      await req(`/manage/products/${item.id}`, {
        role: 'manager',
        method: 'PATCH',
        body: { expiry_date: future(15) },
      })
    ).status,
    409
  );
  assert.equal(
    (
      await req(`/manage/products/${item.id}`, {
        role: 'manager',
        method: 'PATCH',
        body: { original_price: 200000 },
      })
    ).status,
    200
  );
  assert.equal(
    (await db.prepare('SELECT unit_price FROM order_items WHERE order_id=?').bind(orderId).first())
      .unit_price,
    50000
  );
  assert.equal((await change(orderId, 'customer2', 'cancelled')).status, 403);
  const cancelled = await Promise.all([
    change(orderId, 'customer', 'cancelled'),
    change(orderId, 'customer', 'cancelled'),
  ]);
  assert.equal(cancelled.filter((r) => r.status === 200).length, 1);
  assert.equal(
    (await db.prepare('SELECT stock FROM inventory WHERE id=?').bind(item.id).first()).stock,
    5
  );
});
test('competing buyers cannot oversell the final item', async () => {
  const item = await createLot({ stock: 1 });
  await put('customer', item, 1);
  await put('customer2', item, 1);
  const result = await Promise.all([checkout('customer'), checkout('customer2')]);
  assert.deepEqual(result.map((r) => r.status).sort(), [201, 409]);
  assert.equal(
    (await db.prepare('SELECT stock FROM inventory WHERE id=?').bind(item.id).first()).stock,
    0
  );
  await put('customer', item, 0);
  await put('customer2', item, 0);
});
test('mixed-vendor order, shipper ownership, paid revenue and review moderation', async () => {
  const a = await createLot({ days: 3 });
  const b = await createLot({ vendor: 'vendor2', days: 3 });
  await put('customer', a, 1);
  await put('customer', b, 1);
  const order = await checkout('customer');
  assert.equal(order.status, 201);
  const orderId = order.data.id;
  assert.equal((await change(orderId, 'shipper', 'shipping')).status, 409);
  assert.equal((await change(orderId, 'manager', 'confirmed')).status, 200);
  assert.equal((await change(orderId, 'customer', 'cancelled')).status, 403);
  const claims = await Promise.all([
    change(orderId, 'shipper', 'shipping'),
    change(orderId, 'shipper2', 'shipping'),
  ]);
  assert.equal(claims.filter((r) => r.status === 200).length, 1);
  const winner = claims[0].status === 200 ? 'shipper' : 'shipper2';
  const other = winner === 'shipper' ? 'shipper2' : 'shipper';
  assert.equal((await change(orderId, other, 'delivered')).status, 403);
  assert.equal((await change(orderId, winner, 'delivered')).status, 200);
  assert.equal(
    (await db.prepare('SELECT payment_status FROM orders WHERE id=?').bind(orderId).first())
      .payment_status,
    'paid'
  );
  for (const role of ['vendor', 'vendor2']) {
    const row = (await req('/orders', { role })).data.find((o) => o.id === orderId);
    assert.equal(row.items.length, 1);
    assert.equal(row.phone, undefined);
    assert.equal(row.address, undefined);
    assert.equal((await req('/reports', { role })).data.revenue, 20000);
  }
  assert.equal(
    (
      await req('/reviews', {
        role: 'customer2',
        method: 'POST',
        body: { product_id: a.product_id, rating: 5, content: 'Chưa từng nhận hàng' },
      })
    ).status,
    403
  );
  assert.equal(
    (
      await req('/reviews', {
        role: 'customer',
        method: 'POST',
        body: { product_id: a.product_id, rating: 5, content: 'Sản phẩm tốt, còn hạn.' },
      })
    ).status,
    201
  );
  assert.equal((await req(`/products/${a.id}`)).data.reviews.length, 0);
  const review = (await req('/manage/reviews', { role: 'manager' })).data[0];
  assert.equal(
    (
      await req(`/manage/reviews/${review.id}`, {
        role: 'manager',
        method: 'PATCH',
        body: { status: 'approved' },
      })
    ).status,
    200
  );
  assert.equal((await req(`/products/${a.id}`)).data.reviews.length, 1);
});
test('failed delivery retry and cancellation release stock only once', async () => {
  const item = await createLot({ stock: 2 });
  await put('customer', item, 1);
  const order = await checkout('customer');
  for (const [role, status] of [
    ['manager', 'confirmed'],
    ['shipper', 'shipping'],
    ['shipper', 'failed'],
    ['manager', 'confirmed'],
    ['shipper2', 'shipping'],
    ['shipper2', 'failed'],
    ['manager', 'cancelled'],
  ])
    assert.equal((await change(order.data.id, role, status)).status, 200);
  assert.equal((await change(order.data.id, 'manager', 'cancelled')).status, 409);
  assert.equal(
    (await db.prepare('SELECT stock FROM inventory WHERE id=?').bind(item.id).first()).stock,
    2
  );
});
test('cannot confirm, dispatch or complete delivery after the expiry date', async () => {
  for (const status of ['confirmed', 'shipping', 'delivered']) {
    const item = await createLot({ days: 1 });
    await put('customer', item, 1);
    const order = await checkout('customer');
    if (status !== 'confirmed')
      assert.equal((await change(order.data.id, 'manager', 'confirmed')).status, 200);
    if (status === 'delivered')
      assert.equal((await change(order.data.id, 'shipper', 'shipping')).status, 200);
    await db
      .prepare('UPDATE order_items SET expiry_date=? WHERE order_id=?')
      .bind(future(-1), order.data.id)
      .run();
    assert.equal(
      (await change(order.data.id, status === 'confirmed' ? 'manager' : 'shipper', status)).status,
      409
    );
    if (status === 'delivered')
      assert.equal((await change(order.data.id, 'shipper', 'failed')).status, 200);
    assert.equal((await change(order.data.id, 'manager', 'cancelled')).status, 200);
  }
});
test('admin settings reject reversed discounts and account locks invalidate sessions', async () => {
  assert.equal(
    (
      await req('/admin/settings', {
        role: 'admin',
        method: 'PATCH',
        body: {
          shipping_fee: 25000,
          free_shipping_threshold: 199000,
          discount_tiers: [
            { days: 3, percent: 10 },
            { days: 7, percent: 80 },
          ],
        },
      })
    ).status,
    400
  );
  const updated = await req('/admin/settings', {
    role: 'admin',
    method: 'PATCH',
    body: {
      shipping_fee: 15000,
      free_shipping_threshold: 150000,
      discount_tiers: [
        { days: 3, percent: 80 },
        { days: 7, percent: 50 },
        { days: 14, percent: 30 },
      ],
    },
  });
  assert.equal(updated.status, 200);
  assert.equal(
    (
      await req(`/admin/users/${accounts.admin.id}`, {
        role: 'admin',
        method: 'PATCH',
        body: { role: 'customer', active: false },
      })
    ).status,
    400
  );
  assert.equal(
    (
      await req(`/admin/users/${accounts.customer2.id}`, {
        role: 'admin',
        method: 'PATCH',
        body: { role: 'customer', active: false },
      })
    ).status,
    200
  );
  assert.equal((await req('/cart', { role: 'customer2' })).status, 401);
  assert.equal(
    (
      await req('/auth/login', {
        method: 'POST',
        body: {
          email: accounts.customer2.email,
          credential: accounts.customer2.credential,
          credential_version: 'cf-v1',
        },
      })
    ).status,
    401
  );
  assert.equal((await req('/admin/audit', { role: 'admin' })).status, 200);
});
test('D1 migration is idempotent and never resets inventory or account data', async () => {
  const count = await db.prepare('SELECT COUNT(*) AS n FROM orders').first();
  const sql = fs
    .readFileSync('cloudflare/migrations/0001_market.sql', 'utf8')
    .replace(/--[^\n]*/g, '');
  await db.batch(
    sql
      .split(';')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => db.prepare(s))
  );
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM orders').first()).n, count.n);
  assert.equal((await req('/settings')).data.shipping_fee, 15000);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM operation_guards').first()).n, 0);
});

test('admin setup hashes credentials, escapes SQL and never replaces an existing administrator', async () => {
  const before = await db.prepare("SELECT id,password_hash FROM users WHERE role='admin'").first();
  const sql = await adminInsertSQL(
    { name: "Admin's name", email: 'fresh-admin@worker.test', password },
    secret
  );
  assert.ok(!sql.includes(password));
  await db.prepare(sql).run();
  const after = await db.prepare("SELECT id,password_hash FROM users WHERE role='admin'").first();
  assert.deepEqual(after, before);
  assert.equal(
    await db.prepare('SELECT id FROM users WHERE email=?').bind('fresh-admin@worker.test').first(),
    null
  );
});

test('authentication attempts are capped per client IP without storing passwords', async () => {
  const payload = {
    email: 'absent@worker.test',
    credential: '0'.repeat(64),
    credential_version: 'cf-v1',
  };
  let result;
  for (let n = 0; n < 41; n++)
    result = await req('/auth/login', {
      method: 'POST',
      body: payload,
      headers: { 'cf-connecting-ip': '192.0.2.90' },
    });
  assert.equal(result.status, 429);
  assert.equal(
    (
      await req('/auth/login', {
        method: 'POST',
        body: payload,
        headers: { 'cf-connecting-ip': '192.0.2.91' },
      })
    ).status,
    401
  );
});

test('D1 data and administrator verifier persist across Worker runtime restarts', async () => {
  const directory = fs.mkdtempSync(path.resolve('test-results/d1-persist-'));
  const config = convertV4MiniflareOptions({ ...options, resourcePersistencePath: directory });
  const firstRuntime = new Miniflare(config);
  const firstDb = await firstRuntime.getD1Database('DB');
  const sql = fs
    .readFileSync('cloudflare/migrations/0001_market.sql', 'utf8')
    .replace(/--[^\n]*/g, '');
  await firstDb.batch(
    sql
      .split(';')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => firstDb.prepare(s))
  );
  await firstDb
    .prepare(
      await adminInsertSQL(
        { name: 'Persistent Admin', email: 'persistent@worker.test', password },
        secret
      )
    )
    .run();
  await firstDb.prepare("UPDATE settings SET value='12345' WHERE key='shipping_fee'").run();
  const before = await firstDb
    .prepare("SELECT password_hash FROM users WHERE role='admin'")
    .first();
  await firstRuntime.dispose();
  const secondRuntime = new Miniflare(config);
  try {
    const secondDb = await secondRuntime.getD1Database('DB');
    assert.deepEqual(
      await secondDb.prepare("SELECT password_hash FROM users WHERE role='admin'").first(),
      before
    );
    const response = await secondRuntime.dispatchFetch('https://can.example/api/settings');
    assert.equal((await response.json()).shipping_fee, 12345);
  } finally {
    await secondRuntime.dispose();
  }
});
