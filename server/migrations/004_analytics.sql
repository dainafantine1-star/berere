ALTER TABLE events ADD COLUMN event_key TEXT;
ALTER TABLE events ADD COLUMN origin TEXT NOT NULL DEFAULT 'unknown';
CREATE UNIQUE INDEX events_event_key ON events(event_key) WHERE event_key IS NOT NULL;
CREATE INDEX events_period ON events(created_at,name);
CREATE TABLE event_products (
  event_id INTEGER NOT NULL REFERENCES events(id),
  product_id INTEGER NOT NULL REFERENCES products(id),
  product_name TEXT NOT NULL,
  category_id TEXT NOT NULL,
  category_label TEXT NOT NULL,
  featured INTEGER NOT NULL,
  promotion INTEGER NOT NULL,
  PRIMARY KEY(event_id,product_id)
);
CREATE INDEX event_products_product ON event_products(product_id,event_id);
CREATE TABLE event_dedup (key TEXT PRIMARY KEY,event_id INTEGER NOT NULL REFERENCES events(id),seen_at TEXT NOT NULL);
CREATE TABLE event_receipts (event_key TEXT PRIMARY KEY,event_id INTEGER NOT NULL REFERENCES events(id));
CREATE TABLE catalog_daily (
  day TEXT PRIMARY KEY,
  captured_at TEXT NOT NULL,
  active_products INTEGER NOT NULL,
  categories INTEGER NOT NULL,
  featured INTEGER NOT NULL,
  promotions INTEGER NOT NULL
);
