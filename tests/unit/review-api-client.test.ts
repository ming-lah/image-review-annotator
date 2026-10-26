import { describe, it, expect, vi } from 'vitest';
import { reviewApi, RequestFailure } from '../../src/client/http/review-api';

describe('P4 HTTP client failure classification', () => {
  it('retains a server error code and request ID without treating a failed response as success', async () => {
    const api = reviewApi(vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ error: { code: 'DATABASE_BUSY', message: '数据库繁忙', requestId: 'request-one' } }), { status: 503 })));
    await expect(api.detail(crypto.randomUUID())).rejects.toMatchObject({ status: 503, code: 'DATABASE_BUSY', requestId: 'request-one' });
  });
  it.each([new Response('<html>proxy</html>', { status: 502 }), new Response('{}', { status: 200 })])('classifies malformed or schema-invalid responses as unknown', async response => {
    const api = reviewApi(vi.fn<typeof fetch>().mockResolvedValue(response));
    await expect(api.detail(crypto.randomUUID())).rejects.toMatchObject({ status: null, code: 'RESULT_UNKNOWN' });
  });
  it('keeps content API failures as structured errors instead of a successfully decoded image', async () => {
    const api = reviewApi(vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ error: { code: 'IMAGE_FILE_MISSING', message: '原文件缺失', requestId: 'request-two' } }), { status: 404 })));
    await expect(api.content(crypto.randomUUID(), 'x.png', 'image/png')).rejects.toMatchObject({ status: 404, code: 'IMAGE_FILE_MISSING', requestId: 'request-two' });
  });
  it('aborts a bounded wait and reports the write result as unknown', async () => {
    vi.useFakeTimers();
    try {
      const fetcher = vi.fn<typeof fetch>((_url, options) => new Promise((_resolve, reject) => { options?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true }); }));
      const pending = reviewApi(fetcher).detail(crypto.randomUUID());
      const checked = expect(pending).rejects.toBeInstanceOf(RequestFailure);
      await vi.advanceTimersByTimeAsync(20000); await checked;
      expect((fetcher.mock.calls[0][1]?.signal as AbortSignal).aborted).toBe(true);
    } finally { vi.useRealTimers(); }
  });
});
