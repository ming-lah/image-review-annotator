import { createHash, randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { annotationSchema, type Actor, type AnnotationDto } from '../../shared/review-contracts.js';
import type { Change, Library, Revision, RevisionList, SaveReview, SaveResult, WorkspaceDetail, HistoryDetail, LibraryItem } from '../../shared/workbench-contracts.js';
import { ApiFailure } from '../http/errors.js';
import { reviewRepository } from './review-repository.js';
import { legacyUserId, usersRepository } from './users.js';

const columns = 'id,image_id AS imageId,parent_revision_id AS parentRevisionId,user_id AS userId,username_snapshot AS username,saved_at AS savedAt,kind,added,modified,deleted,version_number AS versionNumber';
export function workbenchRepository(db: Database.Database) {
  const repository = reviewRepository(db); const users = usersRepository(db);
  const head = (imageId: string) => { repository.requireImage(imageId); return (db.prepare('SELECT current_revision_id AS id FROM images WHERE id=?').get(imageId) as { id: string }).id; };
  function revision(id: string, imageId: string): Revision {
    const value = db.prepare(`SELECT ${columns} FROM review_revisions WHERE id=? AND image_id=?`).get(id, imageId) as Revision | undefined;
    if (!value) throw new ApiFailure(404, 'REVISION_NOT_FOUND', '保存历史不存在');
    return value;
  }
  function changes(id: string): Change[] {
    const rows = db.prepare('SELECT annotation_id AS annotationId,kind,before_json,after_json,performed_by_user_id AS userId FROM review_changes WHERE revision_id=? ORDER BY annotation_id').all(id) as { annotationId: string; kind: Change['kind']; before_json: string | null; after_json: string | null; userId: string }[];
    return rows.map(row => ({ annotationId: row.annotationId, kind: row.kind, userId: row.userId, before: row.before_json ? annotationSchema.parse(JSON.parse(row.before_json)) : null, after: row.after_json ? annotationSchema.parse(JSON.parse(row.after_json)) : null }));
  }
  function stateAt(imageId: string, id: string): AnnotationDto[] {
    const chain: string[] = []; const seen = new Set<string>(); let current: string | null = id;
    while (current) {
      if (seen.has(current)) throw new ApiFailure(500, 'HISTORY_UNAVAILABLE', '保存历史暂时无法读取');
      seen.add(current);
      const baseline = db.prepare('SELECT markers_json FROM review_baselines WHERE revision_id=?').get(current) as { markers_json: string } | undefined;
      if (baseline) {
        revision(current, imageId);
        const rows = annotationSchema.array().parse(JSON.parse(baseline.markers_json));
        const markers = new Map(rows.map(row => [row.id, row]));
        for (const item of chain.reverse()) for (const change of changes(item)) {
          if (change.after) markers.set(change.annotationId, change.after); else markers.delete(change.annotationId);
        }
        return [...markers.values()].sort((a, b) => a.number - b.number);
      }
      const value = revision(current, imageId); chain.push(current); current = value.parentRevisionId;
    }
    throw new ApiFailure(500, 'HISTORY_UNAVAILABLE', '保存历史基线暂时无法读取');
  }
  function initialize(imageId: string, userId = legacyUserId) {
    const user = users.requireUser(userId); const id = randomUUID(); const now = new Date().toISOString();
    db.prepare('INSERT INTO review_revisions(id,image_id,user_id,username_snapshot,saved_at,kind) VALUES (?,?,?,?,?,?)').run(id, imageId, userId, user.username, now, 'upload');
    db.prepare('INSERT INTO review_baselines VALUES (?,?)').run(id, JSON.stringify(repository.detail(imageId).annotations));
    db.prepare('UPDATE images SET uploaded_by_user_id=?,current_revision_id=? WHERE id=?').run(userId, id, imageId);
  }
  function capture(imageId: string, actor: Actor, kind: Revision['kind'] = 'legacy') {
    const parent = head(imageId); const before = stateAt(imageId, parent); const after = annotationSchema.array().parse(repository.detail(imageId).annotations);
    const previous = new Map(before.map(row => [row.id, row])); const next = new Map(after.map(row => [row.id, row]));
    const diff: Change[] = [];
    for (const row of after) {
      const old = previous.get(row.id);
      if (!old || JSON.stringify(old) !== JSON.stringify(row)) diff.push({ annotationId: row.id, kind: old ? 'modify' : 'add', before: old ?? null, after: row, userId: actor.actorId });
    }
    for (const row of before) if (!next.has(row.id)) diff.push({ annotationId: row.id, kind: 'delete', before: row, after: null, userId: actor.actorId });
    if (!diff.length) return parent;
    users.remember(actor.actorId, actor.actorName);
    const id = randomUUID(); const now = new Date().toISOString();
    const versionNumber = (db.prepare('SELECT coalesce(max(version_number),0)+1 AS n FROM review_revisions WHERE image_id=?').get(imageId) as { n: number }).n;
    db.prepare('INSERT INTO review_revisions(id,image_id,parent_revision_id,user_id,username_snapshot,saved_at,kind,added,modified,deleted,version_number) VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(id, imageId, parent, actor.actorId, actor.actorName, now, kind, diff.filter(row => row.kind === 'add').length, diff.filter(row => row.kind === 'modify').length, diff.filter(row => row.kind === 'delete').length, versionNumber);
    for (const item of diff) db.prepare('INSERT INTO review_changes VALUES (?,?,?,?,?,?)').run(id, item.annotationId, item.kind, item.before ? JSON.stringify(item.before) : null, item.after ? JSON.stringify(item.after) : null, actor.actorId);
    db.prepare('UPDATE images SET current_revision_id=?,updated_at=? WHERE id=?').run(id, now, imageId);
    return id;
  }
  function detail(imageId: string): WorkspaceDetail { return { ...repository.detail(imageId), revision: revision(head(imageId), imageId) }; }
  function library(query: string, page: number, sort: string): Library {
    const order = sort === 'name' ? 'i.original_name COLLATE NOCASE ASC' : sort === 'created' ? 'i.created_at DESC,i.id' : 'i.updated_at DESC,i.id';
    const escaped = query.replace(/[\\%_]/g, value => '\\' + value); const pattern = `%${escaped}%`;
    const total = (db.prepare("SELECT count(*) AS total FROM images WHERE original_name LIKE ? ESCAPE '\\'").get(pattern) as { total: number }).total;
    const ids = db.prepare(`SELECT i.id FROM images i WHERE i.original_name LIKE ? ESCAPE '\\' ORDER BY ${order} LIMIT 12 OFFSET ?`).all(pattern, (page - 1) * 12) as { id: string }[];
    return { items: ids.map(({ id }) => libraryItem(id)), total, page, pageSize: 12 };
  }
  function libraryItem(id: string): LibraryItem {
    const info = db.prepare('SELECT uploaded_by_user_id AS uploadedByUserId FROM images WHERE id=?').get(id) as { uploadedByUserId: string };
    return { image: repository.requireImage(id), annotationCount: (db.prepare('SELECT count(*) AS n FROM annotations WHERE image_id=?').get(id) as { n: number }).n, revisionCount: (db.prepare('SELECT count(*) AS n FROM review_revisions WHERE image_id=?').get(id) as { n: number }).n, username: revision(head(id), id).username, ...info };
  }
  function history(imageId: string, page: number): RevisionList {
    repository.requireImage(imageId);
    const total = (db.prepare('SELECT count(*) AS n FROM review_revisions WHERE image_id=?').get(imageId) as { n: number }).n;
    // rowid is a stable secondary order when multiple saves have the same millisecond.
    const items = db.prepare(`SELECT ${columns} FROM review_revisions WHERE image_id=? ORDER BY rowid DESC LIMIT 20 OFFSET ?`).all(imageId, (page - 1) * 20) as Revision[];
    return { items, total, page, pageSize: 20 };
  }
  function historical(imageId: string, id: string): HistoryDetail {
    const selected = revision(id, imageId);
    return { image: repository.requireImage(imageId), revision: selected, annotations: stateAt(imageId, id), changes: changes(id), previousAnnotations: selected.parentRevisionId ? stateAt(imageId, selected.parentRevisionId) : [] };
  }
  function save(imageId: string, value: SaveReview): SaveResult {
    return db.transaction(() => {
      const user = users.requireUser(value.userId); const actor = { actorId: user.userId, actorName: user.username };
      const fingerprint = createHash('sha256').update(JSON.stringify([imageId, value.baseRevisionId, value.userId, [...value.markers].sort((a, b) => a.id.localeCompare(b.id))])).digest('hex');
      const receipt = db.prepare('SELECT fingerprint,revision_id FROM review_save_receipts WHERE id=?').get(value.requestId) as { fingerprint: string; revision_id: string } | undefined;
      if (receipt) {
        if (receipt.fingerprint !== fingerprint) throw new ApiFailure(409, 'SAVE_ID_CONFLICT', '该保存请求编号已用于不同内容');
        return { created: false, savedRevisionId: receipt.revision_id, detail: detail(imageId), libraryItem: libraryItem(imageId) };
      }
      const parent = head(imageId);
      if (parent !== value.baseRevisionId) throw new ApiFailure(409, 'REVIEW_BASE_CHANGED', '已保存内容发生变化，请保留本次输入并重新加载核对');
      const current = repository.detail(imageId).annotations; const old = new Map(current.map(row => [row.id, row])); const desired = new Set(value.markers.map(row => row.id));
      for (const row of value.markers) {
        const previous = old.get(row.id);
        if (previous) {
          if (row.x !== previous.x || row.y !== previous.y) throw new ApiFailure(400, 'INVALID_REQUEST', '已有标记的位置不可修改');
          if (row.note !== previous.note || row.severity !== previous.severity || (row.size ?? previous.size) !== previous.size) repository.update(row.id, { ...actor, version: previous.version, note: row.note, severity: row.severity, size: row.size });
        } else repository.create(imageId, { ...actor, ...row });
      }
      for (const row of current) if (!desired.has(row.id)) repository.remove(row.id, { ...actor, version: row.version });
      const id = capture(imageId, actor, 'save');
      db.prepare('INSERT INTO review_save_receipts VALUES (?,?,?,?)').run(value.requestId, imageId, fingerprint, id);
      return { created: id !== parent, savedRevisionId: id, detail: detail(imageId), libraryItem: libraryItem(imageId) };
    }).immediate();
  }
  return { initialize, capture, detail, library, history, historical, save };
}
