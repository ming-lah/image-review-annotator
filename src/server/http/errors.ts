import type { z } from 'zod';

export class ApiFailure extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}
export function parseInput<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  const field = result.error.issues[0]?.path[0];
  if (field === 'note') throw new ApiFailure(400, 'ANNOTATION_NOTE_INVALID', '说明须为 1–2000 字符');
  if (field === 'x' || field === 'y') throw new ApiFailure(400, 'ANNOTATION_COORDINATE_OUT_OF_RANGE', '坐标须为 0 到 1 的有限数');
  if (field === 'actorId' || field === 'actorName') throw new ApiFailure(400, 'ACTOR_INVALID', '请填写有效昵称');
  throw new ApiFailure(400, 'INVALID_REQUEST', '请求参数无效');
}
