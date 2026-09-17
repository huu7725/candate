import { Hono } from 'hono';
import { secureHeaders } from 'hono/secure-headers';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import {
  authenticate,
  requireRoles,
  hashCredential,
  verifyCredential,
  hashToken,
  randomToken,
  setSessionCookie,
  logout,
  authRateLimit,
} from './auth.js';
import {
  statement as st,
  first,
  all,
  run,
  guard,
  clearGuard,
  audit,
  settings,
  LOTS,
  getLot,
  cartFor,
  publicCart,
  normalizeSearch,
} from './db.js';
import {
  roles,
  staff,
  integer,
  idSchema,
  dateSchema,
  productSchema,
  categorySchema,
  orderSchema,
  settingsSchema,
  credentialSchema,
  fail,
  sellable,
} from './validation.js';
import { todayVN } from '../server/pricing.js';

const app = new Hono();
app.use(
  '*',
  secureHeaders({
    contentSecurityPolicy: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:'],
      fontSrc: ["'self'"],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      frameAncestors: ["'none'"],
    },
  })
);
app.use(
  '/api/*',
  bodyLimit({ maxSize: 32 * 1024, onError: (c) => c.json({ error: 'Yêu cầu quá lớn.' }, 413) })
);
app.use('/api/*', async (c, next) => {
  c.header('Cache-Control', 'no-store');
  if (!['GET', 'HEAD', 'OPTIONS'].includes(c.req.method)) {
    const origin = c.req.header('origin');
    if (
      c.req.header('sec-fetch-site') === 'cross-site' ||
      (origin && origin !== new URL(c.req.url).origin)
    )
      return c.json({ error: 'Nguồn yêu cầu không được phép.' }, 403);
    if (!c.req.header('content-type')?.startsWith('application/json'))
      return c.json({ error: 'Yêu cầu phải dùng JSON.' }, 415);
  }
  await next();
});
app.use('/api/*', authenticate);
const body = async (c, schema) => schema.parse(await c.req.json());
const user = (c) => c.get('user');
const id = (c) => idSchema.parse(c.req.param('id'));
async function lot(db, inventoryId) {
  const row = await getLot(db, inventoryId);
  if (!row) fail(404, 'Không tìm thấy lô hàng.');
  return row;
}
function actorGuard(db, key, actor) {
  return guard(db, key, 'EXISTS(SELECT 1 FROM users WHERE id=? AND role=? AND active=1)', [
    actor.id,
    actor.role,
  ]);
}

app.get('/api/health', async (c) => {
  await first(c.env.DB, 'SELECT 1 AS ok FROM settings LIMIT 1');
  return c.json({ status: 'ok' });
});
app.get('/api/settings', async (c) => c.json(await settings(c.env.DB)));
app.get('/api/auth/me', (c) => c.json({ user: user(c) || null }));
app.post('/api/auth/register', authRateLimit, async (c) => {
  const data = await body(c, credentialSchema.extend({ name: z.string().trim().min(2).max(80) }));
  const db = c.env.DB;
  if (await first(db, 'SELECT id FROM users WHERE email=?', data.email))
    fail(409, 'Email đã được sử dụng.');
  const hash = await hashCredential(data.credential, c.env.AUTH_SECRET);
  const token = randomToken();
  const tokenHash = await hashToken(token);
  const result = await db.batch([
    st(
      db,
      "INSERT INTO users(name,email,password_hash,role) VALUES (?,?,?,'customer') RETURNING id,name,email,role",
      data.name,
      data.email.toLowerCase(),
      hash
    ),
    st(
      db,
      'INSERT INTO sessions(token_hash,user_id,expires_at) SELECT ?,id,? FROM users WHERE email=?',
      tokenHash,
      Date.now() + 7 * 86400000,
      data.email
    ),
  ]);
  setSessionCookie(c, token);
  return c.json({ user: result[0].results[0] }, 201);
});
app.post('/api/auth/login', authRateLimit, async (c) => {
  const data = await body(c, credentialSchema);
  const db = c.env.DB;
  const account = await first(db, 'SELECT * FROM users WHERE email=?', data.email);
  const valid = await verifyCredential(data.credential, account?.password_hash, c.env.AUTH_SECRET);
  if (!valid || !account?.active) fail(401, 'Email hoặc mật khẩu không đúng.');
  const token = randomToken();
  const tokenHash = await hashToken(token);
  const key = crypto.randomUUID();
  await db.batch([
    guard(
      db,
      key,
      'EXISTS(SELECT 1 FROM users WHERE id=? AND active=1 AND password_hash=? AND role=?)',
      [account.id, account.password_hash, account.role]
    ),
    st(db, 'DELETE FROM sessions WHERE expires_at<=?', Date.now()),
    st(
      db,
      'INSERT INTO sessions(token_hash,user_id,expires_at) VALUES (?,?,?)',
      tokenHash,
      account.id,
      Date.now() + 7 * 86400000
    ),
    clearGuard(db, key),
  ]);
  setSessionCookie(c, token);
  return c.json({
    user: { id: account.id, name: account.name, email: account.email, role: account.role },
  });
});
app.post('/api/auth/logout', logout);

