import { jsonRequests, reviewApi, type RequestFailure } from './review-api';
import { librarySchema, workspaceDetailSchema, historyDetailSchema, revisionListSchema, saveResultSchema, type SaveReview, type DeleteImage } from '../../shared/workbench-contracts';
import { authenticatedUserSchema } from '../../shared/auth-contracts';

export function workbenchApi(fetcher: typeof fetch = fetch, onFailure?: (error: RequestFailure) => void) {
  const send = jsonRequests(fetcher, onFailure); const images = reviewApi(fetcher, onFailure);
  const identity = jsonRequests(fetcher);
  const json = (body: unknown, userId?: string) => ({ method: 'POST', headers: { 'Content-Type': 'application/json', ...(userId ? { 'X-Expected-User-Id': userId } : {}) }, body: JSON.stringify(body) });
  return {
    enter: (loginName: string, password: string) => identity('/api/auth/login', json({ loginName, password }), authenticatedUserSchema),
    register: (loginName: string, password: string, username?: string) => identity('/api/auth/register', json({ loginName, password, username }), authenticatedUserSchema),
    me: () => identity('/api/auth/me', {}, authenticatedUserSchema),
    logout: (userId: string) => send<void>('/api/auth/logout', json({}, userId)),
    library: (q: string, page: number, sort: string) => send(`/api/workbench/images?${new URLSearchParams({ q, page: String(page), sort })}`, {}, librarySchema),
    detail: (id: string) => send(`/api/workbench/images/${id}`, {}, workspaceDetailSchema),
    history: (id: string, page = 1) => send(`/api/workbench/images/${id}/history?page=${page}`, {}, revisionListSchema),
    historical: (id: string, revisionId: string) => send(`/api/workbench/images/${id}/history/${revisionId}`, {}, historyDetailSchema),
    save: (id: string, { userId, ...value }: SaveReview) => send(`/api/workbench/images/${id}/saves`, json(value, userId), saveResultSchema),
    upload: images.upload, content: images.content,
    removeImage: (id: string, { userId, ...value }: DeleteImage) => send<void>(`/api/images/${id}`, { ...json(value, userId), method: 'DELETE' }),
  };
}
export type WorkbenchApi = ReturnType<typeof workbenchApi>;
