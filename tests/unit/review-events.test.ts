import { EventEmitter } from 'node:events';
import type { Response } from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createReviewEvents } from '../../src/server/http/review-events.js';
import { observeReviewUpdates, type UpdateHandlers } from '../../src/client/http/review-events';

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
function response(write: (chunk: string) => boolean = () => true) {
  const emitter = new EventEmitter();
  const value = Object.assign(emitter, { status: vi.fn(() => value), set: vi.fn(() => value), write: vi.fn(write), end: vi.fn(() => { emitter.emit('close'); return value; }), destroy: vi.fn(() => { emitter.emit('close'); return value; }) });
  return value as unknown as Response & { write: ReturnType<typeof vi.fn>; destroy: ReturnType<typeof vi.fn> };
}
const event = { type: 'image.changed' as const, imageId: crypto.randomUUID(), revisionId: crypto.randomUUID() };
describe('bounded update stream lifecycle', () => {
  it('closes an expired or revoked authenticated stream by the next heartbeat and releases its timer', () => {
    vi.useFakeTimers(); const hub = createReviewEvents(); const client = response(); const authorized = vi.fn(() => true);
    hub.connect(client, authorized); authorized.mockReturnValue(false); vi.advanceTimersByTime(15000);
    expect(client.write).toHaveBeenCalledWith('event: auth.required\ndata: {}\n\n'); expect(vi.getTimerCount()).toBe(0);
    const count = client.write.mock.calls.length; hub.publish(event); expect(client.write).toHaveBeenCalledTimes(count);
  });
  it('disconnects a slow client without delaying another client and clears heartbeats on shutdown', () => {
    vi.useFakeTimers(); const hub = createReviewEvents(); const fast = response(); const slow = response(chunk => chunk.startsWith(':'));
    hub.connect(fast); hub.connect(slow); expect(vi.getTimerCount()).toBe(2);
    hub.publish(event); expect(slow.destroy).toHaveBeenCalledOnce(); expect(fast.write).toHaveBeenCalledWith(expect.stringContaining(event.revisionId));
    expect(vi.getTimerCount()).toBe(1); vi.advanceTimersByTime(15000); expect(fast.write).toHaveBeenCalledWith(': heartbeat\n\n');
    hub.close(); expect(vi.getTimerCount()).toBe(0);
  });
  it('contains write failures, limits connection count, and releases a slot after disconnect', () => {
    vi.useFakeTimers(); const hub = createReviewEvents(); const broken = response(chunk => { if (chunk.startsWith('data:')) throw new Error('Disconnected'); return true; });
    hub.connect(broken); expect(() => hub.publish(event)).not.toThrow(); expect(broken.destroy).toHaveBeenCalledOnce();
    const clients = Array.from({ length: 128 }, () => response()); for (const client of clients) hub.connect(client);
    expect(() => hub.connect(response())).toThrow('连接过多'); clients[0].emit('close'); expect(() => hub.connect(response())).not.toThrow();
    hub.close(); expect(vi.getTimerCount()).toBe(0);
  });
});

describe('EventSource adapter validation and cleanup', () => {
  it('stops automatic reconnect when the server revokes authentication', () => {
    let revoked: (() => void) | undefined;
    class Source {
      static instance: Source; close = vi.fn();
      constructor() { Source.instance = this; }
      addEventListener(name: string, callback: () => void) { if (name === 'auth.required') revoked = callback; }
    }
    vi.stubGlobal('EventSource', Source);
    const handlers = { event: vi.fn(), ready: vi.fn(), status: vi.fn(), authRequired: vi.fn() };
    observeReviewUpdates(handlers); revoked!(); expect(Source.instance.close).toHaveBeenCalledOnce(); expect(handlers.authRequired).toHaveBeenCalledOnce();
  });
  it('resynchronizes every open, validates messages and ignores all callbacks after close', () => {
    const handlers: UpdateHandlers = { event: vi.fn(), ready: vi.fn(), status: vi.fn() };
    class Source {
      static instance: Source; onopen?: () => void; onerror?: () => void; onmessage?: (event: { data: string }) => void;
      close = vi.fn(); constructor(public url: string) { Source.instance = this; }
    }
    vi.stubGlobal('EventSource', Source); const stop = observeReviewUpdates(handlers); const source = Source.instance;
    expect(source.url).toBe('/api/events'); source.onopen!(); source.onerror!(); source.onopen!(); expect(handlers.ready).toHaveBeenCalledTimes(2);
    source.onmessage!({ data: 'bad JSON' }); source.onmessage!({ data: JSON.stringify({ ...event, imageId: '../private' }) }); expect(handlers.event).not.toHaveBeenCalled();
    source.onmessage!({ data: JSON.stringify(event) }); expect(handlers.event).toHaveBeenCalledWith(event);
    stop(); source.onopen!(); source.onmessage!({ data: JSON.stringify(event) }); expect(source.close).toHaveBeenCalledOnce(); expect(handlers.ready).toHaveBeenCalledTimes(2); expect(handlers.event).toHaveBeenCalledOnce();
  });
  it('leaves manual reconciliation available when the transport cannot be constructed', () => {
    vi.stubGlobal('EventSource', class { constructor() { throw new Error('Denied'); } });
    const handlers: UpdateHandlers = { event: vi.fn(), ready: vi.fn(), status: vi.fn() };
    const stop = observeReviewUpdates(handlers); expect(handlers.status).toHaveBeenLastCalledWith('unavailable'); expect(() => stop()).not.toThrow();
  });
});
