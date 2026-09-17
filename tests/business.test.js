import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { openDatabase } from '../server/db.js';
import { createApp } from '../server/app.js';
import { hashPassword } from '../server/auth.js';
import { daysLeft, priceLot, todayVN } from '../server/pricing.js';

let db, server, base;
const cookies = {};
const ids = {};
function future(days) {
  const d = new Date(`${todayVN()}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
async function request(path, { role, method = 'GET', body, headers = {} } = {}) {
  const response = await fetch(`${base}/api${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(role ? { Cookie: cookies[role] } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, data: await response.json(), headers: response.headers };
}
function newLot({ stock = 10, days = 7, vendor = ids.vendor, price = 100000 } = {}) {
  const p = db
    .prepare(
      "INSERT INTO products(vendor_id,category_id,name,brand,unit,visual) VALUES (?,1,'Sản phẩm thử','TEST','Hộp','oat')"
    )
    .run(vendor);
  const i = db
    .prepare(
      'INSERT INTO inventory(product_id,lot_code,expiry_date,original_price,stock) VALUES (?,?,?,?,?)'
    )
    .run(p.lastInsertRowid, randomUUID(), future(days), price, stock);
  return Number(i.lastInsertRowid);
}
async function checkout(role, extra = {}) {
  const cart = await request('/cart', { role });
  return request('/orders', {
    role,
    method: 'POST',
    body: {
      recipient: 'Người thử nghiệm',
      phone: '0901234567',
      address: '123 Nguyễn Trãi, Quận 1, TP HCM',
      payment_method: 'cod',
      request_key: randomUUID(),
      expected_total: cart.data.total,
      ...extra,
    },
  });
}
before(async () => {
  db = openDatabase(':memory:');
  const hash = await hashPassword('StrongTest123!');
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
    const real = role.replace('2', '');
    ids[role] = Number(
      db
        .prepare('INSERT INTO users(name,email,password_hash,role) VALUES (?,?,?,?)')
        .run(role, `${role}@test.local`, hash, real).lastInsertRowid
    );
  }
  db.prepare("INSERT INTO categories(name,slug) VALUES ('Thử nghiệm','test')").run();
  server = createApp(db).listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  for (const role of Object.keys(ids)) {
    const r = await request('/auth/login', {
      method: 'POST',
      body: { email: `${role}@test.local`, password: 'StrongTest123!' },
    });
    assert.equal(r.status, 200);
    cookies[role] = r.headers.get('set-cookie').split(';')[0];
    assert.match(r.headers.get('set-cookie'), /HttpOnly/);
    assert.match(r.headers.get('set-cookie'), /SameSite=Strict/);
  }
});
after(async () => {
  await new Promise((resolve) => server.close(resolve));
  db.close();
});

test('discount boundaries, expiry and Vietnam calendar dates', () => {
  const today = '2026-09-17';
  const expected = [
    ['2026-09-16', true, 0, null],
    ['2026-09-17', false, 80, 20000],
    ['2026-09-20', false, 80, 20000],
    ['2026-09-21', false, 50, 50000],
    ['2026-09-24', false, 50, 50000],
    ['2026-09-25', false, 30, 70000],
    ['2026-10-01', false, 30, 70000],
    ['2026-10-02', false, 0, 100000],
  ];
  for (const [expiry, expired, discount, price] of expected) {
    const result = priceLot({ expiry_date: expiry, original_price: 100000 }, undefined, today);
    assert.equal(result.expired, expired);
    assert.equal(result.discount_percent, discount);
    assert.equal(result.price, price);
  }
  assert.equal(todayVN(new Date('2026-09-17T17:01:00Z')), '2026-09-18');
  assert.equal(daysLeft('2028-03-01', '2028-02-28'), 2);
});
test('registration cannot escalate role and password is hashed', async () => {
  const r = await request('/auth/register', {
    method: 'POST',
    body: {
      name: 'New Customer',
      email: 'new@test.local',
      password: 'StrongTest123!',
      role: 'admin',
    },
  });
  assert.equal(r.status, 201);
  assert.equal(r.data.user.role, 'customer');
  assert.notEqual(
    db.prepare('SELECT password_hash FROM users WHERE id=?').get(r.data.user.id).password_hash,
    'StrongTest123!'
  );
  assert.equal(
    (
      await request('/auth/login', {
        method: 'POST',
        body: { email: 'new@test.local', password: 'wrong' },
      })
    ).status,
    401
  );
});
test('RBAC rejects anonymous, customers and managers at privileged endpoints', async () => {
  assert.equal((await request('/admin/users')).status, 401);
  for (const role of ['customer', 'manager', 'vendor', 'shipper'])
    assert.equal((await request('/admin/users', { role })).status, 403);
  assert.equal((await request('/reports', { role: 'manager' })).status, 403);
  assert.equal((await request('/manage/products', { role: 'shipper' })).status, 403);
  assert.equal((await request('/admin/users', { role: 'admin' })).status, 200);
});
test('cross-origin mutation and malformed quantity rejected', async () => {
  assert.equal(
    (
      await request('/auth/logout', {
        role: 'customer',
        method: 'POST',
        body: {},
        headers: { Origin: 'https://attacker.example' },
      })
    ).status,
    403
  );
  assert.equal(
    (await request('/cart/1', { role: 'customer', method: 'PUT', body: { quantity: -1 } })).status,
    400
  );
});
test('expired and out-of-stock lots cannot be bought or discovered', async () => {
  const expired = newLot({ days: -1 });
  const empty = newLot({ stock: 0 });
  const list = await request('/products');
  assert.ok(!list.data.items.some((i) => [expired, empty].includes(i.id)));
  for (const id of [expired, empty])
    assert.equal(
      (await request(`/cart/${id}`, { role: 'customer', method: 'PUT', body: { quantity: 1 } }))
        .status,
      409
    );
});
test('vendor inventory and private revenue are scoped to owner', async () => {
  const other = newLot({ vendor: ids.vendor2 });
  const list = await request('/manage/products', { role: 'vendor' });
  assert.ok(list.data.every((i) => i.vendor_id === ids.vendor));
  assert.equal(
    (
      await request(`/manage/products/${other}`, {
        role: 'vendor',
        method: 'PATCH',
        body: { stock: 200 },
      })
    ).status,
    403
  );
  assert.equal(
    (
      await request(`/manage/products/${other}/lots`, {
        role: 'vendor',
        method: 'POST',
        body: { lot_code: 'OTHER', expiry_date: future(9), original_price: 10000, stock: 1 },
      })
    ).status,
    403
  );
});
test('guest cart merge is atomic on stock failure', async () => {
  const good = newLot();
  const bad = newLot({ stock: 0 });
  const r = await request('/cart/merge', {
    role: 'customer',
    method: 'POST',
    body: {
      items: [
        { id: good, quantity: 1 },
        { id: bad, quantity: 1 },
      ],
    },
  });
  assert.equal(r.status, 409);
  assert.equal(
    db.prepare('SELECT count(*) n FROM cart_items WHERE user_id=?').get(ids.customer).n,
    0
  );
});
test('checkout rejects changed totals, preserves snapshot and is idempotent', async () => {
  const id = newLot({ stock: 5 });
  await request(`/cart/${id}`, { role: 'customer', method: 'PUT', body: { quantity: 2 } });
  assert.equal((await checkout('customer', { expected_total: 1 })).status, 409);
  assert.equal(db.prepare('SELECT stock FROM inventory WHERE id=?').get(id).stock, 5);
  const key = randomUUID();
  const r = await checkout('customer', { request_key: key });
  assert.equal(r.status, 201);
  const replay = await checkout('customer', { request_key: key });
  assert.equal(replay.data.id, r.data.id);
  assert.equal(db.prepare('SELECT stock FROM inventory WHERE id=?').get(id).stock, 3);
  const line = db.prepare('SELECT * FROM order_items WHERE order_id=?').get(r.data.id);
  assert.equal(line.unit_price, 50000);
  assert.equal(line.expiry_date, future(7));
  assert.equal(
    (
      await request(`/manage/products/${id}`, {
        role: 'manager',
        method: 'PATCH',
        body: { expiry_date: future(20) },
      })
    ).status,
    409
  );
  await request(`/manage/products/${id}`, {
    role: 'manager',
    method: 'PATCH',
    body: { original_price: 200000 },
  });
  assert.equal(
    db.prepare('SELECT unit_price FROM order_items WHERE order_id=?').get(r.data.id).unit_price,
    50000
  );
  assert.equal(
    (
      await request(`/orders/${r.data.id}/status`, {
        role: 'customer2',
        method: 'PATCH',
        body: { status: 'cancelled' },
      })
    ).status,
    403
  );
  assert.equal(
    (
      await request(`/orders/${r.data.id}/status`, {
        role: 'customer',
        method: 'PATCH',
        body: { status: 'cancelled' },
      })
    ).status,
    200
  );
  assert.equal(db.prepare('SELECT stock FROM inventory WHERE id=?').get(id).stock, 5);
  assert.equal(
    (
      await request(`/orders/${r.data.id}/status`, {
        role: 'customer',
        method: 'PATCH',
        body: { status: 'cancelled' },
      })
    ).status,
    403
  );
  assert.equal(db.prepare('SELECT stock FROM inventory WHERE id=?').get(id).stock, 5);
});
test('two buyers competing for one item cannot oversell', async () => {
  const id = newLot({ stock: 1 });
  for (const role of ['customer', 'customer2'])
    await request(`/cart/${id}`, { role, method: 'PUT', body: { quantity: 1 } });
  const results = await Promise.all([checkout('customer'), checkout('customer2')]);
  assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
  assert.equal(db.prepare('SELECT stock FROM inventory WHERE id=?').get(id).stock, 0);
  db.prepare('DELETE FROM cart_items').run();
});
test('expiry at checkout blocks cart captured before expiry', async () => {
  const id = newLot({ days: 0 });
  await request(`/cart/${id}`, { role: 'customer', method: 'PUT', body: { quantity: 1 } });
  db.prepare('UPDATE inventory SET expiry_date=? WHERE id=?').run(future(-1), id);
  assert.equal((await checkout('customer')).status, 409);
  assert.equal(db.prepare('SELECT stock FROM inventory WHERE id=?').get(id).stock, 10);
  db.prepare('DELETE FROM cart_items').run();
});
test('shipping ownership, transitions, moderation and vendor reports', async () => {
  const id = newLot({ vendor: ids.vendor2, days: 3 });
  await request(`/cart/${id}`, { role: 'customer', method: 'PUT', body: { quantity: 1 } });
  const order = await checkout('customer');
  assert.equal(order.status, 201);
  const change = (role, status) =>
    request(`/orders/${order.data.id}/status`, { role, method: 'PATCH', body: { status } });
  assert.equal((await change('shipper', 'shipping')).status, 409);
  assert.equal((await change('manager', 'confirmed')).status, 200);
  assert.equal((await change('customer', 'cancelled')).status, 403);
  assert.equal((await change('shipper', 'shipping')).status, 200);
  assert.equal((await change('shipper2', 'delivered')).status, 403);
  assert.equal((await change('shipper', 'delivered')).status, 200);
  assert.equal((await change('shipper', 'failed')).status, 403);
  assert.equal(
    db.prepare('SELECT payment_status FROM orders WHERE id=?').get(order.data.id).payment_status,
    'paid'
  );
  const vendor = await request('/orders', { role: 'vendor2' });
  const own = vendor.data.find((o) => o.id === order.data.id);
  assert.ok(own);
  assert.equal(own.address, undefined);
  assert.equal(own.phone, undefined);
  const other = await request('/orders', { role: 'vendor' });
  assert.ok(!other.data.some((o) => o.id === order.data.id));
  assert.equal((await request('/reports', { role: 'vendor2' })).data.revenue, 20000);
  assert.equal((await request('/reports', { role: 'vendor' })).data.revenue, 0);
  const productId = db.prepare('SELECT product_id FROM inventory WHERE id=?').get(id).product_id;
  assert.equal(
    (
      await request('/reviews', {
        role: 'customer2',
        method: 'POST',
        body: { product_id: productId, rating: 5, content: 'Chưa từng mua sản phẩm' },
      })
    ).status,
    403
  );
  assert.equal(
    (
      await request('/reviews', {
        role: 'customer',
        method: 'POST',
        body: { product_id: productId, rating: 5, content: 'Sản phẩm ngon và còn hạn.' },
      })
    ).status,
    201
  );
  assert.equal((await request(`/products/${id}`)).data.reviews.length, 0);
  const review = db.prepare('SELECT id FROM reviews WHERE product_id=?').get(productId);
  await request(`/manage/reviews/${review.id}`, {
    role: 'manager',
    method: 'PATCH',
    body: { status: 'approved' },
  });
  assert.equal((await request(`/products/${id}`)).data.reviews.length, 1);
});
test('failed deliveries retry without releasing inventory; cancellation releases once', async () => {
  const id = newLot({ stock: 2 });
  await request(`/cart/${id}`, { role: 'customer', method: 'PUT', body: { quantity: 1 } });
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
    assert.equal(
      (
        await request(`/orders/${order.data.id}/status`, {
          role,
          method: 'PATCH',
          body: { status },
        })
      ).status,
      200
    );
  assert.equal(db.prepare('SELECT stock FROM inventory WHERE id=?').get(id).stock, 2);
  assert.equal(
    (
      await request(`/orders/${order.data.id}/status`, {
        role: 'manager',
        method: 'PATCH',
        body: { status: 'cancelled' },
      })
    ).status,
    409
  );
});
test('invalid dates and reversed discount tiers rejected', async () => {
  const id = newLot();
  assert.equal(
    (
      await request(`/manage/products/${id}`, {
        role: 'manager',
        method: 'PATCH',
        body: { expiry_date: '2026-02-31' },
      })
    ).status,
    400
  );
  assert.equal(
    (
      await request('/admin/settings', {
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
});
test('account locking revokes sessions and registration cannot restore them', async () => {
  assert.equal(
    (
      await request(`/admin/users/${ids.admin}`, {
        role: 'admin',
        method: 'PATCH',
        body: { role: 'customer', active: false },
      })
    ).status,
    400
  );
  assert.equal(
    (
      await request(`/admin/users/${ids.customer2}`, {
        role: 'admin',
        method: 'PATCH',
        body: { role: 'customer', active: false },
      })
    ).status,
    200
  );
  assert.equal((await request('/cart', { role: 'customer2' })).status, 401);
  assert.equal(
    (
      await request('/auth/login', {
        method: 'POST',
        body: { email: 'customer2@test.local', password: 'StrongTest123!' },
      })
    ).status,
    401
  );
});