app.get('/api/categories', async (c) =>
  c.json(await all(c.env.DB, 'SELECT * FROM categories ORDER BY id'))
);
app.post('/api/categories', requireRoles(...staff), async (c) => {
  const data = await body(c, categorySchema);
  const row = await first(
    c.env.DB,
    'INSERT INTO categories(name,slug) VALUES (?,?) RETURNING *',
    data.name,
    data.slug
  );
  return c.json(row, 201);
});
app.patch('/api/categories/:id', requireRoles(...staff), async (c) => {
  const data = await body(c, categorySchema);
  const row = await first(
    c.env.DB,
    'UPDATE categories SET name=?,slug=? WHERE id=? RETURNING *',
    data.name,
    data.slug,
    id(c)
  );
  if (!row) fail(404, 'Không tìm thấy danh mục.');
  return c.json(row);
});
app.get('/api/products', async (c) => {
  const query = z
    .object({
      q: z.string().max(120).optional(),
      category: z.coerce.number().int().positive().optional(),
      expiry: z.enum(['all', '3', '7', '14']).default('all'),
      sort: z.enum(['recommended', 'price_asc', 'expiry', 'discount']).default('recommended'),
      page: z.coerce.number().int().min(1).max(10000).default(1),
    })
    .parse(c.req.query());
  const where = ['active=1', 'stock>0', 'days_left>=0'];
  const args = [];
  if (query.q) {
    where.push('instr(search_text,?)>0');
    args.push(normalizeSearch(query.q));
  }
  if (query.category) {
    where.push('category_id=?');
    args.push(query.category);
  }
  if (query.expiry !== 'all') {
    where.push('days_left<=?');
    args.push(Number(query.expiry));
  }
  const filter = where.join(' AND ');
  const sort = {
    recommended: 'id',
    price_asc: 'price ASC,id',
    expiry: 'days_left ASC,id',
    discount: 'discount_percent DESC,id',
  }[query.sort];
  const [items, total] = await Promise.all([
    all(
      c.env.DB,
      `${LOTS} SELECT * FROM priced WHERE ${filter} ORDER BY ${sort} LIMIT 24 OFFSET ?`,
      ...args,
      (query.page - 1) * 24
    ),
    first(c.env.DB, `${LOTS} SELECT COUNT(*) AS n FROM priced WHERE ${filter}`, ...args),
  ]);
  return c.json({ items, total: total.n, page: query.page, page_size: 24 });
});
app.get('/api/products/:id', async (c) => {
  const row = await lot(c.env.DB, id(c));
  if (!row.active) fail(404, 'Sản phẩm đã ngừng bán.');
  const reviews = await all(
    c.env.DB,
    "SELECT r.rating,r.content,r.created_at,u.name FROM reviews r JOIN users u ON u.id=r.user_id WHERE r.product_id=? AND r.status='approved' ORDER BY r.id DESC LIMIT 200",
    row.product_id
  );
  return c.json({ ...row, reviews });
});

