CREATE TABLE users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL CHECK (length(trim(username)) BETWEEN 1 AND 40),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
INSERT INTO users VALUES ('00000000-0000-4000-8000-000000000001','历史记录',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now'));
INSERT OR IGNORE INTO users SELECT created_by,created_by_name,created_at,updated_at FROM annotations;
INSERT OR IGNORE INTO users SELECT updated_by,updated_by_name,created_at,updated_at FROM annotations;

CREATE TABLE review_revisions (
  id TEXT PRIMARY KEY,
  image_id TEXT NOT NULL REFERENCES images(id) ON DELETE CASCADE,
  parent_revision_id TEXT REFERENCES review_revisions(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  username_snapshot TEXT NOT NULL,
  saved_at TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('upload','import','save','legacy')),
  added INTEGER NOT NULL DEFAULT 0,
  modified INTEGER NOT NULL DEFAULT 0,
  deleted INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX review_revisions_image ON review_revisions(image_id,saved_at DESC);
CREATE TABLE review_baselines (
  revision_id TEXT PRIMARY KEY REFERENCES review_revisions(id) ON DELETE CASCADE,
  markers_json TEXT NOT NULL
);
CREATE TABLE review_changes (
  revision_id TEXT NOT NULL REFERENCES review_revisions(id) ON DELETE CASCADE,
  annotation_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('add','modify','delete')),
  before_json TEXT,
  after_json TEXT,
  performed_by_user_id TEXT NOT NULL REFERENCES users(id),
  PRIMARY KEY (revision_id,annotation_id)
);
CREATE TABLE review_save_receipts (
  id TEXT PRIMARY KEY,
  image_id TEXT NOT NULL REFERENCES images(id),
  fingerprint TEXT NOT NULL,
  revision_id TEXT NOT NULL REFERENCES review_revisions(id)
);
ALTER TABLE images ADD COLUMN uploaded_by_user_id TEXT REFERENCES users(id);
ALTER TABLE images ADD COLUMN current_revision_id TEXT REFERENCES review_revisions(id);
ALTER TABLE annotations ADD COLUMN created_by_user_id TEXT REFERENCES users(id);
ALTER TABLE annotations ADD COLUMN updated_by_user_id TEXT REFERENCES users(id);
UPDATE annotations SET created_by_user_id=created_by,updated_by_user_id=updated_by;
UPDATE images SET uploaded_by_user_id='00000000-0000-4000-8000-000000000001';

INSERT INTO review_revisions (id,image_id,user_id,username_snapshot,saved_at,kind)
SELECT lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-4'||substr(hex(randomblob(2)),2)||'-8'||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6))),
  id,'00000000-0000-4000-8000-000000000001','历史记录',updated_at,'import' FROM images;
INSERT INTO review_baselines (revision_id,markers_json)
SELECT r.id,coalesce((SELECT json_group_array(json_object('id',a.id,'imageId',a.image_id,'number',a.number,'x',a.x,'y',a.y,'note',a.note,'severity',a.severity,'createdBy',a.created_by,'createdByName',a.created_by_name,'updatedBy',a.updated_by,'updatedByName',a.updated_by_name,'version',a.version,'createdAt',a.created_at,'updatedAt',a.updated_at)) FROM annotations a WHERE a.image_id=r.image_id),'[]') FROM review_revisions r;
UPDATE images SET current_revision_id=(SELECT id FROM review_revisions WHERE image_id=images.id);
