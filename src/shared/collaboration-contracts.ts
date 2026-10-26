import { z } from 'zod';
import { uuidSchema } from './review-contracts.js';

export const reviewEventSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('image.changed'), imageId: uuidSchema, revisionId: uuidSchema }),
  z.strictObject({ type: z.literal('image.deleted'), imageId: uuidSchema }),
]);
export type ReviewEvent = z.infer<typeof reviewEventSchema>;
