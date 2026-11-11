ALTER TABLE customers ADD COLUMN phone_key TEXT;
ALTER TABLE customers ADD COLUMN address TEXT NOT NULL DEFAULT '';
ALTER TABLE customers ADD COLUMN notes TEXT NOT NULL DEFAULT '';
ALTER TABLE customers ADD COLUMN document TEXT NOT NULL DEFAULT '';
ALTER TABLE customers ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE customers ADD COLUMN updated_at TEXT NOT NULL DEFAULT '';
UPDATE customers SET updated_at=created_at;
ALTER TABLE customers ADD COLUMN contact_verified INTEGER NOT NULL DEFAULT 0 CHECK(contact_verified IN (0,1));
CREATE UNIQUE INDEX customers_phone_key ON customers(phone_key) WHERE phone_key IS NOT NULL;
ALTER TABLE products ADD COLUMN stock_milli INTEGER CHECK(stock_milli IS NULL OR (typeof(stock_milli)='integer' AND stock_milli>=0));
UPDATE products SET stock_milli=stock*1000 WHERE stock IS NOT NULL;
ALTER TABLE orders ADD COLUMN protocol TEXT;
UPDATE orders SET protocol='MP-'||upper(substr(replace(id,'-',''),1,16));
CREATE UNIQUE INDEX orders_protocol ON orders(protocol);
ALTER TABLE orders ADD COLUMN stage TEXT NOT NULL DEFAULT 'received' CHECK(stage IN ('received','in_progress','awaiting_approval','approved','completed','cancelled'));
UPDATE orders SET stage=CASE status WHEN 'negotiating' THEN 'in_progress' WHEN 'confirmed' THEN 'approved' WHEN 'completed' THEN 'completed' WHEN 'cancelled' THEN 'cancelled' ELSE 'received' END;
ALTER TABLE orders ADD COLUMN source TEXT NOT NULL DEFAULT 'storefront';
ALTER TABLE orders ADD COLUMN customer_snapshot TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(customer_snapshot));
UPDATE orders SET customer_snapshot=(SELECT json_object('name',name,'phone',phone,'email',email,'address',address) FROM customers WHERE customers.id=orders.customer_id) WHERE customer_id IS NOT NULL;
ALTER TABLE orders ADD COLUMN fulfillment TEXT NOT NULL DEFAULT 'pickup' CHECK(fulfillment IN ('pickup','delivery'));
ALTER TABLE orders ADD COLUMN delivery_address TEXT NOT NULL DEFAULT '';
ALTER TABLE orders ADD COLUMN notes TEXT NOT NULL DEFAULT '';
ALTER TABLE orders ADD COLUMN assigned_to INTEGER REFERENCES admin_users(id) ON DELETE RESTRICT;
ALTER TABLE orders ADD COLUMN final_total_cents INTEGER CHECK(final_total_cents IS NULL OR (typeof(final_total_cents)='integer' AND final_total_cents>0));
ALTER TABLE orders ADD COLUMN fingerprint TEXT;
ALTER TABLE orders ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE orders ADD COLUMN completed_at TEXT;
ALTER TABLE orders ADD COLUMN cancelled_at TEXT;
CREATE INDEX orders_stage_assignee ON orders(stage,assigned_to,created_at);
ALTER TABLE order_items RENAME TO legacy_order_items;
DROP INDEX order_items_product;
CREATE TABLE order_items (
 id INTEGER PRIMARY KEY, order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
 product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
 line_key TEXT NOT NULL, reference_snapshot TEXT NOT NULL, name_snapshot TEXT NOT NULL,
 specs_snapshot TEXT NOT NULL CHECK(json_valid(specs_snapshot)), terms_snapshot TEXT NOT NULL,
 unit_price_cents INTEGER CHECK(unit_price_cents IS NULL OR unit_price_cents>0),
 quantity REAL NOT NULL CHECK(quantity>0 AND quantity<=100000 AND abs(quantity*1000-round(quantity*1000))<0.000001),
 unit_snapshot TEXT NOT NULL DEFAULT 'un', custom_measures TEXT NOT NULL DEFAULT '', custom_specs TEXT NOT NULL DEFAULT '',
 UNIQUE(order_id,line_key)
);
INSERT INTO order_items(id,order_id,product_id,line_key,reference_snapshot,name_snapshot,specs_snapshot,terms_snapshot,unit_price_cents,quantity)
 SELECT id,order_id,product_id,'legacy-'||id,reference_snapshot,name_snapshot,specs_snapshot,terms_snapshot,unit_price_cents,quantity FROM legacy_order_items;
DROP TABLE legacy_order_items;
CREATE INDEX order_items_product ON order_items(product_id);
CREATE TABLE order_history (
 id INTEGER PRIMARY KEY, order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
 actor_id INTEGER REFERENCES admin_users(id) ON DELETE RESTRICT,
 action TEXT NOT NULL, from_stage TEXT, to_stage TEXT, note TEXT NOT NULL DEFAULT '',
 data_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(data_json)), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX order_history_order ON order_history(order_id,id);
INSERT INTO order_history(order_id,action,to_stage,note,created_at) SELECT id,'migrated',stage,'Registro anterior incorporado ao atendimento.',created_at FROM orders;
CREATE TRIGGER order_history_no_update BEFORE UPDATE ON order_history BEGIN SELECT RAISE(ABORT,'history is immutable'); END;
CREATE TRIGGER order_history_no_delete BEFORE DELETE ON order_history BEGIN SELECT RAISE(ABORT,'history is immutable'); END;
ALTER TABLE banners ADD COLUMN image TEXT NOT NULL DEFAULT '';
ALTER TABLE banners ADD COLUMN cta TEXT NOT NULL DEFAULT 'Ver catálogo';
ALTER TABLE banners ADD COLUMN destination TEXT NOT NULL DEFAULT '#catalogo';
ALTER TABLE banners ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE company_settings ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
