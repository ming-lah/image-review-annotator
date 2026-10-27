import type { Response } from 'express';
import type { ReviewEvent } from '../../shared/collaboration-contracts.js';
import { ApiFailure } from './errors.js';

export function createReviewEvents() {
  const clients = new Set<Response>();
  function connect(res: Response, authorized: () => boolean = () => true) {
    if (clients.size >= 128) throw new ApiFailure(503, 'EVENT_CLIENT_LIMIT', '更新通知连接过多，请稍后重试');
    res.status(200).set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    clients.add(res);
    const cleanup = () => { clearInterval(heartbeat); clients.delete(res); };
    const write = (chunk: string) => {
      try { if (!res.write(chunk)) { cleanup(); res.destroy(); } }
      catch { cleanup(); res.destroy(); }
    };
    const heartbeat = setInterval(() => {
      try {
        if (!authorized()) { write('event: auth.required\ndata: {}\n\n'); cleanup(); res.end(); return; }
        write(': heartbeat\n\n');
      } catch { cleanup(); res.destroy(); }
    }, 15000);
    heartbeat.unref();
    res.once('close', cleanup); res.once('error', cleanup);
    write(': connected\n\n');
  }
  function publish(event: ReviewEvent) {
    const chunk = `data: ${JSON.stringify(event)}\n\n`;
    for (const res of clients) {
      // Invalidation messages are tiny and disposable: slow/disconnected readers reconnect and GET.
      try { if (!res.write(chunk)) res.destroy(); } catch { res.destroy(); }
    }
  }
  function close() { for (const res of clients) res.destroy(); }
  return { connect, publish, close };
}
export type ReviewEvents = ReturnType<typeof createReviewEvents>;