app.get('/api/cart', requireRoles('customer'), async (c) =>
  c.json(publicCart(await cartFor(c.env.DB, user(c).id)))
);
app.put('/api/cart/:id', requireRoles('customer'), async (c) => {
  const inventoryId = id(c);
  const { quantity } = await body(c, z.object({ quantity: integer.min(0).max(99) }));
  const db = c.env.DB;
  if (!quantity)
    await run(
      db,
      'DELETE FROM cart_items WHERE user_id=? AND inventory_id=?',
      user(c).id,
      inventoryId
    );
  else {
    sellable(await lot(db, inventoryId), quantity);
    const key = crypto.randomUUID();
    await db.batch([
      guard(
        db,
        key,
        "EXISTS(SELECT 1 FROM inventory i JOIN products p ON p.id=i.product_id WHERE i.id=? AND p.active=1 AND i.expiry_date>=date('now','+7 hours') AND i.stock>=?)",
        [inventoryId, quantity]
      ),
      st(
        db,
        'INSERT INTO cart_items(user_id,inventory_id,quantity) VALUES (?,?,?) ON CONFLICT(user_id,inventory_id) DO UPDATE SET quantity=excluded.quantity',
        user(c).id,
        inventoryId,
        quantity
      ),
      clearGuard(db, key),
    ]);
  }
  return c.json(publicCart(await cartFor(db, user(c).id)));
});
app.post('/api/cart/merge', requireRoles('customer'), async (c) => {
  const { items } = await body(
    c,
    z.object({
      items: z
        .array(z.object({ id: integer.positive(), quantity: integer.min(1).max(99) }))
        .max(99)
        .refine((rows) => new Set(rows.map((r) => r.id)).size === rows.length, 'Mã lô bị trùng'),
    })
  );
  if (!items.length) return c.json(publicCart(await cartFor(c.env.DB, user(c).id)));
  const db = c.env.DB;
  const key = crypto.randomUUID();
  const json = JSON.stringify(items);
  await db.batch([
    guard(
      db,
      key,
      `(SELECT COUNT(*) FROM json_each(?) j JOIN inventory i ON i.id=json_extract(j.value,'$.id') JOIN products p ON p.id=i.product_id LEFT JOIN cart_items ci ON ci.inventory_id=i.id AND ci.user_id=? WHERE p.active=1 AND i.expiry_date>=date('now','+7 hours') AND COALESCE(ci.quantity,0)+json_extract(j.value,'$.quantity')<=MIN(i.stock,99))=?`,
      [json, user(c).id, items.length]
    ),
    st(
      db,
      `INSERT INTO cart_items(user_id,inventory_id,quantity) SELECT ?,json_extract(value,'$.id'),json_extract(value,'$.quantity') FROM json_each(?) WHERE 1 ON CONFLICT(user_id,inventory_id) DO UPDATE SET quantity=cart_items.quantity+excluded.quantity`,
      user(c).id,
      json
    ),
    clearGuard(db, key),
  ]);
  return c.json(publicCart(await cartFor(db, user(c).id)));
});
app.post('/api/orders', requireRoles('customer'), async (c) => {
  const data = await body(c, orderSchema);
  const db = c.env.DB;
  const customer = user(c);
  const existing = () =>
    first(
      db,
      'SELECT id FROM orders WHERE customer_id=? AND request_key=?',
      customer.id,
      data.request_key
    );
  const prior = await existing();
  if (prior) return c.json({ id: prior.id, message: 'Đặt hàng thành công.' }, 201);
  const cart = await cartFor(db, customer.id);
  if (!cart.items.length) fail(400, 'Giỏ hàng đang trống.');
  cart.items.forEach((row) => sellable(row, row.quantity));
  if (cart.total !== data.expected_total)
    fail(409, 'Giá hoặc phí giao hàng đã thay đổi. Vui lòng kiểm tra giỏ hàng rồi đặt lại.');
  const key = crypto.randomUUID();
  const snapshot = JSON.stringify(
    cart.items.map((i) => ({
      id: i.id,
      quantity: i.quantity,
      price: i.price,
      original_price: i.original_price,
      expiry_date: i.expiry_date,
      vendor_id: i.vendor_id,
      name: i.name,
      discount_percent: i.discount_percent,
    }))
  );
  const orderIdSQL = 'SELECT id FROM orders WHERE customer_id=? AND request_key=?';
  try {
    const result = await db.batch([
      actorGuard(db, key, customer),
      guard(
        db,
        `${key}-cart`,
        `(SELECT COUNT(*) FROM cart_items WHERE user_id=?)=? AND (${LOTS} SELECT COUNT(*) FROM priced p JOIN json_each(?) j ON p.id=json_extract(j.value,'$.id') JOIN cart_items ci ON ci.inventory_id=p.id AND ci.user_id=? WHERE ci.quantity=json_extract(j.value,'$.quantity') AND p.stock>=ci.quantity AND p.active=1 AND p.days_left>=0 AND p.price=json_extract(j.value,'$.price') AND p.original_price=json_extract(j.value,'$.original_price') AND p.expiry_date=json_extract(j.value,'$.expiry_date') AND p.vendor_id=json_extract(j.value,'$.vendor_id') AND p.name=json_extract(j.value,'$.name') AND p.discount_percent=json_extract(j.value,'$.discount_percent'))=? AND (SELECT CAST(value AS INTEGER) FROM settings WHERE key='shipping_fee')=? AND (SELECT CAST(value AS INTEGER) FROM settings WHERE key='free_shipping_threshold')=?`,
        [
          customer.id,
          cart.items.length,
          snapshot,
          customer.id,
          cart.items.length,
          cart.config.shipping_fee,
          cart.config.free_shipping_threshold,
        ]
      ),
      st(
        db,
        'INSERT INTO orders(customer_id,request_key,recipient,phone,address,note,subtotal,shipping_fee,total) VALUES (?,?,?,?,?,?,?,?,?) RETURNING id',
        customer.id,
        data.request_key,
        data.recipient,
        data.phone,
        data.address,
        data.note,
        cart.subtotal,
        cart.shipping_fee,
        cart.total
      ),
      st(
        db,
        `INSERT INTO order_items(order_id,inventory_id,vendor_id,product_name,expiry_date,quantity,original_price,unit_price,discount_percent) SELECT (${orderIdSQL}),json_extract(value,'$.id'),json_extract(value,'$.vendor_id'),json_extract(value,'$.name'),json_extract(value,'$.expiry_date'),json_extract(value,'$.quantity'),json_extract(value,'$.original_price'),json_extract(value,'$.price'),json_extract(value,'$.discount_percent') FROM json_each(?)`,
        customer.id,
        data.request_key,
        snapshot
      ),
      st(
        db,
        "UPDATE inventory SET stock=stock-(SELECT json_extract(value,'$.quantity') FROM json_each(?) WHERE json_extract(value,'$.id')=inventory.id),updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id IN (SELECT json_extract(value,'$.id') FROM json_each(?))",
        snapshot,
        snapshot
      ),
      st(db, 'DELETE FROM cart_items WHERE user_id=?', customer.id),
      st(
        db,
        `INSERT INTO audit_logs(actor_id,action,entity_type,entity_id) SELECT ?,'create','order',id FROM orders WHERE customer_id=? AND request_key=?`,
        customer.id,
        customer.id,
        data.request_key
      ),
      clearGuard(db, key),
      clearGuard(db, `${key}-cart`),
    ]);
    return c.json({ id: result[2].results[0].id, message: 'Đặt hàng thành công.' }, 201);
  } catch (error) {
    const replay = await existing();
    if (replay) return c.json({ id: replay.id, message: 'Đặt hàng thành công.' }, 201);
    throw error;
  }
});
app.get('/api/orders', requireRoles(...roles), async (c) => {
  const db = c.env.DB;
  const actor = user(c);
  const own = actor.role === 'vendor';
  const filter = own
    ? 'WHERE EXISTS(SELECT 1 FROM order_items oi WHERE oi.order_id=o.id AND oi.vendor_id=?)'
    : actor.role === 'customer'
      ? 'WHERE customer_id=?'
      : actor.role === 'shipper'
        ? "WHERE shipper_id=? OR (status='confirmed' AND shipper_id IS NULL)"
        : '';
  const rows = await all(
    db,
    `SELECT ${own ? 'o.id,o.status,o.created_at' : 'o.*'} FROM orders o ${filter} ORDER BY o.id DESC LIMIT 200`,
    ...(filter ? [actor.id] : [])
  );
  if (!rows.length) return c.json([]);
  const items = await all(
    db,
    `SELECT ${own ? 'oi.order_id,oi.product_name,oi.quantity,oi.unit_price,oi.expiry_date' : 'oi.*,i.product_id'} FROM order_items oi JOIN inventory i ON i.id=oi.inventory_id WHERE oi.order_id IN (SELECT value FROM json_each(?)) ${own ? 'AND oi.vendor_id=?' : ''}`,
    JSON.stringify(rows.map((o) => o.id)),
    ...(own ? [actor.id] : [])
  );
  return c.json(rows.map((o) => ({ ...o, items: items.filter((i) => i.order_id === o.id) })));
});
app.patch(
  '/api/orders/:id/status',
  requireRoles('admin', 'manager', 'customer', 'shipper'),
  async (c) => {
    const orderId = id(c);
    const { status } = await body(
      c,
      z.object({ status: z.enum(['confirmed', 'shipping', 'delivered', 'failed', 'cancelled']) })
    );
    const db = c.env.DB;
    const actor = user(c);
    const order = await first(db, 'SELECT * FROM orders WHERE id=?', orderId);
    if (!order) fail(404, 'Không tìm thấy đơn hàng.');
    if (
      actor.role === 'customer' &&
      (order.customer_id !== actor.id || status !== 'cancelled' || order.status !== 'pending')
    )
      fail(403, 'Bạn chỉ có thể hủy đơn của mình khi đang chờ xác nhận.');
    if (actor.role === 'shipper') {
      if (status === 'shipping') {
        if (order.status !== 'confirmed' || order.shipper_id)
          fail(409, 'Đơn này không còn sẵn sàng để nhận.');
      } else if (
        order.shipper_id !== actor.id ||
        order.status !== 'shipping' ||
        !['delivered', 'failed'].includes(status)
      )
        fail(403, 'Bạn không có quyền cập nhật đơn này.');
    }
    const transitions = {
      pending: ['confirmed', 'cancelled'],
      confirmed: ['shipping', 'cancelled'],
      shipping: ['delivered', 'failed'],
      failed: ['confirmed', 'cancelled'],
      delivered: [],
      cancelled: [],
    };
    if (!transitions[order.status].includes(status))
      fail(409, 'Không thể chuyển trạng thái đơn hàng như yêu cầu.');
    if (staff.includes(actor.role) && ['shipping', 'delivered', 'failed'].includes(status))
      fail(400, 'Nhân viên giao hàng phụ trách cập nhật quá trình giao.');
    const key = crypto.randomUUID();
    const commands = [
      actorGuard(db, key, actor),
      guard(
        db,
        `${key}-order`,
        'EXISTS(SELECT 1 FROM orders WHERE id=? AND status=? AND shipper_id IS ? AND updated_at=?)',
        [orderId, order.status, order.shipper_id, order.updated_at]
      ),
    ];
    if (['confirmed', 'shipping', 'delivered'].includes(status))
      commands.push(
        guard(
          db,
          `${key}-expiry`,
          "NOT EXISTS(SELECT 1 FROM order_items WHERE order_id=? AND expiry_date<date('now','+7 hours'))",
          [orderId]
        )
      );
    if (status === 'cancelled')
      commands.push(
        st(
          db,
          "UPDATE inventory SET stock=stock+(SELECT SUM(quantity) FROM order_items WHERE order_id=? AND inventory_id=inventory.id),updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id IN (SELECT inventory_id FROM order_items WHERE order_id=?)",
          orderId,
          orderId
        )
      );
    const shipper =
      status === 'shipping' ? actor.id : status === 'confirmed' ? null : order.shipper_id;
    commands.push(
      st(
        db,
        'UPDATE orders SET status=?,shipper_id=?,payment_status=?,updated_at=? WHERE id=?',
        status,
        shipper,
        status === 'delivered' ? 'paid' : 'unpaid',
        new Date().toISOString(),
        orderId
      ),
      audit(db, actor, 'status', 'order', orderId, { from: order.status, to: status }),
      clearGuard(db, key),
      clearGuard(db, `${key}-order`),
      clearGuard(db, `${key}-expiry`)
    );
    await db.batch(commands);
    return c.json({ ok: true });
  }
);

