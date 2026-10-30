import nodemailer from 'nodemailer';
import type { AppConfig } from '../config/env.js';

export interface Mailer {
  sendPasswordReset(to: string, resetUrl: string): Promise<void>;
}

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);

export function passwordResetEmail(resetUrl: string): { subject: string; text: string; html: string } {
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

class SmtpMailer implements Mailer {
  private readonly transporter;

  constructor(private readonly smtp: NonNullable<AppConfig['smtp']>) {
    this.transporter = nodemailer.createTransport({
      host: smtp.host,
      port: smtp.port,
      secure: smtp.port === 465,
      auth: { user: smtp.user, pass: smtp.pass }
    });
  }

  async sendPasswordReset(to: string, resetUrl: string): Promise<void> {
    await this.transporter.sendMail({ from: this.smtp.from, to, ...passwordResetEmail(resetUrl) });
  }
}

class ConsoleMailer implements Mailer {
  async sendPasswordReset(to: string, resetUrl: string): Promise<void> {
    console.info(`[desarrollo] SMTP no configurado. Enlace de restablecimiento para ${to}: ${resetUrl}`);
  }
}

class DisabledMailer implements Mailer {
  async sendPasswordReset(): Promise<void> {
    console.warn('SMTP no configurado: no se envió el correo de restablecimiento de contraseña.');
  }
}

export function createMailer(config: AppConfig): Mailer {
  if (config.smtp) return new SmtpMailer(config.smtp);
  // El enlace nunca se imprime en producción: contiene un token válido.
  return config.isProduction ? new DisabledMailer() : new ConsoleMailer();
}
