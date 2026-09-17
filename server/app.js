import express from 'express';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import {
  authenticate,
  requireRoles,
  createSession,
  hashPassword,
  verifyPassword,
  getSessionToken,
  hashToken,
} from './auth.js';
import { priceLot, todayVN } from './pricing.js';

const roles = ['admin', 'manager', 'customer', 'vendor', 'shipper'];
const staff = ['admin', 'manager'];
const integer = z.number().int();
const idSchema = z.coerce.number().int().positive();
const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((v) => {
    const d = new Date(`${v}T00:00:00Z`);
    return !Number.isNaN(d.valueOf()) && d.toISOString().slice(0, 10) === v;
  }, 'Ngày không hợp lệ');
const productSchema = z.object({
  name: z.string().trim().min(2).max(120),
  brand: z.string().trim().max(60).default(''),
  description: z.string().trim().max(2000).default(''),
  unit: z.string().trim().min(1).max(40),
  category_id: integer.positive(),
  vendor_id: integer.positive().optional(),
  visual: z.enum(['oat', 'granola', 'juice', 'coffee', 'pasta', 'tea']),
  expiry_date: dateSchema,
  original_price: integer.min(1000).max(100000000),
  stock: integer.min(0).max(100000),
  lot_code: z.string().trim().min(2).max(50),
});
const asyncRoute = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
function fail(status, message) {
  const err = new Error(message);
  err.status = status;
  throw err;
}
const lotSelect = `SELECT i.*,p.name,p.brand,p.description,p.unit,p.visual,p.category_id,p.vendor_id,p.active,c.name AS category_name,u.name AS vendor_name FROM inventory i JOIN products p ON p.id=i.product_id JOIN categories c ON c.id=p.category_id JOIN users u ON u.id=p.vendor_id`;

