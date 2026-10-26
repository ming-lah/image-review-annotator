ALTER TABLE annotations ADD COLUMN size INTEGER NOT NULL DEFAULT 24 CHECK (size BETWEEN 12 AND 48);
ALTER TABLE review_revisions ADD COLUMN version_number INTEGER NOT NULL DEFAULT 0 CHECK (version_number >= 0);
UPDATE review_revisions AS target SET version_number = (
  SELECT count(*) FROM review_revisions AS earlier
  WHERE earlier.image_id = target.image_id AND earlier.rowid <= target.rowid AND earlier.kind IN ('save','legacy')
) WHERE target.kind IN ('save','legacy');
CREATE UNIQUE INDEX review_revision_version ON review_revisions(image_id,version_number) WHERE version_number > 0;
