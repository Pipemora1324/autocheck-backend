import { z } from 'zod';

const emailSchema = z
  .string({ error: 'El correo es obligatorio.' })
  .trim()
  .toLowerCase()
  .pipe(z.email({ error: 'Ingresa un correo válido.' }).max(254, 'El correo es demasiado largo.'));

// Límite superior para evitar hashear entradas enormes.
const newPasswordSchema = z
  .string({ error: 'La contraseña es obligatoria.' })
  .min(8, 'La contraseña debe tener al menos 8 caracteres.')
  .max(128, 'La contraseña no puede superar 128 caracteres.');

// Ley 1581 de 2012: la autorización para el tratamiento de datos debe ser previa, expresa e informada.
export const registerSchema = z.object({
  email: emailSchema,
  password: newPasswordSchema,
  acceptedTerms: z.literal(true, {
    error: 'Debes aceptar la política de tratamiento de datos personales para crear tu cuenta.'
  })
});

export const deleteAccountSchema = z.object({
  password: z
    .string({ error: 'Confirma tu contraseña para eliminar la cuenta.' })
    .min(1, 'Confirma tu contraseña para eliminar la cuenta.')
    .max(128)
});

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string({ error: 'La contraseña es obligatoria.' }).min(1, 'La contraseña es obligatoria.').max(128)
});

export const forgotPasswordSchema = z.object({ email: emailSchema });

const oneTimeTokenSchema = z
  .string({ error: 'El token es obligatorio.' })
  .trim()
  .min(1, 'El token es obligatorio.')
  .max(256);

export const resetPasswordSchema = z.object({
  token: oneTimeTokenSchema,
  password: newPasswordSchema
});

export const verifyEmailSchema = z.object({ token: oneTimeTokenSchema });

export const resendVerificationSchema = z.object({ email: emailSchema });
