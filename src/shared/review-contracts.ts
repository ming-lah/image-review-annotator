import { z } from 'zod';

export const uuidSchema = z.uuid().transform(value => value.toLowerCase());
export const severitySchema = z.enum(['low', 'medium', 'high']);
export type Severity = z.infer<typeof severitySchema>;
export const actorSchema = z.strictObject({ actorId: uuidSchema, actorName: z.string().trim().min(1).max(40) });
const note = z.string().trim().min(1).max(2000);
const coordinate = z.number().min(0).max(1);
export const markerSizeSchema = z.number().int().min(12).max(48);
export const createAnnotationSchema = actorSchema.extend({ id: uuidSchema, x: coordinate, y: coordinate, note, severity: severitySchema, size: markerSizeSchema.optional() });
export const updateAnnotationSchema = actorSchema.extend({ version: z.number().int().positive(), note, severity: severitySchema, size: markerSizeSchema.optional() });
export const deleteAnnotationSchema = actorSchema.extend({ version: z.number().int().positive() });
export const imageSchema = z.strictObject({
  id: uuidSchema, originalName: z.string(), mimeType: z.enum(['image/png', 'image/jpeg', 'image/webp']),
  width: z.number().int().positive(), height: z.number().int().positive(), fileSize: z.number().int().positive(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/), createdAt: z.string(), updatedAt: z.string(),
});
export const annotationSchema = z.strictObject({
  id: uuidSchema, imageId: uuidSchema, number: z.number().int().positive(), x: coordinate, y: coordinate, note, severity: severitySchema,
  createdBy: uuidSchema, createdByName: z.string(), updatedBy: uuidSchema, updatedByName: z.string(),
  version: z.number().int().positive(), createdAt: z.string(), updatedAt: z.string(), size: markerSizeSchema.default(24),
});
export const imageDetailSchema = z.strictObject({ image: imageSchema, annotations: z.array(annotationSchema) });
export type ImageDto = z.infer<typeof imageSchema>;
export type AnnotationDto = z.infer<typeof annotationSchema>;
export type ImageDetail = z.infer<typeof imageDetailSchema>;
export type Actor = z.infer<typeof actorSchema>;
export type CreateAnnotation = z.infer<typeof createAnnotationSchema>;
export type UpdateAnnotation = z.infer<typeof updateAnnotationSchema>;
export type DeleteAnnotation = z.infer<typeof deleteAnnotationSchema>;
