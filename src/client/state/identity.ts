import { reactive } from 'vue';
import { actorSchema, type Actor } from '../../shared/review-contracts';

const key = 'image-review-annotator:actor:v1';
export function createIdentity(storage: Pick<Storage, 'getItem' | 'setItem'>) {
  const state = reactive({ actorId: crypto.randomUUID() as string, actorName: '', warning: '' });
  try { const existing = actorSchema.safeParse(JSON.parse(storage.getItem(key) ?? 'null')); if (existing.success) Object.assign(state, existing.data); }
  catch { state.warning = '浏览器身份存储不可用，昵称仅保留在当前页面'; }
  function current(): Actor | null {
    const actor = actorSchema.safeParse({ actorId: state.actorId, actorName: state.actorName });
    if (!actor.success) return null;
    try { storage.setItem(key, JSON.stringify(actor.data)); state.warning = ''; }
    catch { state.warning = '浏览器身份存储不可用，昵称仅保留在当前页面'; }
    return actor.data;
  }
  return { state, current };
}