app.get('/api/manage/products', requireRoles(...staff, 'vendor'), async (c) =>
  c.json(
    await all(
      c.env.DB,
      `${LOTS} SELECT * FROM priced ${user(c).role === 'vendor' ? 'WHERE vendor_id=?' : ''} ORDER BY id DESC`,
      ...(user(c).role === 'vendor' ? [user(c).id] : [])
    )
  )
);
app.get('/api/manage/vendors', requireRoles(...staff), async (c) =>
  c.json(await all(c.env.DB, "SELECT id,name FROM users WHERE role='vendor' AND active=1"))
);
app.post('/api/manage/products', requireRoles(...staff, 'vendor'), async (c) => {
  const data = await body(c, productSchema);
  const db = c.env.DB;
  const actor = user(c);
  const vendor = actor.role === 'vendor' ? actor.id : data.vendor_id;
  if (
    !vendor ||
    !(await first(db, "SELECT id FROM users WHERE id=? AND role='vendor' AND active=1", vendor))
  )
    fail(400, 'Cần chọn nhà cung cấp đang hoạt động.');
  if (!(await first(db, 'SELECT id FROM categories WHERE id=?', data.category_id)))
    fail(400, 'Danh mục không tồn tại.');
  if (data.expiry_date < todayVN()) fail(400, 'Không thể đăng bán hàng đã hết hạn.');
  const key = crypto.randomUUID();
  const result = await db.batch([
    guard(db, key, "EXISTS(SELECT 1 FROM users WHERE id=? AND role='vendor' AND active=1)", [
      vendor,
    ]),
    st(
      db,
      'INSERT INTO products(vendor_id,category_id,name,brand,description,unit,visual,search_text) VALUES (?,?,?,?,?,?,?,?)',
      vendor,
      data.category_id,
      data.name,
      data.brand,
      data.description,
      data.unit,
      data.visual,
      normalizeSearch(`${data.name} ${data.brand}`)
    ),
    st(
      db,
      'INSERT INTO inventory(product_id,lot_code,expiry_date,original_price,stock) VALUES (last_insert_rowid(),?,?,?,?) RETURNING id',
      data.lot_code,
      data.expiry_date,
      data.original_price,
      data.stock
    ),
    st(
      db,
      "INSERT INTO audit_logs(actor_id,action,entity_type,entity_id) SELECT ?,'create','inventory',id FROM inventory WHERE lot_code=?",
      actor.id,
      data.lot_code
    ),
    clearGuard(db, key),
  ]);
  return c.json(await lot(db, result[2].results[0].id), 201);
});
app.patch('/api/manage/products/:id', requireRoles(...staff, 'vendor'), async (c) => {
  const inventoryId = id(c);
  const db = c.env.DB;
  const actor = user(c);
  const data = await body(
    c,
    z
      .object({
        expiry_date: dateSchema.optional(),
        stock: integer.min(0).max(100000).optional(),
        original_price: integer.min(1000).max(100000000).optional(),
        active: z.boolean().optional(),
        name: z.string().trim().min(2).max(120).optional(),
        category_id: integer.positive().optional(),
        description: z.string().trim().max(2000).optional(),
      })
      .strict()
  );
  const old = await lot(db, inventoryId);
  if (actor.role === 'vendor' && old.vendor_id !== actor.id)
    fail(403, 'Bạn chỉ được sửa hàng của mình.');
  if (
    data.category_id &&
    !(await first(db, 'SELECT id FROM categories WHERE id=?', data.category_id))
  )
    fail(400, 'Danh mục không tồn tại.');
  const key = crypto.randomUUID();
  const commands = [
    guard(
      db,
      key,
      'EXISTS(SELECT 1 FROM inventory i JOIN products p ON p.id=i.product_id WHERE i.id=? AND i.stock=? AND i.expiry_date=? AND i.original_price=? AND i.updated_at=? AND p.name=? AND p.active=? AND p.category_id=? AND p.description=?)',
      [
        inventoryId,
        old.stock,
        old.expiry_date,
        old.original_price,
        old.updated_at,
        old.name,
        old.active,
        old.category_id,
        old.description,
      ]
    ),
  ];
  if (data.expiry_date && data.expiry_date !== old.expiry_date) {
    if (await first(db, 'SELECT id FROM order_items WHERE inventory_id=? LIMIT 1', inventoryId))
      fail(409, 'Lô đã phát sinh đơn hàng. Hãy tạo lô mới nếu cần đổi hạn sử dụng.');
    commands.push(
      guard(db, `${key}-sold`, 'NOT EXISTS(SELECT 1 FROM order_items WHERE inventory_id=?)', [
        inventoryId,
      ])
    );
  }
  commands.push(
    st(
      db,
      'UPDATE inventory SET expiry_date=?,stock=?,original_price=?,updated_at=? WHERE id=?',
      data.expiry_date ?? old.expiry_date,
      data.stock ?? old.stock,
      data.original_price ?? old.original_price,
      new Date().toISOString(),
      inventoryId
    ),
    st(
      db,
      'UPDATE products SET active=?,name=?,category_id=?,description=?,search_text=? WHERE id=?',
      data.active === undefined ? old.active : Number(data.active),
      data.name ?? old.name,
      data.category_id ?? old.category_id,
      data.description ?? old.description,
      normalizeSearch(`${data.name ?? old.name} ${old.brand}`),
      old.product_id
    ),
    audit(db, actor, 'update', 'inventory', inventoryId, data),
    clearGuard(db, key),
    clearGuard(db, `${key}-sold`)
  );
  await db.batch(commands);
  return c.json(await lot(db, inventoryId));
});
app.post('/api/manage/products/:id/lots', requireRoles(...staff, 'vendor'), async (c) => {
  const db = c.env.DB;
  const actor = user(c);
  const old = await lot(db, id(c));
  if (actor.role === 'vendor' && old.vendor_id !== actor.id)
    fail(403, 'Bạn chỉ được thêm lô cho hàng của mình.');
  const data = await body(
    c,
    productSchema.pick({ expiry_date: true, original_price: true, stock: true, lot_code: true })
  );
  if (data.expiry_date < todayVN()) fail(400, 'Không thể nhập lô đã hết hạn.');
  const result = await db.batch([
    st(
      db,
      'INSERT INTO inventory(product_id,lot_code,expiry_date,original_price,stock) VALUES (?,?,?,?,?) RETURNING id',
      old.product_id,
      data.lot_code,
      data.expiry_date,
      data.original_price,
      data.stock
    ),
    st(
      db,
      "INSERT INTO audit_logs(actor_id,action,entity_type,entity_id) SELECT ?,'create','inventory',id FROM inventory WHERE lot_code=?",
      actor.id,
      data.lot_code
    ),
  ]);
  return c.json(await lot(db, result[0].results[0].id), 201);
});
app.get('/api/reports', requireRoles('admin', 'vendor'), async (c) => {
  const own = user(c).role === 'vendor';
  const args = own ? [user(c).id] : [];
  const [summary, daily] = await Promise.all([
    first(
      c.env.DB,
      `SELECT COALESCE(SUM(CASE WHEN o.status='delivered' THEN oi.unit_price*oi.quantity ELSE 0 END),0) AS revenue,COUNT(DISTINCT o.id) AS orders,COALESCE(SUM(CASE WHEN o.status='delivered' THEN oi.quantity ELSE 0 END),0) AS units FROM order_items oi JOIN orders o ON o.id=oi.order_id ${own ? 'WHERE oi.vendor_id=?' : ''}`,
      ...args
    ),
    all(
      c.env.DB,
      `SELECT date(o.created_at,'+7 hours') AS day,SUM(oi.quantity*oi.unit_price) AS revenue FROM order_items oi JOIN orders o ON o.id=oi.order_id WHERE o.status='delivered' ${own ? 'AND oi.vendor_id=?' : ''} GROUP BY day ORDER BY day DESC LIMIT 30`,
      ...args
    ),
  ]);
  return c.json({ ...summary, daily });
});
app.post('/api/reviews', requireRoles('customer'), async (c) => {
  const data = await body(
    c,
    z.object({
      product_id: integer.positive(),
      rating: integer.min(1).max(5),
      content: z.string().trim().min(5).max(1000),
    })
  );
  if (
    !(await first(
      c.env.DB,
      "SELECT oi.id FROM order_items oi JOIN orders o ON o.id=oi.order_id JOIN inventory i ON i.id=oi.inventory_id WHERE o.customer_id=? AND o.status='delivered' AND i.product_id=? LIMIT 1",
      user(c).id,
      data.product_id
    ))
  )
    fail(403, 'Chỉ có thể đánh giá sản phẩm đã nhận thành công.');
  await run(
    c.env.DB,
    "INSERT INTO reviews(user_id,product_id,rating,content) VALUES (?,?,?,?) ON CONFLICT(user_id,product_id) DO UPDATE SET rating=excluded.rating,content=excluded.content,status='pending'",
    user(c).id,
    data.product_id,
    data.rating,
    data.content
  );
  return c.json({ message: 'Đánh giá đã gửi và đang chờ duyệt.' }, 201);
});
app.get('/api/manage/reviews', requireRoles(...staff), async (c) =>
  c.json(
    await all(
      c.env.DB,
      'SELECT r.*,u.name AS customer_name,p.name AS product_name FROM reviews r JOIN users u ON u.id=r.user_id JOIN products p ON p.id=r.product_id ORDER BY r.id DESC LIMIT 200'
    )
  )
);
app.patch('/api/manage/reviews/:id', requireRoles(...staff), async (c) => {
  const reviewId = id(c);
  const { status } = await body(c, z.object({ status: z.enum(['approved', 'rejected']) }));
  const db = c.env.DB;
  const key = crypto.randomUUID();
  if (!(await first(db, 'SELECT id FROM reviews WHERE id=?', reviewId)))
    fail(404, 'Không tìm thấy đánh giá.');
  await db.batch([
    guard(db, key, 'EXISTS(SELECT 1 FROM reviews WHERE id=?)', [reviewId]),
    st(db, 'UPDATE reviews SET status=? WHERE id=?', status, reviewId),
    audit(db, user(c), 'moderate', 'review', reviewId, { status }),
    clearGuard(db, key),
  ]);
  return c.json({ ok: true });
});
app.get('/api/admin/users', requireRoles('admin'), async (c) =>
  c.json(await all(c.env.DB, 'SELECT id,name,email,role,active,created_at FROM users ORDER BY id'))
);
app.patch('/api/admin/users/:id', requireRoles('admin'), async (c) => {
  const targetId = id(c);
  const data = await body(c, z.object({ role: z.enum(roles), active: z.boolean() }));
  const db = c.env.DB;
  if (targetId === user(c).id)
    fail(400, 'Không thể tự thay đổi vai trò hoặc khóa tài khoản đang dùng.');
  const target = await first(db, 'SELECT id,role,active FROM users WHERE id=?', targetId);
  if (!target) fail(404, 'Không tìm thấy tài khoản.');
  const key = crypto.randomUUID();
  const commands = [
    guard(db, key, 'EXISTS(SELECT 1 FROM users WHERE id=? AND role=? AND active=?)', [
      targetId,
      target.role,
      target.active,
    ]),
  ];
  if (target.role === 'vendor' && data.role !== 'vendor')
    commands.push(
      guard(db, `${key}-vendor`, 'NOT EXISTS(SELECT 1 FROM products WHERE vendor_id=?)', [targetId])
    );
  if (target.role === 'shipper' && data.role !== 'shipper')
    commands.push(
      guard(
        db,
        `${key}-shipper`,
        "NOT EXISTS(SELECT 1 FROM orders WHERE shipper_id=? AND status='shipping')",
        [targetId]
      )
    );
  commands.push(
    st(db, 'UPDATE users SET role=?,active=? WHERE id=?', data.role, Number(data.active), targetId),
    st(db, 'DELETE FROM sessions WHERE user_id=?', targetId),
    audit(db, user(c), 'update', 'user', targetId, data),
    clearGuard(db, key),
    clearGuard(db, `${key}-vendor`),
    clearGuard(db, `${key}-shipper`)
  );
  await db.batch(commands);
  return c.json({ ok: true });
});
app.patch('/api/admin/settings', requireRoles('admin'), async (c) => {
  const data = await body(c, settingsSchema);
  const db = c.env.DB;
  await db.batch([
    ...Object.entries(data).map(([key, value]) =>
      st(db, 'UPDATE settings SET value=? WHERE key=?', JSON.stringify(value), key)
    ),
    audit(db, user(c), 'update', 'settings', 'all', data),
  ]);
  return c.json(await settings(db));
});
app.get('/api/admin/audit', requireRoles('admin'), async (c) =>
  c.json(
    await all(
      c.env.DB,
      'SELECT a.*,u.name AS actor_name FROM audit_logs a JOIN users u ON u.id=a.actor_id ORDER BY a.id DESC LIMIT 100'
    )
  )
);
app.all('/api/*', (c) => c.json({ error: 'API không tồn tại.' }, 404));
app.all('*', (c) => c.env.ASSETS.fetch(c.req.raw));
app.onError((error, c) => {
  if (error instanceof z.ZodError)
    return c.json(
      {
        error: 'Dữ liệu không hợp lệ.',
        details: error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
      },
      400
    );
  if (error instanceof SyntaxError) return c.json({ error: 'JSON không hợp lệ.' }, 400);
  if (error.status && error.status < 500) return c.json({ error: error.message }, error.status);
  const message = String(error.message);
  if (message.includes('CHECK constraint failed'))
    return c.json(
      {
        error:
          'Dữ liệu vừa thay đổi hoặc không còn đủ điều kiện thao tác. Kiểm tra hạn, tồn kho và tải lại để thử lại.',
      },
      409
    );
  if (message.includes('UNIQUE constraint failed'))
    return c.json({ error: 'Thông tin bị trùng. Kiểm tra email, mã lô hoặc danh mục.' }, 409);
  if (message.includes('FOREIGN KEY constraint failed'))
    return c.json({ error: 'Dữ liệu tham chiếu không còn tồn tại. Vui lòng tải lại.' }, 409);
  console.error('Worker request failed:', message.replace(/[a-f0-9]{64}/g, '[redacted]'));
  return c.json({ error: 'Có lỗi máy chủ. Vui lòng thử lại.' }, 500);
});
export default app;
