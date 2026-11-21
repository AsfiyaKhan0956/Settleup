

async function createMailerTransport(options: {
  host: string;
  port: number;
  secure: boolean;
  auth: { user: string; pass: string };
  connectionTimeout: number;
  greetingTimeout: number;
  socketTimeout: number;
}) {
  const mailerModule = await import('nodemailer');
  const mailer = mailerModule.default ?? mailerModule;
  return mailer.createTransport(options);
}

export interface EmailSendResult {
  delivered: boolean;
  deliveryStatus: 'sent' | 'not_configured' | 'failed';
  errorMessage?: string;
}

export function isSmtpConfigured(): boolean {
  return Boolean(
    process.env.SMTP_HOST?.trim() &&
      process.env.SMTP_USER?.trim() &&
      process.env.SMTP_PASS?.trim()
  );
}


export async function sendPasswordResetEmail(params: { toEmail: string; resetUrl: string }): Promise<EmailSendResult> {
  if (!isSmtpConfigured()) {
    return { delivered: false, deliveryStatus: 'not_configured', errorMessage: 'SMTP email delivery is not configured.' };
  }
  const host = process.env.SMTP_HOST!.trim();
  const port = Number(process.env.SMTP_PORT || 587);
  const secure = process.env.SMTP_SECURE === 'true' || port === 465;
  const user = process.env.SMTP_USER!.trim();
  const pass = process.env.SMTP_PASS!.trim();
  const from = process.env.SMTP_FROM?.trim() || `SettleUp <${user}>`;
  try {
    const transporter = await createMailerTransport({ host, port, secure, auth: { user, pass }, connectionTimeout: 8000, greetingTimeout: 8000, socketTimeout: 10000 });
    await transporter.sendMail({
      from, to: params.toEmail, subject: 'Reset your SettleUp password',
      text: `A password reset was requested for your SettleUp account. This link expires in 30 minutes: ${params.resetUrl}\n\nIf you did not request this, you can ignore this email.`,
      html: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;padding:24px;color:#0f172a"><h2>Reset your SettleUp password</h2><p>We received a request to reset your password. This secure link expires in 30 minutes.</p><p><a href="${params.resetUrl.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}" style="display:inline-block;padding:12px 20px;background:#065f46;color:#fff;text-decoration:none;border-radius:8px">Reset password</a></p><p>If you did not request this, you can safely ignore this email.</p></div>`,
    });
    return { delivered: true, deliveryStatus: 'sent' };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'SMTP delivery error';
    return { delivered: false, deliveryStatus: 'failed', errorMessage: `Password reset email could not be delivered: ${msg}` };
  }
}

export function getPublicAppBaseUrl(req?: { protocol?: string; get?: (name: string) => string | undefined; headers?: Record<string, string | string[] | undefined> }): string {
  const envUrl = process.env.APP_URL?.trim();
  if (envUrl && envUrl !== 'MY_APP_URL' && /^https?:\/\//i.test(envUrl)) {
    const normalizedUrl = envUrl.replace(/\/+$/, '');
    if (process.env.NODE_ENV !== 'production' || (normalizedUrl.startsWith('https://') && !/localhost|127\.0\.0\.1/i.test(normalizedUrl))) {
      return normalizedUrl;
    }
  }
  if (process.env.NODE_ENV === 'production') {
    throw new Error('APP_URL must be configured with the public HTTPS SettleUp address before creating invitations in production.');
  }
  if (req) {
    const xfProto = req.headers?.['x-forwarded-proto'];
    const proto = typeof xfProto === 'string' ? xfProto.split(',')[0].trim() : req.protocol || 'http';
    const xfHost = req.headers?.['x-forwarded-host'];
    const host = (typeof xfHost === 'string' ? xfHost.split(',')[0].trim() : undefined) || req.get?.('host') || 'localhost:3000';
    return `${proto}://${host}`;
  }
  return 'http://localhost:3000';
}

