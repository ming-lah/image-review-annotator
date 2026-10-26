CREATE TABLE images (
  id TEXT PRIMARY KEY,
  original_name TEXT NOT NULL,
  mime_type TEXT NOT NULL CHECK (mime_type IN ('image/png','image/jpeg','image/webp')),
  width INTEGER NOT NULL CHECK (width BETWEEN 1 AND 12000),
  height INTEGER NOT NULL CHECK (height BETWEEN 1 AND 12000 AND width * height <= 40000000),
  file_size INTEGER NOT NULL CHECK (file_size BETWEEN 1 AND 20971520),
  storage_key TEXT NOT NULL UNIQUE,
  sha256 TEXT NOT NULL,
  next_annotation_number INTEGER NOT NULL DEFAULT 1 CHECK (next_annotation_number > 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE annotations (
  id TEXT PRIMARY KEY,
  image_id TEXT NOT NULL REFERENCES images(id) ON DELETE CASCADE,
  number INTEGER NOT NULL CHECK (number > 0),
  x REAL NOT NULL CHECK (x BETWEEN 0 AND 1),
  y REAL NOT NULL CHECK (y BETWEEN 0 AND 1),
  note TEXT NOT NULL CHECK (length(trim(note)) BETWEEN 1 AND 2000),
  severity TEXT NOT NULL CHECK (severity IN ('low','medium','high')),
  created_by TEXT NOT NULL, created_by_name TEXT NOT NULL CHECK (length(created_by_name) BETWEEN 1 AND 40),
  updated_by TEXT NOT NULL, updated_by_name TEXT NOT NULL CHECK (length(updated_by_name) BETWEEN 1 AND 40),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  UNIQUE (image_id, number)
);
CREATE TABLE annotation_creations (
  id TEXT PRIMARY KEY,
  image_id TEXT NOT NULL REFERENCES images(id) ON DELETE CASCADE,
  fingerprint TEXT NOT NULL
);
