import { z } from 'zod';

export const healthSchema = z.object({ status: z.literal('ok') });
export const readySchema = z.object({ status: z.literal('ready') });
export const errorSchema = z.object({ error: z.object({ code: z.string(), message: z.string(), requestId: z.string() }) });
export type ApiError = z.infer<typeof errorSchema>;
