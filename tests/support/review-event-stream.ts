import { reviewEventSchema, type ReviewEvent } from '../../src/shared/collaboration-contracts.js';

// Real HTTP stream helper; no browser or default user data is involved.
export async function readReviewEvents(base: string, fetcher: typeof fetch) {
  const controller = new AbortController();
  const response = await fetcher(base + '/api/events', { signal: controller.signal });
  if (response.status !== 200 || !response.headers.get('content-type')?.startsWith('text/event-stream')) throw new Error('Event stream unavailable');
  const reader = response.body!.getReader(); const decoder = new TextDecoder();
  const events: ReviewEvent[] = []; let buffer = ''; let stopped = false; let failure: unknown;
  const first = await reader.read();
  if (first.done || !decoder.decode(first.value).includes(': connected')) throw new Error('Event stream did not connect');
  const pump = (async () => {
    try {
      while (!stopped) {
        const chunk = await reader.read(); if (chunk.done) break;
        buffer += decoder.decode(chunk.value, { stream: true });
        let end: number;
        while ((end = buffer.indexOf('\n\n')) !== -1) {
          const frame = buffer.slice(0, end); buffer = buffer.slice(end + 2);
          for (const line of frame.split('\n')) if (line.startsWith('data: ')) events.push(reviewEventSchema.parse(JSON.parse(line.slice(6))));
        }
      }
    } catch (error) { if (!stopped) failure = error; }
  })();
  return { events,
    async until(predicate: (event: ReviewEvent) => boolean) {
      const deadline = Date.now() + 4000;
      while (!events.some(predicate)) {
        if (failure) throw failure;
        if (Date.now() > deadline) throw new Error('Expected review event did not arrive');
        await new Promise(resolve => setTimeout(resolve, 15));
      }
    },
    async close() { stopped = true; controller.abort(); await pump; },
  };
}
