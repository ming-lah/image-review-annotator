import { z } from 'zod';
import type { ReviewSnapshot } from './review-session';
import type { ViewSnapshot } from './review-view';

const point = z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) });
const marker = point.extend({ id: z.string().min(1), label: z.number().int().positive(), note: z.string().trim().min(1).max(2000) });
const reviewSchema = z.object({
  markers: z.array(marker), expandedIds: z.array(z.string()), selectedId: z.string().min(1).nullable(),
  draft: point.extend({ id: z.string().min(1).nullable(), note: z.string() }).nullable(), nextLabel: z.number().int().positive(),
}).refine(value => {
  const ids = new Set(value.markers.map(item => item.id));
  const labels = new Set(value.markers.map(item => item.label));
  return ids.size === value.markers.length && labels.size === value.markers.length
    && value.markers.every(item => item.label < value.nextLabel)
    && value.expandedIds.every(id => ids.has(id)) && new Set(value.expandedIds).size === value.expandedIds.length
    && (value.selectedId === null || ids.has(value.selectedId)) && (!value.draft?.id || ids.has(value.draft.id));
});
const snapshotSchema = z.object({
  version: z.literal(1), blobKey: z.string().uuid(),
  image: z.object({ name: z.string().min(1), type: z.enum(['image/png', 'image/jpeg', 'image/webp']), size: z.number().int().positive().max(20 * 1024 * 1024), width: z.number().int().positive().max(12000), height: z.number().int().positive().max(12000) }).refine(image => image.width * image.height <= 40000000),
  review: reviewSchema,
  view: z.object({ mode: z.enum(['fit', 'manual']), manualScale: z.number().min(0.1).max(4), markerSize: z.number().min(12).max(48), anchor: point }),
});
export interface SessionSnapshot {
  image: { name: string; type: string; size: number; width: number; height: number };
  review: ReviewSnapshot;
  view: ViewSnapshot;
}
export interface BlobCache { read(key: string): Promise<Blob | null>; write(key: string, blob: Blob): Promise<void>; remove(key: string): Promise<void>; close(): void }
interface SessionDependencies { storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>; blobs: BlobCache; makeId(): string }
const storageKey = 'image-review-annotator:p3:tab-session:v1';

export function browserBlobCache(): BlobCache {
  let connection: Promise<IDBDatabase> | undefined;
  const open = () => connection ??= new Promise((resolve, reject) => {
    const request = indexedDB.open('image-review-annotator-p3-session', 1);
    let blocked = false;
    request.onupgradeneeded = () => request.result.createObjectStore('images', { keyPath: 'id' });
    request.onsuccess = () => {
      if (blocked) { request.result.close(); return; }
      request.result.onversionchange = () => { request.result.close(); connection = undefined; };
      resolve(request.result);
    };
    request.onerror = () => { connection = undefined; reject(new Error('Session cache unavailable')); };
    request.onblocked = () => { blocked = true; connection = undefined; reject(new Error('Session cache blocked')); };
  });
  async function transact<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const db = await open();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction('images', mode);
      const request = action(transaction.objectStore('images'));
      transaction.oncomplete = () => resolve(request.result);
      transaction.onerror = transaction.onabort = () => reject(new Error('Session cache unavailable'));
    });
  }
  return {
    async read(key) { const row = await transact<{ id: string; blob: Blob } | undefined>('readonly', store => store.get(key)); return row?.blob ?? null; },
    async write(key, blob) { await transact('readwrite', store => store.put({ id: key, blob })); },
    async remove(key) { await transact('readwrite', store => store.delete(key)); },
    close() { if (connection) void connection.then(db => db.close()).catch(() => {}); },
  };
}

export function createTabSession(deps: SessionDependencies = { storage: sessionStorage, blobs: browserBlobCache(), makeId: () => crypto.randomUUID() }) {
  const files = new WeakMap<File, { key: string; ready: Promise<void>; persisted: boolean }>();
  let revision = 0;
  let requestedKey: string | null = null;
  let committedKey: string | null = null;

  async function load(): Promise<{ snapshot: SessionSnapshot; file: File } | null> {
    const raw = deps.storage.getItem(storageKey);
    if (!raw) return null;
    const parsed = snapshotSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) throw new Error('Invalid tab session');
    const saved = parsed.data;
    const blob = await deps.blobs.read(saved.blobKey);
    if (!blob || blob.size !== saved.image.size || blob.type !== saved.image.type) throw new Error('Session image unavailable');
    const file = new File([blob], saved.image.name, { type: saved.image.type });
    files.set(file, { key: saved.blobKey, ready: Promise.resolve(), persisted: true });
    committedKey = requestedKey = saved.blobKey;
    return { snapshot: saved, file };
  }

  async function save(snapshot: SessionSnapshot, file: File) {
    const current = ++revision;
    let entry = files.get(file);
    const key = entry?.key ?? deps.makeId();
    const value = snapshotSchema.parse({ ...snapshot, version: 1, blobKey: key });
    if (!entry) {
      entry = { key, ready: Promise.resolve(), persisted: false };
      const allocated = entry;
      entry.ready = deps.blobs.write(key, file).then(() => { allocated.persisted = true; }).catch(error => { files.delete(file); throw error; });
      files.set(file, entry);
    }
    requestedKey = entry.key;
    if (!entry.persisted) await entry.ready;
    if (current !== revision) {
      if (requestedKey !== entry.key) await deps.blobs.remove(entry.key);
      return;
    }
    deps.storage.setItem(storageKey, JSON.stringify(value));
    const previous = committedKey;
    committedKey = entry.key;
    if (previous && previous !== entry.key) void deps.blobs.remove(previous).catch(() => {});
  }

  async function clear() {
    const keys = [...new Set([requestedKey, committedKey].filter((key): key is string => key !== null))];
    revision++;
    requestedKey = null;
    deps.storage.removeItem(storageKey);
    committedKey = null;
    await Promise.all(keys.map(key => deps.blobs.remove(key)));
  }

  return { load, save, clear, close: () => deps.blobs.close() };
}
