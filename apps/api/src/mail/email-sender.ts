import { Logger } from '@nestjs/common';
import { createTransport } from 'nodemailer';

export interface Email {
  to: string;
  subject: string;
  /** Plain text. An HTML version is made from it, so every email reads well in any mail app. */
  text: string;
  /** Optional button shown under the text. */
  action?: { label: string; url: string };
}

/** Sends email. Swap the implementation to change provider; the app only uses this. */
export abstract class EmailSender {
  abstract send(email: Email): Promise<void>;
}

const escape = (value: string) =>
  value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);

/** Simple, accessible HTML in the YuCampus colours. Plain text stays the main content. */
export function renderEmail(email: Email): { text: string; html: string } {
  const paragraphs = email.text
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 14px;line-height:1.55">${escape(p).replace(/\n/g, '<br>')}</p>`)
    .join('');
  const button = email.action
    ? `<p style="margin:20px 0"><a href="${escape(email.action.url)}" style="background:#2B3990;color:#ffffff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600;display:inline-block">${escape(email.action.label)}</a></p>`
    : '';
  const html = `<!doctype html><html><body style="margin:0;background:#F5F6FA;font-family:'Plus Jakarta Sans',Segoe UI,Arial,sans-serif;color:#121733">
<div style="max-width:560px;margin:0 auto;padding:24px">
<p style="font-weight:800;font-size:18px;margin:0 0 16px"><span style="color:#0E7068">Yu</span>Campus</p>
<div style="background:#ffffff;border:1px solid #E3E6EF;border-radius:12px;padding:24px;font-size:15px">${paragraphs}${button}</div>
<p style="font-size:12px;color:#545B73;margin:16px 0 0">You get this because of your YuCampus account. Choose which emails you receive under Notifications in YuCampus.</p>
</div></body></html>`;
  const text = email.action ? `${email.text}\n\n${email.action.label}: ${email.action.url}` : email.text;
  return { text, html };
}

export class SmtpEmailSender extends EmailSender {
  private readonly transport;

  constructor(
    smtpUrl: string,
    private readonly from: string,
  ) {
    super();
    this.transport = createTransport(smtpUrl);
  }

  async send(email: Email): Promise<void> {
    await this.transport.sendMail({ from: this.from, to: email.to, subject: email.subject, ...renderEmail(email) });
  }
}

/** No SMTP configured (local work without Docker): prints emails in the API console instead. */
export class ConsoleEmailSender extends EmailSender {
  private readonly logger = new Logger('Email');
  readonly sent: Email[] = [];

  async send(email: Email): Promise<void> {
    this.sent.push(email);
    this.logger.log(`To ${email.to}: ${email.subject}${email.action ? `\n  ${email.action.label}: ${email.action.url}` : ''}`);
  }
}
