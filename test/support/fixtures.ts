/** Datos mínimos para crear un usuario directamente en un repositorio. */
export const newUser = (email: string) => ({ email, passwordHash: 'hash', termsAcceptedAt: new Date(), termsVersion: 'test' });
