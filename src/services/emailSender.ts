import nodemailer from 'nodemailer';
import type { MailFrom } from '../config/env.js';

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface EmailSender {
  send(message: EmailMessage): Promise<void>;
}

/** El proveedor rechazó el envío. El mensaje solo lleva el código HTTP: nunca el contenido ni los enlaces. */
export class EmailDeliveryError extends Error {}

export const BREVO_SEND_URL = 'https://api.brevo.com/v3/smtp/email';
const BREVO_TIMEOUT_MS = 10_000;

/**
 * Brevo por HTTPS (API v3, POST /v3/smtp/email con cabecera api-key). Se usa en Render porque
 * el plan gratuito bloquea los puertos SMTP 25/465/587. Responde 201 con { messageId } si acepta.
 */
export class BrevoEmailSender implements EmailSender {
  constructor(
    private readonly apiKey: string,
    private readonly from: MailFrom,
    private readonly fetchImpl: typeof fetch = fetch
  ) {}

  async send(message: EmailMessage): Promise<void> {
    let response: Response;
    try {
      response = await this.fetchImpl(BREVO_SEND_URL, {
        method: 'POST',
        headers: { 'api-key': this.apiKey, 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({
          sender: { email: this.from.email, name: this.from.name },
          to: [{ email: message.to }],
          subject: message.subject,
          htmlContent: message.html,
          textContent: message.text
        }),
        signal: AbortSignal.timeout(BREVO_TIMEOUT_MS)
      });
    } catch (error) {
      throw new EmailDeliveryError(`Brevo no respondió (${(error as Error).name}).`);
    }
    // No se lee ni se registra el cuerpo del error: solo el código de estado.
    if (!response.ok) throw new EmailDeliveryError(`Brevo respondió ${response.status}.`);
  }
}

export class SmtpEmailSender implements EmailSender {
  private readonly transporter;

  constructor(
    smtp: { host: string; port: number; user: string; pass: string },
    private readonly from: MailFrom
  ) {
    this.transporter = nodemailer.createTransport({
      host: smtp.host,
      port: smtp.port,
      secure: smtp.port === 465,
      auth: { user: smtp.user, pass: smtp.pass }
    });
  }

  async send(message: EmailMessage): Promise<void> {
    await this.transporter.sendMail({ from: { address: this.from.email, name: this.from.name }, ...message });
  }
}

/** Solo desarrollo: imprime el correo en texto plano (incluye el enlace) en lugar de enviarlo. */
export class ConsoleEmailSender implements EmailSender {
  async send(message: EmailMessage): Promise<void> {
    console.info(`[desarrollo] Correo para ${message.to}: ${message.subject}\n${message.text}`);
  }
}