export function createApp(db) {
  const app = express();
  // Trust only the explicitly configured number of reverse proxies.
  // Render's edge terminates HTTPS; this also gives rate limiting the client IP.
  const proxyHops = z.coerce
    .number()
    .int()
    .min(0)
    .max(5)
    .parse(process.env.TRUST_PROXY_HOPS || '0');
  if (proxyHops > 0) app.set('trust proxy', proxyHops);
  app.disable('x-powered-by');
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          imgSrc: ["'self'", 'data:'],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          fontSrc: ["'self'"],
        },
      },
    })
  );
  app.use(express.json({ limit: '32kb' }));
  app.use('/api', (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      if (req.headers['sec-fetch-site'] === 'cross-site')
        return res.status(403).json({ error: 'Yêu cầu khác nguồn bị từ chối.' });
      const origin = req.headers.origin;
      const allowed = new Set([
        process.env.APP_ORIGIN,
        `http://${req.headers.host}`,
        `https://${req.headers.host}`,
      ]);
      if (process.env.NODE_ENV !== 'production')
        ['http://localhost:5173', 'http://127.0.0.1:5173'].forEach((v) => allowed.add(v));
      if (origin && !allowed.has(origin))
        return res.status(403).json({ error: 'Nguồn yêu cầu không được phép.' });
      if (!req.is('application/json'))
        return res.status(415).json({ error: 'Yêu cầu phải dùng JSON.' });
    }
    next();
  });
  app.use(authenticate(db));
  const authLimit = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 40,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: 'Quá nhiều yêu cầu. Vui lòng thử lại sau 15 phút.' },
  });
  const settings = () =>
    Object.fromEntries(
      db
        .prepare('SELECT * FROM settings')
        .all()
        .map((r) => [r.key, JSON.parse(r.value)])
    );
  const priced = (lot) => priceLot(lot, settings().discount_tiers);
  const audit = (user, action, type, id, details = {}) =>
    db
      .prepare(
        'INSERT INTO audit_logs(actor_id,action,entity_type,entity_id,details) VALUES (?,?,?,?,?)'
      )
      .run(user.id, action, type, String(id), JSON.stringify(details));
  const getLot = (id) => {
    const lot = db.prepare(`${lotSelect} WHERE i.id=?`).get(id);
    if (!lot) fail(404, 'Không tìm thấy lô hàng.');
    return priced(lot);
  };
  function assertSellable(lot, quantity) {
    if (!lot.active || lot.expired) fail(409, `${lot.name} đã ngừng bán hoặc hết hạn.`);
    if (quantity > lot.stock) fail(409, `${lot.name} chỉ còn ${lot.stock} sản phẩm.`);
  }
  function cartFor(userId) {
    const items = db
      .prepare('SELECT inventory_id,quantity FROM cart_items WHERE user_id=?')
      .all(userId)
      .map((row) => ({ ...getLot(row.inventory_id), quantity: row.quantity }));
    const subtotal = items.reduce((sum, row) => sum + (row.price || 0) * row.quantity, 0);
    const config = settings();
    const shipping_fee =
      !items.length || subtotal >= config.free_shipping_threshold ? 0 : config.shipping_fee;
    return {
      items,
      subtotal,
      shipping_fee,
      total: subtotal + shipping_fee,
      savings: items.reduce(
        (sum, row) => sum + (row.original_price - (row.price || row.original_price)) * row.quantity,
        0
      ),
    };
  }

  app.get('/api/health', (req, res) => res.json({ status: 'ok' }));
  app.get('/api/settings', (req, res) => res.json(settings()));
  app.get('/api/auth/me', (req, res) => res.json({ user: req.user || null }));
  app.post(
    '/api/auth/register',
    authLimit,
    asyncRoute(async (req, res) => {
      const data = z
        .object({
          name: z.string().trim().min(2).max(80),
          email: z.string().trim().email().max(200),
          password: z.string().min(10).max(128),
        })
        .parse(req.body);
      if (db.prepare('SELECT id FROM users WHERE email=?').get(data.email))
        fail(409, 'Email đã được sử dụng.');
      const hash = await hashPassword(data.password);
      const result = db
        .prepare("INSERT INTO users(name,email,password_hash,role) VALUES (?,?,?,'customer')")
        .run(data.name, data.email.toLowerCase(), hash);
      createSession(db, res, Number(result.lastInsertRowid));
      res.status(201).json({
        user: {
          id: Number(result.lastInsertRowid),
          name: data.name,
          email: data.email.toLowerCase(),
          role: 'customer',
        },
      });
    })
  );
  app.post(
    '/api/auth/login',
    authLimit,
    asyncRoute(async (req, res) => {
      const data = z
        .object({ email: z.string().trim().email().max(200), password: z.string().min(1).max(128) })
        .parse(req.body);
      const user = db.prepare('SELECT * FROM users WHERE email=?').get(data.email);
      // Run a password derivation even for unknown accounts.
      const dummyHash = '00000000000000000000000000000000:' + '0'.repeat(128);
      const valid = await verifyPassword(data.password, user?.password_hash || dummyHash);
      if (!valid || !user?.active) fail(401, 'Email hoặc mật khẩu không đúng.');
      createSession(db, res, user.id);
      res.json({ user: { id: user.id, name: user.name, email: user.email, role: user.role } });
    })
  );
  app.post('/api/auth/logout', (req, res) => {
    const token = getSessionToken(req);
    if (token) db.prepare('DELETE FROM sessions WHERE token_hash=?').run(hashToken(token));
    res.clearCookie('session', { path: '/' });
    res.json({ ok: true });
  });
  app.get('/api/categories', (req, res) =>
    res.json(db.prepare('SELECT * FROM categories ORDER BY id').all())
  );
  app.post('/api/categories', requireRoles(...staff), (req, res) => {
    const data = z
      .object({
        name: z.string().trim().min(2).max(80),
        slug: z
          .string()
          .regex(/^[a-z0-9-]+$/)
          .max(80),
      })
      .parse(req.body);
    const r = db
      .prepare('INSERT INTO categories(name,slug) VALUES (?,?)')
      .run(data.name, data.slug);
    res.status(201).json({ id: Number(r.lastInsertRowid), ...data });
  });
  app.patch('/api/categories/:id', requireRoles(...staff), (req, res) => {
    const id = idSchema.parse(req.params.id);
    const data = z
      .object({
        name: z.string().trim().min(2).max(80),
        slug: z
          .string()
          .regex(/^[a-z0-9-]+$/)
          .max(80),
      })
      .parse(req.body);
    if (
      !db.prepare('UPDATE categories SET name=?,slug=? WHERE id=?').run(data.name, data.slug, id)
        .changes
    )
      fail(404, 'Không tìm thấy danh mục.');
    res.json({ id, ...data });
  });
  app.get('/api/products', (req, res) => {
    const query = z
      .object({
        q: z.string().max(120).optional(),
        category: z.coerce.number().int().positive().optional(),
        expiry: z.enum(['all', '3', '7', '14']).default('all'),
        sort: z.enum(['recommended', 'price_asc', 'expiry', 'discount']).default('recommended'),
        page: z.coerce.number().int().min(1).max(10000).default(1),
      })
      .parse(req.query);
    let rows = db
      .prepare(`${lotSelect} WHERE p.active=1 AND i.stock>0 AND i.expiry_date>=? ORDER BY i.id`)
      .all(todayVN())
      .map(priced);
    if (query.q) {
      const normalize = (v) =>
        v
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .replace(/đ/g, 'd')
          .toLowerCase();
      rows = rows.filter((r) => normalize(`${r.name} ${r.brand}`).includes(normalize(query.q)));
    }
    if (query.category) rows = rows.filter((r) => r.category_id === query.category);
    if (query.expiry !== 'all') rows = rows.filter((r) => r.days_left <= Number(query.expiry));
    if (query.sort === 'price_asc') rows.sort((a, b) => a.price - b.price);
    if (query.sort === 'expiry') rows.sort((a, b) => a.days_left - b.days_left);
    if (query.sort === 'discount') rows.sort((a, b) => b.discount_percent - a.discount_percent);
    res.json({
      items: rows.slice((query.page - 1) * 24, query.page * 24),
      total: rows.length,
      page: query.page,
      page_size: 24,
    });
  });
  app.get('/api/products/:id', (req, res) => {
    const lot = getLot(idSchema.parse(req.params.id));
    if (!lot.active) fail(404, 'Sản phẩm đã ngừng bán.');
    const reviews = db
      .prepare(
        "SELECT r.rating,r.content,r.created_at,u.name FROM reviews r JOIN users u ON u.id=r.user_id WHERE r.product_id=? AND r.status='approved' ORDER BY r.id DESC"
      )
      .all(lot.product_id);
    res.json({ ...lot, reviews });
  });

  app.get('/api/cart', requireRoles('customer'), (req, res) => res.json(cartFor(req.user.id)));
  app.post('/api/cart/merge', requireRoles('customer'), (req, res) => {
    const { items } = z
      .object({
        items: z
          .array(z.object({ id: integer.positive(), quantity: integer.min(1).max(99) }))
          .max(99),
      })
      .parse(req.body);
    db.transaction(() => {
      for (const item of items) {
        const old =
          db
            .prepare('SELECT quantity FROM cart_items WHERE user_id=? AND inventory_id=?')
            .get(req.user.id, item.id)?.quantity || 0;
        const quantity = old + item.quantity;
        if (quantity > 99) fail(409, 'Mỗi lô được mua tối đa 99 sản phẩm.');
        assertSellable(getLot(item.id), quantity);
        db.prepare(
          'INSERT INTO cart_items VALUES (?,?,?) ON CONFLICT(user_id,inventory_id) DO UPDATE SET quantity=excluded.quantity'
        ).run(req.user.id, item.id, quantity);
      }
    }).immediate();
    res.json(cartFor(req.user.id));
  });
  app.put('/api/cart/:id', requireRoles('customer'), (req, res) => {
    const id = idSchema.parse(req.params.id);
    const { quantity } = z.object({ quantity: integer.min(0).max(99) }).parse(req.body);
    if (!quantity)
      db.prepare('DELETE FROM cart_items WHERE user_id=? AND inventory_id=?').run(req.user.id, id);
    else {
      assertSellable(getLot(id), quantity);
      db.prepare(
        'INSERT INTO cart_items VALUES (?,?,?) ON CONFLICT(user_id,inventory_id) DO UPDATE SET quantity=excluded.quantity'
      ).run(req.user.id, id, quantity);
    }
    res.json(cartFor(req.user.id));
  });
  app.post('/api/orders', requireRoles('customer'), (req, res) => {
    const data = z
      .object({
        recipient: z.string().trim().min(2).max(80),
        phone: z
          .string()
          .trim()
          .regex(/^(?:\+84|0)[0-9]{9,10}$/, 'Số điện thoại không hợp lệ'),
        address: z.string().trim().min(10).max(300),
        note: z.string().trim().max(500).default(''),
        payment_method: z.literal('cod'),
        request_key: z.string().uuid(),
        expected_total: integer.min(0),
      })
      .parse(req.body);
    const orderId = db
      .transaction(() => {
        const existing = db
          .prepare('SELECT id FROM orders WHERE customer_id=? AND request_key=?')
          .get(req.user.id, data.request_key);
        if (existing) return existing.id;
        const cart = cartFor(req.user.id);
        if (!cart.items.length) fail(400, 'Giỏ hàng đang trống.');
        cart.items.forEach((item) => assertSellable(item, item.quantity));
        if (cart.total !== data.expected_total)
          fail(409, 'Giá hoặc phí giao hàng đã thay đổi. Vui lòng kiểm tra giỏ hàng rồi đặt lại.');
        const result = db
          .prepare(
            'INSERT INTO orders(customer_id,request_key,recipient,phone,address,note,subtotal,shipping_fee,total) VALUES (?,?,?,?,?,?,?,?,?)'
          )
          .run(
            req.user.id,
            data.request_key,
            data.recipient,
            data.phone,
            data.address,
            data.note,
            cart.subtotal,
            cart.shipping_fee,
            cart.total
          );
        const id = Number(result.lastInsertRowid);
        for (const row of cart.items) {
          if (
            !db
              .prepare('UPDATE inventory SET stock=stock-?,updated_at=? WHERE id=? AND stock>=?')
              .run(row.quantity, new Date().toISOString(), row.id, row.quantity).changes
          )
            fail(409, 'Tồn kho vừa thay đổi. Vui lòng thử lại.');
          db.prepare(
            'INSERT INTO order_items(order_id,inventory_id,vendor_id,product_name,expiry_date,quantity,original_price,unit_price,discount_percent) VALUES (?,?,?,?,?,?,?,?,?)'
          ).run(
            id,
            row.id,
            row.vendor_id,
            row.name,
            row.expiry_date,
            row.quantity,
            row.original_price,
            row.price,
            row.discount_percent
          );
        }
        db.prepare('DELETE FROM cart_items WHERE user_id=?').run(req.user.id);
        audit(req.user, 'create', 'order', id);
        return id;
      })
      .immediate();
    res.status(201).json({ id: orderId, message: 'Đặt hàng thành công.' });
  });
  function hydrateOrders(rows) {
    return rows.map((order) => ({
      ...order,
      items: db
        .prepare(
          'SELECT oi.*,i.product_id FROM order_items oi JOIN inventory i ON i.id=oi.inventory_id WHERE order_id=?'
        )
        .all(order.id),
    }));
  }
  app.get('/api/orders', requireRoles(...roles), (req, res) => {
    if (req.user.role === 'vendor') {
      const rows = db
        .prepare(
          'SELECT DISTINCT o.id,o.status,o.created_at FROM orders o JOIN order_items oi ON oi.order_id=o.id WHERE oi.vendor_id=? ORDER BY o.id DESC'
        )
        .all(req.user.id);
      return res.json(
        rows.map((o) => ({
          ...o,
          items: db
            .prepare(
              'SELECT product_name,quantity,unit_price,expiry_date FROM order_items WHERE order_id=? AND vendor_id=?'
            )
            .all(o.id, req.user.id),
        }))
      );
    }
    const filter =
      req.user.role === 'customer'
        ? 'WHERE customer_id=?'
        : req.user.role === 'shipper'
          ? "WHERE shipper_id=? OR (status='confirmed' AND shipper_id IS NULL)"
          : '';
    const rows = db
      .prepare(`SELECT * FROM orders ${filter} ORDER BY id DESC LIMIT 200`)
      .all(...(filter ? [req.user.id] : []));
    res.json(hydrateOrders(rows));
  });
  app.patch(
    '/api/orders/:id/status',
    requireRoles('admin', 'manager', 'customer', 'shipper'),
    (req, res) => {
      const id = idSchema.parse(req.params.id);
      const { status } = z
        .object({ status: z.enum(['confirmed', 'shipping', 'delivered', 'failed', 'cancelled']) })
        .parse(req.body);
      db.transaction(() => {
        const order = db.prepare('SELECT * FROM orders WHERE id=?').get(id);
        if (!order) fail(404, 'Không tìm thấy đơn hàng.');
        const isStaff = staff.includes(req.user.role);
        if (
          req.user.role === 'customer' &&
          (order.customer_id !== req.user.id ||
            status !== 'cancelled' ||
            order.status !== 'pending')
        )
          fail(403, 'Bạn chỉ có thể hủy đơn của mình khi đang chờ xác nhận.');
        if (req.user.role === 'shipper') {
          if (status === 'shipping') {
            if (order.status !== 'confirmed' || order.shipper_id)
              fail(409, 'Đơn này không còn sẵn sàng để nhận.');
          } else if (
            order.shipper_id !== req.user.id ||
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
        if (isStaff && ['shipping', 'delivered', 'failed'].includes(status))
          fail(400, 'Nhân viên giao hàng phụ trách cập nhật quá trình giao.');
        if (['confirmed', 'shipping'].includes(status)) {
          const expired = db
            .prepare('SELECT id FROM order_items WHERE order_id=? AND expiry_date<?')
            .get(id, todayVN());
          if (expired) fail(409, 'Đơn chứa hàng đã hết hạn. Vui lòng hủy đơn.');
        }
        if (status === 'cancelled')
          for (const item of db.prepare('SELECT * FROM order_items WHERE order_id=?').all(id))
            db.prepare('UPDATE inventory SET stock=stock+?,updated_at=? WHERE id=?').run(
              item.quantity,
              new Date().toISOString(),
              item.inventory_id
            );
        const shipper =
          status === 'shipping' ? req.user.id : status === 'confirmed' ? null : order.shipper_id;
        db.prepare(
          'UPDATE orders SET status=?,shipper_id=?,payment_status=?,updated_at=? WHERE id=?'
        ).run(
          status,
          shipper,
          status === 'delivered' ? 'paid' : 'unpaid',
          new Date().toISOString(),
          id
        );
        audit(req.user, 'status', 'order', id, { from: order.status, to: status });
      }).immediate();
      res.json({ ok: true });
    }
  );

  app.get('/api/manage/products', requireRoles(...staff, 'vendor'), (req, res) => {
    const own = req.user.role === 'vendor';
    res.json(
      db
        .prepare(`${lotSelect} ${own ? 'WHERE p.vendor_id=?' : ''} ORDER BY i.id DESC`)
        .all(...(own ? [req.user.id] : []))
        .map(priced)
    );
  });
  app.post('/api/manage/products', requireRoles(...staff, 'vendor'), (req, res) => {
    const data = productSchema.parse(req.body);
    const vendor = req.user.role === 'vendor' ? req.user.id : data.vendor_id;
    if (
      !vendor ||
      !db.prepare("SELECT id FROM users WHERE id=? AND role='vendor' AND active=1").get(vendor)
    )
      fail(400, 'Cần chọn nhà cung cấp đang hoạt động.');
    if (!db.prepare('SELECT id FROM categories WHERE id=?').get(data.category_id))
      fail(400, 'Danh mục không tồn tại.');
    if (data.expiry_date < todayVN()) fail(400, 'Không thể đăng bán hàng đã hết hạn.');
    const id = db
      .transaction(() => {
        const p = db
          .prepare(
            'INSERT INTO products(vendor_id,category_id,name,brand,description,unit,visual) VALUES (?,?,?,?,?,?,?)'
          )
          .run(
            vendor,
            data.category_id,
            data.name,
            data.brand,
            data.description,
            data.unit,
            data.visual
          );
        const i = db
          .prepare(
            'INSERT INTO inventory(product_id,lot_code,expiry_date,original_price,stock) VALUES (?,?,?,?,?)'
          )
          .run(p.lastInsertRowid, data.lot_code, data.expiry_date, data.original_price, data.stock);
        audit(req.user, 'create', 'inventory', i.lastInsertRowid);
        return Number(i.lastInsertRowid);
      })
      .immediate();
    res.status(201).json(getLot(id));
  });
  app.patch('/api/manage/products/:id', requireRoles(...staff, 'vendor'), (req, res) => {
    const id = idSchema.parse(req.params.id);
    const data = z
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
      .parse(req.body);
    db.transaction(() => {
      const lot = getLot(id);
      if (req.user.role === 'vendor' && lot.vendor_id !== req.user.id)
        fail(403, 'Bạn chỉ được sửa hàng của mình.');
      if (
        data.category_id &&
        !db.prepare('SELECT id FROM categories WHERE id=?').get(data.category_id)
      )
        fail(400, 'Danh mục không tồn tại.');
      // Expiry is an immutable purchase snapshot; do not rewrite it on a sold lot.
      if (
        data.expiry_date &&
        data.expiry_date !== lot.expiry_date &&
        db.prepare('SELECT id FROM order_items WHERE inventory_id=? LIMIT 1').get(id)
      )
        fail(409, 'Lô đã phát sinh đơn hàng. Hãy tạo lô mới nếu cần đổi hạn sử dụng.');
      db.prepare(
        'UPDATE inventory SET expiry_date=?,stock=?,original_price=?,updated_at=? WHERE id=?'
      ).run(
        data.expiry_date ?? lot.expiry_date,
        data.stock ?? lot.stock,
        data.original_price ?? lot.original_price,
        new Date().toISOString(),
        id
      );
      db.prepare('UPDATE products SET active=?,name=?,category_id=?,description=? WHERE id=?').run(
        data.active === undefined ? lot.active : Number(data.active),
        data.name ?? lot.name,
        data.category_id ?? lot.category_id,
        data.description ?? lot.description,
        lot.product_id
      );
      audit(req.user, 'update', 'inventory', id, data);
    }).immediate();
    res.json(getLot(id));
  });
  app.post('/api/manage/products/:id/lots', requireRoles(...staff, 'vendor'), (req, res) => {
    const lot = getLot(idSchema.parse(req.params.id));
    if (req.user.role === 'vendor' && lot.vendor_id !== req.user.id)
      fail(403, 'Bạn chỉ được thêm lô cho hàng của mình.');
    const data = productSchema
      .pick({ expiry_date: true, original_price: true, stock: true, lot_code: true })
      .parse(req.body);
    if (data.expiry_date < todayVN()) fail(400, 'Không thể nhập lô đã hết hạn.');
    const r = db
      .prepare(
        'INSERT INTO inventory(product_id,lot_code,expiry_date,original_price,stock) VALUES (?,?,?,?,?)'
      )
      .run(lot.product_id, data.lot_code, data.expiry_date, data.original_price, data.stock);
    audit(req.user, 'create', 'inventory', r.lastInsertRowid);
    res.status(201).json(getLot(Number(r.lastInsertRowid)));
  });
  app.get('/api/manage/vendors', requireRoles(...staff), (req, res) =>
    res.json(db.prepare("SELECT id,name FROM users WHERE role='vendor' AND active=1").all())
  );
  app.get('/api/reports', requireRoles('admin', 'vendor'), (req, res) => {
    const own = req.user.role === 'vendor';
    const where = own ? 'WHERE oi.vendor_id=?' : '';
    const args = own ? [req.user.id] : [];
    const summary = db
      .prepare(
        `SELECT COALESCE(SUM(CASE WHEN o.status='delivered' THEN oi.unit_price*oi.quantity ELSE 0 END),0) AS revenue,COUNT(DISTINCT o.id) AS orders,COALESCE(SUM(CASE WHEN o.status='delivered' THEN oi.quantity ELSE 0 END),0) AS units FROM order_items oi JOIN orders o ON o.id=oi.order_id ${where}`
      )
      .get(...args);
    const daily = db
      .prepare(
        `SELECT date(o.created_at,'+7 hours') AS day,SUM(oi.quantity*oi.unit_price) AS revenue FROM order_items oi JOIN orders o ON o.id=oi.order_id WHERE o.status='delivered' ${own ? 'AND oi.vendor_id=?' : ''} GROUP BY day ORDER BY day DESC LIMIT 30`
      )
      .all(...args);
    res.json({ ...summary, daily });
  });
  app.post('/api/reviews', requireRoles('customer'), (req, res) => {
    const data = z
      .object({
        product_id: integer.positive(),
        rating: integer.min(1).max(5),
        content: z.string().trim().min(5).max(1000),
      })
      .parse(req.body);
    const purchased = db
      .prepare(
        "SELECT oi.id FROM order_items oi JOIN orders o ON o.id=oi.order_id JOIN inventory i ON i.id=oi.inventory_id WHERE o.customer_id=? AND o.status='delivered' AND i.product_id=?"
      )
      .get(req.user.id, data.product_id);
    if (!purchased) fail(403, 'Chỉ có thể đánh giá sản phẩm đã nhận thành công.');
    db.prepare(
      "INSERT INTO reviews(user_id,product_id,rating,content) VALUES (?,?,?,?) ON CONFLICT(user_id,product_id) DO UPDATE SET rating=excluded.rating,content=excluded.content,status='pending'"
    ).run(req.user.id, data.product_id, data.rating, data.content);
    res.status(201).json({ message: 'Đánh giá đã gửi và đang chờ duyệt.' });
  });
  app.get('/api/manage/reviews', requireRoles(...staff), (req, res) =>
    res.json(
      db
        .prepare(
          'SELECT r.*,u.name AS customer_name,p.name AS product_name FROM reviews r JOIN users u ON u.id=r.user_id JOIN products p ON p.id=r.product_id ORDER BY r.id DESC LIMIT 200'
        )
        .all()
    )
  );
  app.patch('/api/manage/reviews/:id', requireRoles(...staff), (req, res) => {
    const id = idSchema.parse(req.params.id);
    const { status } = z.object({ status: z.enum(['approved', 'rejected']) }).parse(req.body);
    if (!db.prepare('UPDATE reviews SET status=? WHERE id=?').run(status, id).changes)
      fail(404, 'Không tìm thấy đánh giá.');
    audit(req.user, 'moderate', 'review', id, { status });
    res.json({ ok: true });
  });
  app.get('/api/admin/users', requireRoles('admin'), (req, res) =>
    res.json(db.prepare('SELECT id,name,email,role,active,created_at FROM users ORDER BY id').all())
  );
  app.patch('/api/admin/users/:id', requireRoles('admin'), (req, res) => {
    const id = idSchema.parse(req.params.id);
    const data = z.object({ role: z.enum(roles), active: z.boolean() }).parse(req.body);
    db.transaction(() => {
      if (id === req.user.id)
        fail(400, 'Không thể tự thay đổi vai trò hoặc khóa tài khoản đang dùng.');
      const user = db.prepare('SELECT * FROM users WHERE id=?').get(id);
      if (!user) fail(404, 'Không tìm thấy tài khoản.');
      if (
        user.role === 'vendor' &&
        data.role !== 'vendor' &&
        db.prepare('SELECT id FROM products WHERE vendor_id=? LIMIT 1').get(id)
      )
        fail(409, 'Nhà cung cấp còn sản phẩm. Hãy khóa tài khoản thay vì đổi vai trò.');
      if (
        user.role === 'shipper' &&
        data.role !== 'shipper' &&
        db.prepare("SELECT id FROM orders WHERE shipper_id=? AND status='shipping'").get(id)
      )
        fail(409, 'Nhân viên còn đơn đang giao.');
      db.prepare('UPDATE users SET role=?,active=? WHERE id=?').run(
        data.role,
        Number(data.active),
        id
      );
      db.prepare('DELETE FROM sessions WHERE user_id=?').run(id);
      audit(req.user, 'update', 'user', id, data);
    }).immediate();
    res.json({ ok: true });
  });
  app.patch('/api/admin/settings', requireRoles('admin'), (req, res) => {
    const data = z
      .object({
        shipping_fee: integer.min(0).max(1000000),
        free_shipping_threshold: integer.min(0).max(100000000),
        discount_tiers: z
          .array(z.object({ days: integer.min(0).max(365), percent: integer.min(0).max(95) }))
          .min(1)
          .max(8)
          .refine((v) => new Set(v.map((t) => t.days)).size === v.length, 'Mốc ngày phải khác nhau')
          .refine((v) => {
            const sorted = [...v].sort((a, b) => a.days - b.days);
            return sorted.every((t, i) => i === 0 || t.percent <= sorted[i - 1].percent);
          }, 'Hàng gần hết hạn hơn phải được giảm nhiều hơn hoặc bằng'),
      })
      .parse(req.body);
    db.transaction(() => {
      for (const [key, value] of Object.entries(data))
        db.prepare('UPDATE settings SET value=? WHERE key=?').run(JSON.stringify(value), key);
      audit(req.user, 'update', 'settings', 'all', data);
    }).immediate();
    res.json(settings());
  });
  app.get('/api/admin/audit', requireRoles('admin'), (req, res) =>
    res.json(
      db
        .prepare(
          'SELECT a.*,u.name AS actor_name FROM audit_logs a JOIN users u ON u.id=a.actor_id ORDER BY a.id DESC LIMIT 100'
        )
        .all()
    )
  );
  app.use('/api', (req, res) => res.status(404).json({ error: 'API không tồn tại.' }));
  app.use((err, req, res, next) => {
    if (err instanceof z.ZodError)
      return res.status(400).json({
        error: 'Dữ liệu không hợp lệ.',
        details: err.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
      });
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE')
      return res
        .status(409)
        .json({ error: 'Thông tin bị trùng. Kiểm tra email, mã lô hoặc danh mục.' });
    if (err.type === 'entity.parse.failed')
      return res.status(400).json({ error: 'JSON không hợp lệ.' });
    if (err.status && err.status < 500) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Có lỗi máy chủ. Vui lòng thử lại.' });
  });
  return app;
}
