import { z } from 'zod';
import { userSchema } from './workbench-contracts.js';

export const loginNameSchema = z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9._-]{0,39}$/);
export const passwordSchema = z.string();
export const loginSchema = z.strictObject({ loginName: loginNameSchema, password: passwordSchema });
export const registrationSchema = loginSchema.extend({ username: z.string().trim().max(40).optional() });
export const roleSchema = z.enum(['member', 'admin']);
export const authenticatedUserSchema = userSchema.extend({ loginName: loginNameSchema, role: roleSchema });
export type AuthenticatedUser = z.infer<typeof authenticatedUserSchema>;
export type Role = z.infer<typeof roleSchema>;
