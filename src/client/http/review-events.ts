import { reviewEventSchema, type ReviewEvent } from '../../shared/collaboration-contracts';

export type UpdateStatus = 'connecting' | 'connected' | 'disconnected' | 'unavailable';
export type UpdateHandlers = { event(value: ReviewEvent): void; ready(): void; status(value: UpdateStatus): void };
export function observeReviewUpdates(handlers: UpdateHandlers): () => void {
  if (typeof EventSource === 'undefined') { handlers.status('unavailable'); return () => {}; }
  handlers.status('connecting');
  let source: EventSource;
  try { source = new EventSource('/api/events'); }
  catch { handlers.status('unavailable'); return () => {}; }
  let closed = false;
  source.onopen = () => { if (!closed) { handlers.status('connected'); handlers.ready(); } };
  source.onerror = () => { if (!closed) handlers.status('disconnected'); };
  source.onmessage = event => {
    if (closed) return;
    try { const value = reviewEventSchema.safeParse(JSON.parse(String(event.data))); if (value.success) handlers.event(value.data); }
    catch { /* Malformed notifications never change the working copy. Reconnect/focus GET reconciles. */ }
  };
  return () => { closed = true; source.close(); };
}
