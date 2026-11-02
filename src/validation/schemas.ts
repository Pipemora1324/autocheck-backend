import { z } from 'zod';
import { INSPECTION_STATUSES } from '../interfaces/vehicle.js';

export const emailSchema = z
  .string({ error: 'El correo es obligatorio.' })
  .trim()
  .toLowerCase()
  .pipe(z.email({ error: 'Ingresa un correo válido.' }).max(254, 'El correo es demasiado largo.'));

// Límite superior para evitar hashear entradas enormes.
export const newPasswordSchema = z
  .string({ error: 'La contraseña es obligatoria.' })
  .min(8, 'La contraseña debe tener al menos 8 caracteres.')
  .max(128, 'La contraseña no puede superar 128 caracteres.');

export const registerSchema = z.object({ email: emailSchema, password: newPasswordSchema });

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string({ error: 'La contraseña es obligatoria.' }).min(1, 'La contraseña es obligatoria.').max(128)
});

export const forgotPasswordSchema = z.object({ email: emailSchema });

const oneTimeTokenSchema = z.string({ error: 'El token es obligatorio.' }).trim().min(1, 'El token es obligatorio.').max(256);

export const resetPasswordSchema = z.object({
  token: oneTimeTokenSchema,
  password: newPasswordSchema
});

export const verifyEmailSchema = z.object({ token: oneTimeTokenSchema });

export const resendVerificationSchema = z.object({ email: emailSchema });

export const plateSchema = z
  .string({ error: 'La placa es obligatoria.' })
  .trim()
  .toUpperCase()
  .pipe(z.string().regex(/^[A-Z]{3}-\d{4}$/, 'Ingresa una placa válida en el formato ABC-1234.'));

export const plateParamsSchema = z.object({ plate: plateSchema });

export const scanSchema = z.object({
  plate: plateSchema,
  source: z.enum(['image', 'manual']).default('manual')
});

const requiredText = (field: string, max: number) =>
  z.string({ error: `${field} es obligatorio.` }).trim().min(1, `${field} es obligatorio.`).max(max, `${field} no puede superar ${max} caracteres.`);

// updatedBy no se acepta del cliente: sale del usuario autenticado.
export const inspectionUpdateSchema = z.object({
  inspectionId: requiredText('El identificador de la inspección', 50),
  status: z.enum(INSPECTION_STATUSES, { error: 'El estado debe ser Aprobado, Atención o No aprobado.' }),
  result: requiredText('El resultado', 500),
  notes: requiredText('Las notas', 2000)
});