export async function sendGroupInvitationEmail(params: {
  toEmail: string;
  groupName: string;
  groupDescription?: string;
  inviterName: string;
  inviteUrl: string;
  expiresInDays: number;
}): Promise<EmailSendResult> {
  if (!isSmtpConfigured()) {
    return {
      delivered: false,
      deliveryStatus: 'not_configured',
      errorMessage:
        'Email delivery is not configured in this environment (SMTP_HOST, SMTP_USER, and SMTP_PASS environment variables are not set). Share the invitation link, QR code, or WhatsApp invite directly instead.',
    };
  }

  const host = process.env.SMTP_HOST!.trim();
  const port = Number(process.env.SMTP_PORT || 587);
  const secure = process.env.SMTP_SECURE === 'true' || port === 465;
  const user = process.env.SMTP_USER!.trim();
  const pass = process.env.SMTP_PASS!.trim();
  const from = process.env.SMTP_FROM?.trim() || `SettleUp <${user}>`;

  try {
    const transporter = await createMailerTransport({
      host,
      port,
      secure,
      auth: { user, pass },
      connectionTimeout: 8000,
      greetingTimeout: 8000,
      socketTimeout: 10000,
    });

    const subject = `${params.inviterName} invited you to join "${params.groupName}" on SettleUp`;
    const text = [
      `Hello,`,
      ``,
      `${params.inviterName} invited you to join "${params.groupName}" on SettleUp. Would you like to join?`,
      params.groupDescription ? `Group note: ${params.groupDescription}` : '',
      ``,
      `Open this invitation to view the group or join:`,
      params.inviteUrl,
      ``,
      `This invitation expires in ${params.expiresInDays} days. You can view the group in read-only guest mode without an account. To join and make changes, sign in or create a SettleUp account and accept the invitation.`,
    ]
      .filter(Boolean)
      .join('\n');

    const escapeHtml = (s: string) =>
      s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

    const html = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px; color: #0F172A; background: #F8FAFC;">
        <div style="background: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 14px; padding: 28px;">
          <p style="margin: 0 0 6px; font-size: 12px; font-weight: 700; color: #065F46; letter-spacing: 0.04em; text-transform: uppercase;">SettleUp Group Invitation</p>
          <h1 style="margin: 0 0 12px; font-size: 20px; line-height: 1.3; color: #0F172A;">You're invited to join ${escapeHtml(params.groupName)}</h1>
          <p style="margin: 0 0 16px; font-size: 14px; line-height: 1.6; color: #475569;">
            <strong>${escapeHtml(params.inviterName)}</strong> invited you to join <strong>${escapeHtml(params.groupName)}</strong>. Would you like to join?
          </p>
          ${
            params.groupDescription
              ? `<p style="margin: 0 0 18px; padding: 12px; background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 8px; font-size: 13px; color: #475569;">${escapeHtml(params.groupDescription)}</p>`
              : ''
          }
          <a href="${escapeHtml(params.inviteUrl)}" style="display: inline-block; padding: 12px 22px; background: #065F46; color: #FFFFFF; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 14px;">View Group Invitation</a>
          <p style="margin: 18px 0 6px; font-size: 12px; color: #64748B;">Open this link in your browser to view the group, or sign in to join:</p>
          <p style="margin: 0; font-size: 12px; color: #0F172A; word-break: break-all;">${escapeHtml(params.inviteUrl)}</p>
          <p style="margin: 18px 0 0; font-size: 12px; color: #64748B; border-top: 1px solid #E2E8F0; padding-top: 14px;">
            Expires in ${params.expiresInDays} days. View the group in read-only guest mode, or sign in / register to join and make changes.
          </p>
        </div>
      </div>
    `;

    await transporter.sendMail({
      from,
      to: params.toEmail,
      subject,
      text,
      html,
    });

    return { delivered: true, deliveryStatus: 'sent' };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'SMTP delivery error';
    return {
      delivered: false,
      deliveryStatus: 'failed',
      errorMessage: `Email could not be delivered: ${msg}`,
    };
  }
}

export function isSmsConfigured(): boolean {
  return Boolean(
    process.env.TWILIO_ACCOUNT_SID?.trim() &&
      process.env.TWILIO_AUTH_TOKEN?.trim() &&
      process.env.TWILIO_FROM_NUMBER?.trim()
  );
}

export async function sendGroupInvitationSms(params: {
  toPhone: string;
  groupName: string;
  inviterName: string;
  inviteUrl: string;
}): Promise<EmailSendResult> {
  if (!isSmsConfigured()) {
    return {
      delivered: false,
      deliveryStatus: 'not_configured',
      errorMessage:
        'Automated SMS service is not configured in this environment (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER unset). Use Send via WhatsApp, Open SMS App, or Copy Link instead.',
    };
  }

  const sid = process.env.TWILIO_ACCOUNT_SID!.trim();
  const token = process.env.TWILIO_AUTH_TOKEN!.trim();
  const fromNumber = process.env.TWILIO_FROM_NUMBER!.trim();
  const body = `${params.inviterName} invited you to join "${params.groupName}" on SettleUp. View the group as a guest, or sign in to join: ${params.inviteUrl}`;

  try {
    const form = new URLSearchParams();
    form.set('To', params.toPhone);
    form.set('From', fromNumber);
    form.set('Body', body);

    const authHeader = Buffer.from(`${sid}:${token}`).toString('base64');
    const resp = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${authHeader}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: form.toString(),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      return {
        delivered: false,
        deliveryStatus: 'failed',
        errorMessage: `SMS provider rejected message (${resp.status}): ${errText.slice(0, 140)}`,
      };
    }

    return { delivered: true, deliveryStatus: 'sent' };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'SMS delivery error';
    return {
      delivered: false,
      deliveryStatus: 'failed',
      errorMessage: `SMS could not be delivered: ${msg}`,
    };
  }
}

