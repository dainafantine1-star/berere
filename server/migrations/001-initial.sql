CREATE TABLE categories (
 id TEXT PRIMARY KEY, label TEXT NOT NULL CHECK(length(label) BETWEEN 1 AND 100), active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1))
);
CREATE TABLE products (
 id INTEGER PRIMARY KEY, reference TEXT NOT NULL UNIQUE, name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 200),
 category_id TEXT NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
 price_cents INTEGER CHECK(price_cents IS NULL OR (typeof(price_cents)='integer' AND price_cents>0)),
 old_price_cents INTEGER CHECK(old_price_cents IS NULL OR (price_cents IS NOT NULL AND typeof(old_price_cents)='integer' AND old_price_cents>price_cents)),
 description TEXT NOT NULL DEFAULT '', specs_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(specs_json)),
 image TEXT NOT NULL DEFAULT '', commercial_terms TEXT NOT NULL DEFAULT 'Preço, disponibilidade, entrega e pagamento sujeitos à confirmação.',
 active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)), updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX products_category ON products(category_id, active);
CREATE TABLE customers (
 id INTEGER PRIMARY KEY, name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 200), phone TEXT, email TEXT COLLATE NOCASE UNIQUE,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE orders (
 id TEXT PRIMARY KEY, request_key TEXT NOT NULL UNIQUE, customer_id INTEGER REFERENCES customers(id) ON DELETE RESTRICT,
 kind TEXT NOT NULL CHECK(kind IN ('quote','order')), status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','negotiating','confirmed','cancelled','completed')),
 known_total_cents INTEGER NOT NULL CHECK(known_total_cents>=0), has_consultation INTEGER NOT NULL CHECK(has_consultation IN (0,1)),
 terms_snapshot TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX orders_customer ON orders(customer_id, created_at);
CREATE INDEX orders_status ON orders(status, created_at);
CREATE TABLE order_items (
 id INTEGER PRIMARY KEY, order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
 product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
 reference_snapshot TEXT NOT NULL, name_snapshot TEXT NOT NULL, specs_snapshot TEXT NOT NULL CHECK(json_valid(specs_snapshot)),
 terms_snapshot TEXT NOT NULL, unit_price_cents INTEGER CHECK(unit_price_cents IS NULL OR unit_price_cents>0),
 quantity INTEGER NOT NULL CHECK(typeof(quantity)='integer' AND quantity BETWEEN 1 AND 99), UNIQUE(order_id,product_id)
);
CREATE INDEX order_items_product ON order_items(product_id);
CREATE TABLE banners (
 id INTEGER PRIMARY KEY, tag TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL,
 sort_order INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1))
);
CREATE INDEX banners_sort ON banners(active,sort_order);
CREATE TABLE admin_users (
 id INTEGER PRIMARY KEY, email TEXT NOT NULL COLLATE NOCASE UNIQUE, password_hash TEXT NOT NULL,
 role TEXT NOT NULL DEFAULT 'admin' CHECK(role IN ('admin','editor')), active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE admin_sessions (
 token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL
);
CREATE INDEX sessions_expiry ON admin_sessions(expires_at);
CREATE INDEX sessions_user ON admin_sessions(user_id);
CREATE TABLE company_settings (
 id INTEGER PRIMARY KEY CHECK(id=1), public_json TEXT NOT NULL CHECK(json_valid(public_json)), updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE events (
 id INTEGER PRIMARY KEY, name TEXT NOT NULL CHECK(name IN ('catalog_view','product_view','whatsapp_click','quote_created')),
 product_id INTEGER REFERENCES products(id) ON DELETE SET NULL, order_id TEXT REFERENCES orders(id) ON DELETE SET NULL,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX events_name_date ON events(name,created_at);
