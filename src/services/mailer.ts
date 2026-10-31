import nodemailer, { type Transporter } from 'nodemailer';
import type { Env } from '../config/env.js';

export type Mail = { to: string; subject: string; text: string; html: string };
export type MailSender = (mail: Mail & { from: string }) => Promise<void>;

let override: MailSender | null = null;
let transporter: Transporter | null = null;

/** Mail is on only when an SMTP login is configured (or a test sender is injected). */
export function mailEnabled(env: Env): boolean {
  return Boolean(override || (env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASS));
}

export function mailFrom(env: Env): string {
  return env.MAIL_FROM ?? env.SMTP_USER ?? '';
}

export async function sendMail(env: Env, mail: Mail): Promise<void> {
  const from = mailFrom(env);
  if (override) return override({ ...mail, from });
  if (!transporter) {
    const port = env.SMTP_PORT;
    transporter = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port,
      secure: port === 465,
      auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
      connectionTimeout: 10_000,
      socketTimeout: 15_000,
    });
  }
  await transporter.sendMail({ from, ...mail });
}

/** Tests inject a sender so nothing leaves the machine. */
export function setMailSenderForTests(sender: MailSender | null): void {
  override = sender;
  transporter = null;
}
