import { createHash } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { Actor, AnnotationDto, CreateAnnotation, DeleteAnnotation, ImageDto, UpdateAnnotation } from '../../shared/review-contracts.js';
import { ApiFailure } from '../http/errors.js';
import { usersRepository } from './users.js';

const imageColumns = 'id, original_name AS originalName, mime_type AS mimeType, width, height, file_size AS fileSize, sha256, created_at AS createdAt, updated_at AS updatedAt';
const annotationColumns = 'id, image_id AS imageId, number, x, y, note, severity, created_by AS createdBy, created_by_name AS createdByName, updated_by AS updatedBy, updated_by_name AS updatedByName, version, created_at AS createdAt, updated_at AS updatedAt, size';
export function reviewRepository(db: Database.Database, onChange?: (imageId: string, actor: Actor) => void) {
  const users = usersRepository(db);
  const image = (id: string) => db.prepare(`SELECT ${imageColumns} FROM images WHERE id=?`).get(id) as ImageDto | undefined;
  const annotation = (id: string) => db.prepare(`SELECT ${annotationColumns} FROM annotations WHERE id=?`).get(id) as AnnotationDto | undefined;
  const requireImage = (id: string) => { const row = image(id); if (!row) throw new ApiFailure(404, 'IMAGE_NOT_FOUND', '图片不存在'); return row; };
  const requireAnnotation = (id: string) => { const row = annotation(id); if (!row) throw new ApiFailure(404, 'ANNOTATION_NOT_FOUND', '标记不存在'); return row; };
  const conflict = () => new ApiFailure(409, 'ANNOTATION_VERSION_CONFLICT', '标记已被修改，请读取最新内容后比较');
  return {
    image, requireImage, requireAnnotation,
    detail(id: string) { return { image: requireImage(id), annotations: db.prepare(`SELECT ${annotationColumns} FROM annotations WHERE image_id=? ORDER BY number`).all(id) as AnnotationDto[] }; },
    storageKey(id: string) { requireImage(id); return (db.prepare('SELECT storage_key FROM images WHERE id=?').get(id) as { storage_key: string }).storage_key; },
    insertImage(row: ImageDto, storageKey: string) {
      db.prepare('INSERT INTO images (id,original_name,mime_type,width,height,file_size,storage_key,sha256,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
        .run(row.id, row.originalName, row.mimeType, row.width, row.height, row.fileSize, storageKey, row.sha256, row.createdAt, row.updatedAt);
    },
    create(imageId: string, value: CreateAnnotation) {
      return db.transaction(() => {
        requireImage(imageId);
        const fields = [imageId, value.x, value.y, value.note, value.severity, value.actorId, value.actorName];
        if (value.size !== undefined && value.size !== 24) fields.push(value.size);
        const fingerprint = createHash('sha256').update(JSON.stringify(fields)).digest('hex');
        const previous = db.prepare('SELECT fingerprint FROM annotation_creations WHERE id=?').get(value.id) as { fingerprint: string } | undefined;
        if (previous) {
          if (previous.fingerprint !== fingerprint) throw new ApiFailure(409, 'ANNOTATION_ID_CONFLICT', '该标记请求编号已用于不同内容');
          const existing = annotation(value.id);
          if (!existing) throw new ApiFailure(409, 'ANNOTATION_DELETED', '该标记已删除，不能通过重试恢复');
          return { created: false, annotation: existing };
        }
        const { next_annotation_number: number } = db.prepare('SELECT next_annotation_number FROM images WHERE id=?').get(imageId) as { next_annotation_number: number };
        const now = new Date().toISOString();
        users.remember(value.actorId, value.actorName);
        db.prepare('INSERT INTO annotations (id,image_id,number,x,y,note,severity,created_by,created_by_name,updated_by,updated_by_name,created_at,updated_at,created_by_user_id,updated_by_user_id,size) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
          .run(value.id, imageId, number, value.x, value.y, value.note, value.severity, value.actorId, value.actorName, value.actorId, value.actorName, now, now, value.actorId, value.actorId, value.size ?? 24);
        db.prepare('INSERT INTO annotation_creations VALUES (?,?,?)').run(value.id, imageId, fingerprint);
        db.prepare('UPDATE images SET next_annotation_number=next_annotation_number+1,updated_at=? WHERE id=?').run(now, imageId);
        onChange?.(imageId, value);
        return { created: true, annotation: requireAnnotation(value.id) };
      }).immediate();
    },
    update(id: string, value: UpdateAnnotation) {
      return db.transaction(() => {
        const old = requireAnnotation(id);
        if (old.version !== value.version) throw conflict();
        const now = new Date().toISOString();
        users.remember(value.actorId, value.actorName);
        const result = db.prepare('UPDATE annotations SET note=?,severity=?,updated_by=?,updated_by_name=?,version=version+1,updated_at=?,updated_by_user_id=?,size=? WHERE id=? AND version=?')
          .run(value.note, value.severity, value.actorId, value.actorName, now, value.actorId, value.size ?? old.size, id, value.version);
        if (!result.changes) throw conflict();
        db.prepare('UPDATE images SET updated_at=? WHERE id=?').run(now, old.imageId);
        onChange?.(old.imageId, value);
        return requireAnnotation(id);
      }).immediate();
    },
    remove(id: string, value: DeleteAnnotation) {
      db.transaction(() => {
        const old = requireAnnotation(id);
        if (old.version !== value.version) throw conflict();
        if (!db.prepare('DELETE FROM annotations WHERE id=? AND version=?').run(id, value.version).changes) throw conflict();
        db.prepare('UPDATE images SET updated_at=? WHERE id=?').run(new Date().toISOString(), old.imageId);
        users.remember(value.actorId, value.actorName);
        onChange?.(old.imageId, value);
      }).immediate();
    },
  };
}
export type ReviewRepository = ReturnType<typeof reviewRepository>;
