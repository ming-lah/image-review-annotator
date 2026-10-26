import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import sharp from 'sharp';
import type Database from 'better-sqlite3';
import { ApiFailure } from '../http/errors.js';
import { logger } from '../logger.js';

// Do not retain decoded input file handles; Windows must be able to clean staged uploads.
sharp.cache({ files: 0 });

const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const keyPattern = new RegExp(`^${uuid}/original\\.(png|jpeg|webp)$`, 'i');
const tempPattern = new RegExp(`^${uuid}\\.upload$`, 'i');
const idPattern = new RegExp(`^${uuid}$`, 'i');
const unavailable = () => new ApiFailure(503, 'STORAGE_UNAVAILABLE', '图片存储暂不可用，请检查数据目录后重试');

export function imageFiles(dataDir: string) {
  const root = fs.realpathSync(dataDir);
  function checked(target: string) {
    if (fs.realpathSync(root) !== root) throw unavailable();
    const relative = path.relative(root, target);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw unavailable();
    let current = root;
    for (const segment of relative.split(path.sep)) {
      current = path.join(current, segment);
      try { if (fs.lstatSync(current).isSymbolicLink()) throw unavailable(); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    }
    return target;
  }
  function directory(target: string) {
    checked(target);
    if (!fs.existsSync(target)) fs.mkdirSync(target);
    if (!fs.statSync(target).isDirectory()) throw unavailable();
    return target;
  }
  const images = directory(path.join(root, 'images'));
  directory(path.join(root, 'tmp'));
  const uploads = directory(path.join(root, 'tmp', 'uploads'));
  const contentPath = (key: string) => { if (!keyPattern.test(key)) throw unavailable(); return checked(path.join(images, key)); };
  const tempPath = (name: string) => { if (!tempPattern.test(name)) throw unavailable(); return checked(path.join(uploads, name)); };
  function removeTemp(name: string, requestId?: string) {
    try { fs.rmSync(tempPath(name), { force: true }); }
    catch { logger.warn({ event: 'upload_cleanup_failed', requestId, errorCode: 'STORAGE_UNAVAILABLE' }); }
  }
  return {
    uploads, tempPath, contentPath, removeTemp,
    check() {
      for (const target of [images, uploads]) {
        checked(target);
        if (!fs.statSync(target).isDirectory()) throw unavailable();
        const probe = path.join(target, '.probe-' + randomUUID());
        try { fs.writeFileSync(probe, '', { flag: 'wx' }); } finally { if (fs.existsSync(probe)) fs.unlinkSync(probe); }
      }
    },
    scan(db: Database.Database, now = Date.now()) {
      const referenced = new Set((db.prepare('SELECT storage_key FROM images').all() as { storage_key: string }[]).map(row => row.storage_key));
      const candidates: { file: string; imageId?: string }[] = [];
      for (const name of fs.readdirSync(checked(uploads))) if (tempPattern.test(name)) candidates.push({ file: tempPath(name) });
      for (const id of fs.readdirSync(checked(images))) {
        if (!idPattern.test(id)) continue;
        const folder = checked(path.join(images, id));
        if (!fs.statSync(folder).isDirectory()) continue;
        for (const name of fs.readdirSync(folder)) {
          const key = `${id}/${name}`;
          if (keyPattern.test(key) && !referenced.has(key)) candidates.push({ file: contentPath(key), imageId: id });
        }
      }
      for (const candidate of candidates) {
        const stat = fs.lstatSync(candidate.file);
        if (!stat.isFile()) continue;
        logger.warn({ event: 'unreferenced_image_file', imageId: candidate.imageId, errorCode: 'ORPHAN_FILE' });
        if (now - stat.mtimeMs <= 24 * 60 * 60 * 1000) continue;
        try { fs.unlinkSync(candidate.file); }
        catch { logger.warn({ event: 'orphan_cleanup_failed', imageId: candidate.imageId, errorCode: 'STORAGE_UNAVAILABLE' }); }
      }
    },
    install(tempName: string, id: string, ext: string) {
      if (!idPattern.test(id) || !['png', 'jpeg', 'webp'].includes(ext)) throw unavailable();
      directory(path.join(images, id));
      const key = `${id}/original.${ext}`;
      fs.copyFileSync(tempPath(tempName), contentPath(key), fs.constants.COPYFILE_EXCL);
      return key;
    },
    rollback(key: string, requestId?: string) {
      try { fs.unlinkSync(contentPath(key)); }
      catch { logger.warn({ event: 'image_rollback_cleanup_failed', imageId: key.split('/')[0], requestId, errorCode: 'STORAGE_UNAVAILABLE' }); }
    },
  };
}
export type ImageFiles = ReturnType<typeof imageFiles>;

function pngIsAnimated(file: string) {
  const fd = fs.openSync(file, 'r');
  try {
    const header = Buffer.alloc(8);
    let offset = 8;
    while (fs.readSync(fd, header, 0, 8, offset) === 8) {
      const type = header.toString('ascii', 4, 8);
      if (type === 'acTL') return true;
      if (type === 'IEND') break;
      offset += 12 + header.readUInt32BE(0);
    }
    return false;
  } finally { fs.closeSync(fd); }
}
export async function validateImage(file: string, originalName: string, mime: string) {
  const fileSize = fs.statSync(file).size;
  if (fileSize > 20 * 1024 * 1024) throw new ApiFailure(413, 'IMAGE_TOO_LARGE', '图片不能超过 20 MiB');
  if (!fileSize) throw new ApiFailure(400, 'IMAGE_INVALID', '图片文件为空');
  const suffix = path.extname(originalName).toLowerCase();
  const expected = ({ '.png': 'png', '.jpg': 'jpeg', '.jpeg': 'jpeg', '.webp': 'webp' } as Record<string, string>)[suffix];
  if (!expected || mime !== `image/${expected}`) throw new ApiFailure(415, 'IMAGE_TYPE_UNSUPPORTED', '请选择扩展名和类型一致的 PNG、JPEG 或 WebP 图片');
  const fd = fs.openSync(file, 'r'); const signature = Buffer.alloc(12);
  try { fs.readSync(fd, signature, 0, signature.length, 0); } finally { fs.closeSync(fd); }
  const actual = signature.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ? 'png'
    : signature[0] === 255 && signature[1] === 216 && signature[2] === 255 ? 'jpeg'
    : signature.toString('ascii', 0, 4) === 'RIFF' && signature.toString('ascii', 8, 12) === 'WEBP' ? 'webp' : null;
  if (!actual) throw new ApiFailure(400, 'IMAGE_INVALID', '图片文件签名无效');
  if (actual !== expected) throw new ApiFailure(415, 'IMAGE_TYPE_UNSUPPORTED', '图片签名与声明类型不一致');
  try {
    const decoder = sharp(file, { animated: true, failOn: 'warning', limitInputPixels: 40000000, sequentialRead: true });
    const metadata = await decoder.metadata();
    if (metadata.format !== expected) throw new ApiFailure(415, 'IMAGE_TYPE_UNSUPPORTED', '图片真实格式与文件类型不一致');
    if ((metadata.pages ?? 1) > 1 || (expected === 'png' && pngIsAnimated(file))) throw new ApiFailure(415, 'IMAGE_ANIMATION_UNSUPPORTED', '请先将动画转为静态图片');
    if (metadata.orientation && metadata.orientation !== 1) throw new ApiFailure(415, 'IMAGE_ORIENTATION_UNSUPPORTED', '请先将图片转正再上传');
    const { width, height } = metadata;
    if (!width || !height || width > 12000 || height > 12000 || width * height > 40000000) throw new ApiFailure(400, 'IMAGE_INVALID', '图片宽高不能超过 12000 像素，总像素不能超过 4000 万');
    await decoder.stats(); // Force full pixel decode; metadata alone does not reject truncated input.
    const sha256 = createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    return { width, height, fileSize, sha256, ext: expected as 'png' | 'jpeg' | 'webp', mimeType: `image/${expected}` as 'image/png' | 'image/jpeg' | 'image/webp' };
  } catch (error) {
    if (error instanceof ApiFailure) throw error;
    throw new ApiFailure(400, 'IMAGE_INVALID', '图片无法完整解码，请选择完好的静态图片');
  }
}
