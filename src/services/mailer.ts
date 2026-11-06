import type { AppConfig } from '../config/env.js';
import { BrevoEmailSender, ConsoleEmailSender, SmtpEmailSender, type EmailSender } from './emailSender.js';

export interface Mailer {
  sendPasswordReset(to: string, resetUrl: string): Promise<void>;
  sendEmailVerification(to: string, verifyUrl: string): Promise<void>;
}

interface EmailContent {
  subject: string;
  text: string;
  html: string;
}

const HTML_ENTITIES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (char) => HTML_ENTITIES[char] ?? char);

export function passwordResetEmail(resetUrl: string): EmailContent {
  const subject = 'Restablece tu contraseña de AutoCheck-CO';
  const text = [
    'Hola,',
    '',
    'Recibimos una solicitud para restablecer la contraseña de tu cuenta en AutoCheck-CO.',
    'Abre este enlace para crear una nueva contraseña (vence en 30 minutos y solo se puede usar una vez):',
    '',
    resetUrl,
    '',
    'Si no solicitaste este cambio, ignora este correo: tu contraseña seguirá igual.',
    '',
    'Equipo AutoCheck-CO'
  ].join('\n');
  const link = escapeHtml(resetUrl);
  const html = `<!doctype html>
<html lang="es">
  <body style="font-family: Arial, sans-serif; color: #1f2933; line-height: 1.5;">
    <p>Hola,</p>
    <p>Recibimos una solicitud para restablecer la contraseña de tu cuenta en <strong>AutoCheck-CO</strong>.</p>
    <p>
      <a href="${link}" style="display: inline-block; padding: 10px 18px; background: #1d4ed8; color: #ffffff; text-decoration: none; border-radius: 6px;">
        Crear nueva contraseña
      </a>
    </p>
    <p style="font-size: 14px;">El enlace vence en 30 minutos y solo se puede usar una vez. Si el botón no funciona, copia esta dirección en tu navegador:<br>${link}</p>
    <p style="font-size: 14px;">Si no solicitaste este cambio, ignora este correo: tu contraseña seguirá igual.</p>
    <p>Equipo AutoCheck-CO</p>
  </body>
</html>`;
  return { subject, text, html };
}

export function emailVerificationEmail(verifyUrl: string): EmailContent {
  const subject = 'Confirma tu correo en AutoCheck-CO';
  const text = [
    'Hola,',
    '',
    'Gracias por registrarte en AutoCheck-CO. Confirma tu correo para empezar a consultar y registrar vehículos:',
    '',
    verifyUrl,
    '',
    'El enlace vence en 24 horas y solo se puede usar una vez.',
    'Si no creaste esta cuenta, ignora este correo.',
    '',
    'Equipo AutoCheck-CO'
  ].join('\n');
  const link = escapeHtml(verifyUrl);
  const html = `<!doctype html>
<html lang="es">
  <body style="font-family: Arial, sans-serif; color: #1f2933; line-height: 1.5;">
    <p>Hola,</p>
    <p>Gracias por registrarte en <strong>AutoCheck-CO</strong>. Confirma tu correo para empezar a consultar y registrar vehículos.</p>
    <p>
      <a href="${link}" style="display: inline-block; padding: 10px 18px; background: #1d4ed8; color: #ffffff; text-decoration: none; border-radius: 6px;">
        Confirmar correo
      </a>
    </p>
    <p style="font-size: 14px;">El enlace vence en 24 horas y solo se puede usar una vez. Si el botón no funciona, copia esta dirección en tu navegador:<br>${link}</p>
    <p style="font-size: 14px;">Si no creaste esta cuenta, ignora este correo.</p>
    <p>Equipo AutoCheck-CO</p>
  </body>
</html>`;
  return { subject, text, html };
}

/** Arma los correos en español y delega el envío en el proveedor configurado (Brevo, SMTP o consola). */
export class TemplatedMailer implements Mailer {
  constructor(private readonly sender: EmailSender) {}

  async sendPasswordReset(to: string, resetUrl: string): Promise<void> {
    await this.sender.send({ to, ...passwordResetEmail(resetUrl) });
  }

  async sendEmailVerification(to: string, verifyUrl: string): Promise<void> {
    await this.sender.send({ to, ...emailVerificationEmail(verifyUrl) });
  }
}

export function createEmailSender(config: Pick<AppConfig, 'email' | 'isProduction'>): EmailSender {
  const { email } = config;
  if (email.provider === 'brevo') return new BrevoEmailSender(email.apiKey, email.from);
  if (email.provider === 'smtp') return new SmtpEmailSender(email, email.from);
  // La consola imprime enlaces con tokens válidos: nunca en producción (env.ts ya lo rechaza al arrancar).
  if (config.isProduction) throw new Error('EMAIL_PROVIDER=console no está permitido en producción.');
  return new ConsoleEmailSender();
}

export function createMailer(config: Pick<AppConfig, 'email' | 'isProduction'>): Mailer {
  return new TemplatedMailer(createEmailSender(config));
}
