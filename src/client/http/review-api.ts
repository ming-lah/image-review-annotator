import type { z } from 'zod';
import { errorSchema } from '../../shared/contracts';
import { annotationSchema, imageDetailSchema, imageSchema, type CreateAnnotation, type DeleteAnnotation, type UpdateAnnotation } from '../../shared/review-contracts';

export class RequestFailure extends Error {
  constructor(message: string, public status: number | null = null, public code = 'RESULT_UNKNOWN', public requestId = '') { super(message); }
}
export function jsonRequests(fetcher: typeof fetch = fetch, onFailure?: (error: RequestFailure) => void) {
  return async function send<T>(url: string, init: RequestInit, schema?: z.ZodType<T>): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetcher(url, { ...init, signal: controller.signal, cache: 'no-store' });
      if (response.status === 204) return undefined as T;
      const body: unknown = await response.json();
      if (!response.ok) {
        const parsed = errorSchema.safeParse(body);
        if (parsed.success) throw new RequestFailure(parsed.data.error.message, response.status, parsed.data.error.code, parsed.data.error.requestId);
        throw new RequestFailure('服务响应无法确认，请核对最新结果');
      }
      if (schema) return schema.parse(body);
      throw new RequestFailure('服务响应无法确认');
    } catch (error) {
      if (error instanceof RequestFailure) { onFailure?.(error); throw error; }
      throw new RequestFailure('连接中断、超时或响应无效，结果尚未确认，请核对或重试');
    } finally { clearTimeout(timeout); }
  };
}
export function reviewApi(fetcher: typeof fetch = fetch, onFailure?: (error: RequestFailure) => void) {
  const send = jsonRequests(fetcher, onFailure);
  const json = (method: string, body: CreateAnnotation | UpdateAnnotation | DeleteAnnotation) => ({ method, headers: { 'Content-Type': 'application/json', 'X-Expected-User-Id': body.actorId }, body: JSON.stringify(body) });
  return {
    detail: (id: string) => send(`/api/images/${id}`, {}, imageDetailSchema),
    async content(id: string, name: string, mime: string) {
      const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 20000);
      try {
        const response = await fetcher(`/api/images/${id}/content`, { signal: controller.signal, cache: 'no-store' });
        if (!response.ok) {
          const error = errorSchema.safeParse(await response.json());
          if (error.success) throw new RequestFailure(error.data.error.message, response.status, error.data.error.code, error.data.error.requestId);
          throw new RequestFailure('图片内容读取失败');
        }
        return new File([await response.blob()], name, { type: mime });
      } catch (error) { if (error instanceof RequestFailure) { onFailure?.(error); throw error; } throw new RequestFailure('图片内容读取失败，请重试'); }
      finally { clearTimeout(timeout); }
    },
    upload(id: string, file: File, userId?: string) { const body = new FormData(); body.set('id', id); body.set('file', file); return send('/api/images', { method: 'POST', body, headers: userId ? { 'X-Expected-User-Id': userId } : undefined }, imageSchema); },
    create: (imageId: string, value: CreateAnnotation) => send(`/api/images/${imageId}/annotations`, json('POST', value), annotationSchema),
    update: (id: string, value: UpdateAnnotation) => send(`/api/annotations/${id}`, json('PATCH', value), annotationSchema),
    remove: (id: string, value: DeleteAnnotation) => send<void>(`/api/annotations/${id}`, json('DELETE', value)),
  };
}
export type ReviewApi = ReturnType<typeof reviewApi>;
