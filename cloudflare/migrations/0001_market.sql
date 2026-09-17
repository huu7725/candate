PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL COLLATE NOCASE UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'customer' CHECK (role IN ('admin','manager','customer','vendor','shipper')),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, slug TEXT NOT NULL UNIQUE
);
CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY,
  vendor_id INTEGER NOT NULL REFERENCES users(id),
  category_id INTEGER NOT NULL REFERENCES categories(id),
  name TEXT NOT NULL,
  brand TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  unit TEXT NOT NULL DEFAULT 'sản phẩm',
  visual TEXT NOT NULL DEFAULT 'oat' CHECK (visual IN ('oat','granola','juice','coffee','pasta','tea')),
  search_text TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
-- A product can have several lots with different expiry dates and prices.
CREATE TABLE IF NOT EXISTS inventory (
  id INTEGER PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(id),
  lot_code TEXT NOT NULL UNIQUE,
  expiry_date TEXT NOT NULL CHECK (length(expiry_date)=10 AND expiry_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  original_price INTEGER NOT NULL CHECK (original_price > 0),
  stock INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_inventory_expiry ON inventory(expiry_date,stock);
CREATE INDEX IF NOT EXISTS idx_products_vendor ON products(vendor_id);
CREATE TABLE IF NOT EXISTS cart_items (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  inventory_id INTEGER NOT NULL REFERENCES inventory(id),
  quantity INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 99),
  PRIMARY KEY(user_id,inventory_id)
);
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES users(id),
  shipper_id INTEGER REFERENCES users(id),
  request_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','confirmed','shipping','delivered','failed','cancelled')),
  recipient TEXT NOT NULL, phone TEXT NOT NULL, address TEXT NOT NULL, note TEXT NOT NULL DEFAULT '',
  payment_method TEXT NOT NULL DEFAULT 'cod' CHECK (payment_method = 'cod'),
  payment_status TEXT NOT NULL DEFAULT 'unpaid' CHECK (payment_status IN ('unpaid','paid')),
  subtotal INTEGER NOT NULL CHECK (subtotal >= 0),
  shipping_fee INTEGER NOT NULL CHECK (shipping_fee >= 0),
  total INTEGER NOT NULL CHECK (total = subtotal + shipping_fee),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE(customer_id,request_key)
);
CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders(customer_id,created_at);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status,shipper_id);
CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES orders(id),
  inventory_id INTEGER NOT NULL REFERENCES inventory(id),
  vendor_id INTEGER NOT NULL REFERENCES users(id),
  product_name TEXT NOT NULL,
  expiry_date TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  original_price INTEGER NOT NULL CHECK (original_price > 0),
  unit_price INTEGER NOT NULL CHECK (unit_price >= 0),
  discount_percent INTEGER NOT NULL CHECK (discount_percent BETWEEN 0 AND 100)
);
CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_order_items_vendor ON order_items(vendor_id);
CREATE TABLE IF NOT EXISTS reviews (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  product_id INTEGER NOT NULL REFERENCES products(id),
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  content TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE(user_id,product_id)
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY,
  actor_id INTEGER NOT NULL REFERENCES users(id),
  action TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL,
  details TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- A failing CHECK rolls back an entire D1 batch, including stock changes.
CREATE TABLE IF NOT EXISTS operation_guards (
  id TEXT PRIMARY KEY,
  ok INTEGER NOT NULL CHECK (ok=1)
);
CREATE TABLE IF NOT EXISTS auth_attempts (
  id TEXT PRIMARY KEY,
  attempts INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_auth_attempts_expiry ON auth_attempts(expires_at);
INSERT OR IGNORE INTO settings(key,value) VALUES
  ('discount_tiers','[{"days":3,"percent":80},{"days":7,"percent":50},{"days":14,"percent":30}]'),
  ('shipping_fee','25000'),
  ('free_shipping_threshold','199000');
INSERT OR IGNORE INTO categories(name,slug) VALUES
  ('Sữa & đồ uống','sua-do-uong'),
  ('Bánh & ngũ cốc','banh-ngu-coc'),
  ('Thực phẩm khô','thuc-pham-kho'),
  ('Trà & cà phê','tra-ca-phe');
