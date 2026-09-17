// D1 batch() executes the full list as one transaction and rolls it back on any
// failing statement. Guards turn stale reads into CHECK failures, so a checkout
// never overwrites a concurrent stock change or silently charges a changed price.
export const statement = (db, sql, ...params) => db.prepare(sql).bind(...params);
export async function all(db, sql, ...params) {
  return (await statement(db, sql, ...params).all()).results;
}
export const first = (db, sql, ...params) => statement(db, sql, ...params).first();
export const run = (db, sql, ...params) => statement(db, sql, ...params).run();
export function guard(db, key, condition, params = []) {
  return statement(
    db,
    `INSERT INTO operation_guards(id,ok) SELECT ?,CASE WHEN (${condition}) THEN 1 ELSE 0 END`,
    key,
    ...params
  );
}
export const clearGuard = (db, key) =>
  statement(db, 'DELETE FROM operation_guards WHERE id=?', key);
export const audit = (db, user, action, type, id, details = {}) =>
  statement(
    db,
    'INSERT INTO audit_logs(actor_id,action,entity_type,entity_id,details) VALUES (?,?,?,?,?)',
    user.id,
    action,
    type,
    String(id),
    JSON.stringify(details)
  );
export async function settings(db) {
  return Object.fromEntries(
    (await all(db, 'SELECT * FROM settings')).map((r) => [r.key, JSON.parse(r.value)])
  );
}

const DAYS = "CAST(julianday(i.expiry_date)-julianday(date('now','+7 hours')) AS INTEGER)";
export const LOTS = `WITH lots AS (
  SELECT i.*,p.name,p.brand,p.description,p.unit,p.visual,p.category_id,p.vendor_id,p.active,p.search_text,
  c.name AS category_name,u.name AS vendor_name,${DAYS} AS days_left
  FROM inventory i JOIN products p ON p.id=i.product_id JOIN categories c ON c.id=p.category_id JOIN users u ON u.id=p.vendor_id
), discounted AS (
  SELECT lots.*,CASE WHEN days_left<0 THEN 0 ELSE COALESCE((SELECT CAST(json_extract(t.value,'$.percent') AS INTEGER)
    FROM settings s,json_each(s.value) t WHERE s.key='discount_tiers' AND days_left<=json_extract(t.value,'$.days')
    ORDER BY CAST(json_extract(t.value,'$.days') AS INTEGER) LIMIT 1),0) END AS discount_percent
  FROM lots
), priced AS (
  SELECT discounted.*,days_left<0 AS expired,CASE WHEN days_left<0 THEN NULL ELSE CAST(ROUND(original_price*(100-discount_percent)/100.0) AS INTEGER) END AS price
  FROM discounted
)`;
export const normalizeSearch = (v) =>
  v
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase();
export async function getLot(db, id) {
  return first(db, `${LOTS} SELECT * FROM priced WHERE id=?`, id);
}
export async function cartFor(db, userId) {
  const [items, config] = await Promise.all([
    all(
      db,
      `${LOTS} SELECT priced.*,ci.quantity FROM priced JOIN cart_items ci ON ci.inventory_id=priced.id WHERE ci.user_id=? ORDER BY priced.id`,
      userId
    ),
    settings(db),
  ]);
  const subtotal = items.reduce((sum, row) => sum + (row.price || 0) * row.quantity, 0);
  const shipping_fee =
    !items.length || subtotal >= config.free_shipping_threshold ? 0 : config.shipping_fee;
  return {
    items,
    subtotal,
    shipping_fee,
    total: subtotal + shipping_fee,
    savings: items.reduce(
      (sum, row) => sum + (row.original_price - (row.price ?? row.original_price)) * row.quantity,
      0
    ),
    config,
  };
}
export const publicCart = ({ config, ...cart }) => cart;
