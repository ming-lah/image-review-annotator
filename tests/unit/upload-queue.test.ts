import { afterEach, describe, expect, it, vi } from 'vitest';
import { createUploadQueue } from '../../src/client/state/upload-queue';
import { RequestFailure } from '../../src/client/http/review-api';
import type { ImageDto } from '../../src/shared/review-contracts';

const image = (id: string): ImageDto => ({ id, originalName: 'one.png', mimeType: 'image/png', width: 32, height: 24, fileSize: 3, sha256: 'a'.repeat(64), createdAt: 'now', updatedAt: 'now' });
const file = (name = 'one.png') => new File(['png'], name, { type: 'image/png' });
const queues: ReturnType<typeof createUploadQueue>[] = [];
function setup(send = vi.fn(async (id: string, _file: File, _user: string) => { void _file; void _user; return image(id); })) {
  const settled = vi.fn(async () => {}); const queue = createUploadQueue(send, settled); queues.push(queue);
  return { queue, send, settled };
}
afterEach(() => queues.splice(0).forEach(queue => queue.dispose()));

describe('P5 sequential upload queue', () => {
  it('pauses subsequent uploads after auth failure and only resumes retries for the original account', async () => {
    const { queue, send, settled } = setup();
    send.mockRejectedValueOnce(new RequestFailure('expired', 401, 'AUTH_REQUIRED'));
    await queue.start([file('first.png'), file('waiting.png')], 'original');
    expect(send).toHaveBeenCalledTimes(1); expect(queue.state.paused).toBe(true); expect(settled).not.toHaveBeenCalled();
    const original = send.mock.calls[0]; queue.resume('other'); await queue.retry(queue.state.items[0].id); expect(send).toHaveBeenCalledTimes(1);
    queue.resume('original'); await queue.retry(queue.state.items[0].id);
    expect(send.mock.calls[1]).toEqual(original); expect(send).toHaveBeenCalledTimes(3);
  });
  it('summarizes progress and only actionable issues without dropping frozen files or successful items', async () => {
    const { queue, send } = setup();
    send.mockResolvedValueOnce(image('first')).mockRejectedValueOnce(new RequestFailure('invalid', 400, 'IMAGE_INVALID')).mockRejectedValueOnce(new RequestFailure('lost'));
    await queue.start([file('ok.png'), file('bad.png'), file('unknown.png'), file('waiting.png')], 'actor');
    expect(queue.summary.value).toMatchObject({ total: 4, completed: 2, success: 1, failed: 1 });
    expect(queue.summary.value.issues.map(row => row.file.name)).toEqual(['bad.png', 'unknown.png']);
    const unknown = queue.summary.value.unknown!; const original = send.mock.calls[2];
    await queue.retry(unknown.id); expect(send.mock.calls[3]).toEqual(original);
    expect(queue.summary.value).toMatchObject({ completed: 4, success: 3, failed: 1, unknown: undefined });
    await queue.retry(queue.summary.value.issues[0].id);
    expect(queue.summary.value.success).toBe(4); expect(queue.summary.value.issues).toEqual([]);
  });
  it('rejects eleven files without requests and processes ten independent IDs serially', async () => {
    let concurrent = 0; let peak = 0;
    const { queue, send } = setup(vi.fn(async (id: string, _file: File, _user: string) => {
      void _file; void _user; peak = Math.max(peak, ++concurrent); await Promise.resolve(); concurrent--; return image(id);
    }));
    await queue.start(Array.from({ length: 11 }, () => file()), 'actor');
    expect(send).not.toHaveBeenCalled(); expect(queue.state.error).toContain('1–10');
    await queue.start(Array.from({ length: 10 }, () => file()), 'actor');
    expect(send).toHaveBeenCalledTimes(10); expect(peak).toBe(1);
    expect(new Set(send.mock.calls.map(row => row[0])).size).toBe(10);
    expect(queue.state.items.every(row => row.status === 'success')).toBe(true); expect(queue.active()).toBe(false);
  });

  it('keeps successes, reports local and server failures separately and retries only the failed original ID', async () => {
    const { queue, send } = setup();
    send.mockRejectedValueOnce(new RequestFailure('invalid decode', 400, 'IMAGE_INVALID', 'request-1'));
    await queue.start([file('bad.png'), new File(['txt'], 'text.txt', { type: 'text/plain' }), file('ok.png')], 'actor');
    expect(queue.state.items.map(row => row.status)).toEqual(['failed', 'failed', 'success']); expect(send).toHaveBeenCalledTimes(2);
    const failed = queue.state.items[0]; expect(failed.requestId).toBe('request-1');
    await queue.retry(failed.id);
    expect(send.mock.calls[0]).toEqual(send.mock.calls[2]); expect(queue.state.items[2].status).toBe('success');
  });

  it('pauses unknown results, keeps its original actor and payload, and prevents a second batch while pending', async () => {
    const { queue, send } = setup(); send.mockRejectedValueOnce(new RequestFailure('unknown'));
    await queue.start([file(), file('two.png')], 'original-user');
    expect(queue.active()).toBe(true); expect(queue.state.items.map(row => row.status)).toEqual(['unknown', 'waiting']);
    await queue.start([file('replacement.png')], 'other-user'); expect(send).toHaveBeenCalledTimes(1);
    await queue.retry(queue.state.items[0].id);
    expect(send.mock.calls[0]).toEqual(send.mock.calls[1]); expect(send.mock.calls[2][2]).toBe('original-user');
    expect(queue.state.items.every(row => row.status === 'success')).toBe(true);
  });

  it('continues after explicit abandonment without retransmitting or claiming cancellation', async () => {
    const { queue, send } = setup(); send.mockRejectedValueOnce(new Error('connection lost'));
    await queue.start([file(), file('two.png')], 'actor');
    const first = queue.state.items[0]; await queue.abandon(first.id);
    expect(first.status).toBe('abandoned'); expect(first.message).toContain('服务器可能已有图片');
    expect(send).toHaveBeenCalledTimes(2); expect(send.mock.calls[0][0]).not.toBe(send.mock.calls[1][0]); expect(queue.active()).toBe(false);
  });

  it('keeps the queue locked until list refresh completes', async () => {
    const { queue, send, settled } = setup();
    let unblock!: () => void; let entered!: () => void;
    const gate = new Promise<void>(resolve => { unblock = resolve; }); const started = new Promise<void>(resolve => { entered = resolve; });
    settled.mockImplementationOnce(async () => { entered(); await gate; });
    const pending = queue.start([file()], 'actor'); await started;
    expect(queue.active()).toBe(true); await queue.start([file('replacement.png')], 'other'); expect(send).toHaveBeenCalledTimes(1);
    unblock(); await pending; expect(queue.active()).toBe(false);
  });
  it('blocks reentry during a request and suppresses callbacks after disposal', async () => {
    let complete!: (value: ImageDto) => void;
    const { queue, send, settled } = setup(vi.fn((id: string, _file: File, _user: string) => {
      void id; void _file; void _user; return new Promise<ImageDto>(resolve => { complete = resolve; });
    }));
    const pending = queue.start([file()], 'actor');
    await queue.start([file('duplicate.png')], 'other'); await queue.retry(queue.state.items[0].id);
    expect(send).toHaveBeenCalledTimes(1); expect(queue.state.userId).toBe('actor');
    queue.dispose(); complete(image(queue.state.items[0].id)); await pending; expect(settled).not.toHaveBeenCalled();
  });
});
