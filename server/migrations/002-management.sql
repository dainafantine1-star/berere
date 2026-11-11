ALTER TABLE admin_users ADD COLUMN is_owner INTEGER NOT NULL DEFAULT 0 CHECK(is_owner IN (0,1));
CREATE UNIQUE INDEX single_owner ON admin_users(is_owner) WHERE is_owner=1;
ALTER TABLE products ADD COLUMN sku TEXT COLLATE NOCASE;
UPDATE products SET sku=reference;
CREATE UNIQUE INDEX products_sku ON products(sku COLLATE NOCASE);
ALTER TABLE products ADD COLUMN dimensions TEXT NOT NULL DEFAULT '';
ALTER TABLE products ADD COLUMN length_mm INTEGER CHECK(length_mm IS NULL OR (typeof(length_mm)='integer' AND length_mm>0));
ALTER TABLE products ADD COLUMN unit TEXT NOT NULL DEFAULT 'un' CHECK(unit IN ('un','m','m2','m3','pacote'));
ALTER TABLE products ADD COLUMN status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','promotion','unavailable'));
ALTER TABLE products ADD COLUMN featured INTEGER NOT NULL DEFAULT 0 CHECK(featured IN (0,1));
ALTER TABLE products ADD COLUMN stock INTEGER CHECK(stock IS NULL OR (typeof(stock)='integer' AND stock>=0));
ALTER TABLE products ADD COLUMN low_stock INTEGER NOT NULL DEFAULT 5 CHECK(typeof(low_stock)='integer' AND low_stock>=0);
ALTER TABLE products ADD COLUMN deleted_at TEXT;
ALTER TABLE products ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE categories ADD COLUMN slug TEXT;
UPDATE categories SET slug=id;
CREATE UNIQUE INDEX categories_slug ON categories(slug);
ALTER TABLE categories ADD COLUMN image TEXT NOT NULL DEFAULT '';
ALTER TABLE categories ADD COLUMN icon TEXT NOT NULL DEFAULT '';
ALTER TABLE categories ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;
ALTER TABLE categories ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
CREATE INDEX products_management ON products(deleted_at,status,featured,category_id);
CREATE INDEX products_stock ON products(stock);
CREATE TABLE audit_log (
 id INTEGER PRIMARY KEY, actor_id INTEGER NOT NULL REFERENCES admin_users(id) ON DELETE RESTRICT,
 actor_email TEXT NOT NULL, action TEXT NOT NULL, entity TEXT NOT NULL, entity_id TEXT NOT NULL,
 before_json TEXT CHECK(before_json IS NULL OR json_valid(before_json)),
 after_json TEXT CHECK(after_json IS NULL OR json_valid(after_json)),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX audit_entity ON audit_log(entity,entity_id,created_at);
CREATE INDEX audit_actor ON audit_log(actor_id,created_at);
CREATE TRIGGER audit_no_update BEFORE UPDATE ON audit_log BEGIN SELECT RAISE(ABORT,'audit is immutable'); END;
CREATE TRIGGER audit_no_delete BEFORE DELETE ON audit_log BEGIN SELECT RAISE(ABORT,'audit is immutable'); END;
CREATE TABLE media (
 id TEXT PRIMARY KEY, filename TEXT NOT NULL UNIQUE, original_name TEXT NOT NULL,
 mime TEXT NOT NULL CHECK(mime='image/webp'), bytes INTEGER NOT NULL CHECK(bytes>0),
 width INTEGER NOT NULL, height INTEGER NOT NULL,
 created_by INTEGER NOT NULL REFERENCES admin_users(id), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE import_previews (
 id TEXT PRIMARY KEY, actor_id INTEGER NOT NULL REFERENCES admin_users(id),
 payload_json TEXT NOT NULL CHECK(json_valid(payload_json)), expires_at INTEGER NOT NULL,
 applied_at TEXT, result_json TEXT CHECK(result_json IS NULL OR json_valid(result_json))
);
CREATE INDEX import_expiry ON import_previews(expires_at);
CREATE TABLE login_attempts (
 key TEXT PRIMARY KEY, attempts INTEGER NOT NULL, reset_at INTEGER NOT NULL
);
