CREATE TABLE media_variants (
  media_id TEXT NOT NULL REFERENCES media(id) ON DELETE CASCADE,
  width INTEGER NOT NULL,
  filename TEXT NOT NULL UNIQUE,
  bytes INTEGER NOT NULL,
  PRIMARY KEY(media_id,width)
);
