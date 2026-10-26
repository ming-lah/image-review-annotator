import { jsonRequests, reviewApi } from './review-api';
import { userSchema, librarySchema, workspaceDetailSchema, historyDetailSchema, revisionListSchema, saveResultSchema, type SaveReview } from '../../shared/workbench-contracts';

export function workbenchApi(fetcher: typeof fetch = fetch) {
  const send = jsonRequests(fetcher); const images = reviewApi(fetcher);
  const json = (body: unknown) => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return {
    enter: (username: string, userId?: string) => send('/api/workbench/users/enter', json({ username, userId }), userSchema),
    library: (q: string, page: number, sort: string) => send(`/api/workbench/images?${new URLSearchParams({ q, page: String(page), sort })}`, {}, librarySchema),
    detail: (id: string) => send(`/api/workbench/images/${id}`, {}, workspaceDetailSchema),
    history: (id: string, page = 1) => send(`/api/workbench/images/${id}/history?page=${page}`, {}, revisionListSchema),
    historical: (id: string, revisionId: string) => send(`/api/workbench/images/${id}/history/${revisionId}`, {}, historyDetailSchema),
    save: (id: string, value: SaveReview) => send(`/api/workbench/images/${id}/saves`, json(value), saveResultSchema),
    upload: images.upload, content: images.content,
  };
}
export type WorkbenchApi = ReturnType<typeof workbenchApi>;
