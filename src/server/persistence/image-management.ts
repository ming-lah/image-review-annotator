import type Database from 'better-sqlite3';
import type { DeleteImage } from '../../shared/workbench-contracts.js';
import { ApiFailure } from '../http/errors.js';
import { usersRepository } from './users.js';
import { reviewRepository } from './review-repository.js';

export function imageManagement(db: Database.Database) {
  const repository = reviewRepository(db);
  function requireLiveId(id: string) {
    if (db.prepare('SELECT id FROM deleted_images WHERE id=?').get(id)) throw new ApiFailure(409, 'IMAGE_DELETED', '该图片已删除，不能通过旧上传请求恢复，请重新选择文件上传');
  }
  function remove(id: string, value: DeleteImage) {
    return db.transaction(() => {
      usersRepository(db).requireUser(value.userId);
      repository.requireImage(id);
      const current = db.prepare('SELECT current_revision_id AS revision FROM images WHERE id=?').get(id) as { revision: string };
      if (current.revision !== value.baseRevisionId) throw new ApiFailure(409, 'REVIEW_BASE_CHANGED', '已保存内容发生变化，请保留本次输入并重新加载核对');
      const key = repository.storageKey(id);
      db.prepare('INSERT INTO deleted_images VALUES (?,?)').run(id, new Date().toISOString());
      db.prepare('UPDATE images SET current_revision_id=NULL WHERE id=?').run(id);
      db.prepare('DELETE FROM review_save_receipts WHERE image_id=?').run(id);
      db.prepare('UPDATE review_revisions SET parent_revision_id=NULL WHERE image_id=?').run(id);
      db.prepare('DELETE FROM images WHERE id=?').run(id);
      return key;
    }).immediate();
  }
  return { requireLiveId, remove };
}
