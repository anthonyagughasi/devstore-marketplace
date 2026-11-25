export type TransactionalEmailEvent =
  | 'account_registration'
  | 'email_verification'
  | 'password_recovery'
  | 'seller_application_submitted'
  | 'seller_approved'
  | 'product_approved'
  | 'new_order'
  | 'payment_confirmation'
  | 'order_shipped'
  | 'order_delivered'
  | 'refund_update'
  | 'withdrawal_update';

export interface SendEmailInput {
  to: string;
  event: TransactionalEmailEvent;
  subject?: string;
  htmlBody?: string;
  templateVars?: Record<string, string>;
  isDemoContext: boolean;
}

export interface SendEmailResult {
  sent: boolean;
  status: 'sent' | 'disabled_unconfigured' | 'blocked_demo' | 'delivery_failed';
  provider: 'resend' | 'none';
  blockedByDemo?: boolean;
  configured: boolean;
  missingEnvVars?: string[];
  messageId?: string;
  previewRecorded?: boolean;
  reason?: string;
}

export interface DevEmailPreview {
  id: string;
  event: TransactionalEmailEvent;
  to: string;
  subject: string;
  htmlBody: string;
  status: SendEmailResult['status'];
  createdAt: string;
}

export interface EmailProviderAdapter {
  readonly id: 'resend' | 'none';
  isConfigured(): boolean;
  getMissingEnvVars(): string[];
  send(params: { to: string; subject: string; htmlBody: string }): Promise<{
    sent: boolean;
    messageId?: string;
    reason?: string;
  }>;
}

const EVENT_TEMPLATES: Record<
  TransactionalEmailEvent,
  (vars: Record<string, string>) => { subject: string; htmlBody: string }
> = {
  account_registration: (v) => ({
    subject: `Welcome to DevStore${v.name ? `, ${v.name}` : ''}`,
    htmlBody: `<h1>Welcome to DevStore</h1><p>Your marketplace account is active. You can browse physical and licensed digital products across USD, NGN, GBP, and EUR.</p>`,
  }),
  email_verification: (v) => ({
    subject: 'Verify your DevStore email address',
    htmlBody: `<p>Verify your email address to unlock protected orders and digital license downloads.</p>${v.actionUrl ? `<p><a href="${v.actionUrl}">Verify Email</a></p>` : ''}`,
  }),
  password_recovery: (v) => ({
    subject: 'DevStore Password Recovery',
    htmlBody: `<p>A password reset was requested for <strong>${v.email || 'your account'}</strong>.</p>${v.actionUrl ? `<p><a href="${v.actionUrl}">Reset Password</a></p>` : '<p>Use Firebase account recovery or Google Account security settings if you sign in via Google OAuth.</p>'}`,
  }),
  seller_application_submitted: (v) => ({
    subject: `Seller Application Received: ${v.businessName || 'New Store'}`,
    htmlBody: `<p>Your seller onboarding application for <strong>${v.businessName || 'your store'}</strong> has been submitted for administrator verification.</p>`,
  }),
  seller_approved: (v) => ({
    subject: `Store Approved on DevStore: ${v.storeName || ''}`,
    htmlBody: `<p>Congratulations! Your store <strong>${v.storeName || ''}</strong> is now verified and active.</p>`,
  }),
  product_approved: (v) => ({
    subject: `Listing Approved: ${v.productTitle || 'Product'}`,
    htmlBody: `<p>Your product listing <strong>${v.productTitle || ''}</strong> passed marketplace moderation and is now live.</p>`,
  }),
  new_order: (v) => ({
    subject: `New Seller Order ${v.orderId || ''}`,
    htmlBody: `<p>You received a new order <strong>${v.orderId || ''}</strong>. Log in to your Seller Dashboard to process and add tracking.</p>`,
  }),
  payment_confirmation: (v) => ({
    subject: `Payment Confirmed for Order ${v.orderId || ''}`,
    htmlBody: `<p>Payment reference <code>${v.reference || ''}</code> has been verified. Any digital licenses are unlocked in your Download Library.</p>`,
  }),
  order_shipped: (v) => ({
    subject: `Order ${v.orderId || ''} Shipped`,
    htmlBody: `<p>Your order has shipped${v.trackingNumber ? ` (Tracking: <code>${v.trackingNumber}</code>)` : ''}.</p>`,
  }),
  order_delivered: (v) => ({
    subject: `Order ${v.orderId || ''} Delivered`,
    htmlBody: `<p>Your order <strong>${v.orderId || ''}</strong> has been marked delivered.</p>`,
  }),
  refund_update: (v) => ({
    subject: `Refund Update for ${v.orderId || ''}`,
    htmlBody: `<p>Refund status updated: <strong>${v.status || 'reviewed'}</strong>.</p>`,
  }),
  withdrawal_update: (v) => ({
    subject: `Seller Withdrawal Update (${v.withdrawalId || ''})`,
    htmlBody: `<p>Your payout request status is now: <strong>${v.status || 'updated'}</strong>.</p>`,
  }),
};

export function renderTransactionalEmailTemplate(
  event: TransactionalEmailEvent,
  vars: Record<string, string> = {}
): { subject: string; htmlBody: string } {
  const builder = EVENT_TEMPLATES[event];
  return builder(vars);
}

class ResendEmailProvider implements EmailProviderAdapter {
  readonly id = 'resend' as const;

  isConfigured(): boolean {
    return Boolean(process.env.RESEND_API_KEY?.trim() && process.env.EMAIL_FROM?.trim());
  }

  getMissingEnvVars(): string[] {
    const missing: string[] = [];
    if (!process.env.RESEND_API_KEY?.trim()) missing.push('RESEND_API_KEY');
    if (!process.env.EMAIL_FROM?.trim()) missing.push('EMAIL_FROM');
    return missing;
  }

  async send(params: { to: string; subject: string; htmlBody: string }) {
    const apiKey = process.env.RESEND_API_KEY?.trim();
    const from = process.env.EMAIL_FROM?.trim();

    if (!apiKey || !from) {
      return {
        sent: false,
        reason: 'Resend email credentials (RESEND_API_KEY / EMAIL_FROM) are not configured.',
      };
    }

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: [params.to],
        subject: params.subject,
        html: params.htmlBody,
      }),
    });

    const data = (await res.json()) as { id?: string; message?: string };
    if (!res.ok || !data.id) {
      return {
        sent: false,
        reason: data.message || 'Email delivery failed.',
      };
    }

    return {
      sent: true,
      messageId: data.id,
    };
  }
}

const resendProvider = new ResendEmailProvider();
const devEmailPreviewQueue: DevEmailPreview[] = [];
const MAX_DEV_PREVIEWS = 40;

function recordDevPreview(preview: DevEmailPreview): boolean {
  if (process.env.NODE_ENV === 'production') {
    return false;
  }
  devEmailPreviewQueue.unshift(preview);
  if (devEmailPreviewQueue.length > MAX_DEV_PREVIEWS) {
    devEmailPreviewQueue.length = MAX_DEV_PREVIEWS;
  }
  return true;
}

export function getDevEmailPreviews(): DevEmailPreview[] {
  if (process.env.NODE_ENV === 'production') {
    return [];
  }
  return [...devEmailPreviewQueue];
}

export function clearDevEmailPreviews(): void {
  devEmailPreviewQueue.length = 0;
}

export function getEmailProviderStatus() {
  return {
    provider: resendProvider.isConfigured() ? 'Resend' : 'Disabled (Optional)',
    configured: resendProvider.isConfigured(),
    optional: true,
    missingEnvVars: resendProvider.getMissingEnvVars(),
    devPreviewEnabled: process.env.NODE_ENV !== 'production',
  };
}

export async function sendTransactionalEmail(input: SendEmailInput): Promise<SendEmailResult> {
  const rendered = renderTransactionalEmailTemplate(input.event, input.templateVars);
  const subject = input.subject?.trim() || rendered.subject;
  const htmlBody = input.htmlBody?.trim() || rendered.htmlBody;

  // Demo actions must NEVER trigger real external emails
  if (input.isDemoContext) {
    const previewRecorded = recordDevPreview({
      id: `prev-${Date.now()}`,
      event: input.event,
      to: input.to,
      subject,
      htmlBody,
      status: 'blocked_demo',
      createdAt: new Date().toISOString(),
    });
    return {
      sent: false,
      status: 'blocked_demo',
      provider: resendProvider.isConfigured() ? 'resend' : 'none',
      blockedByDemo: true,
      configured: resendProvider.isConfigured(),
      previewRecorded,
      reason: 'External emails are strictly disabled inside Demo Mode.',
    };
  }

  // Gracefully disable external delivery when no email provider is configured
  if (!resendProvider.isConfigured()) {
    const previewRecorded = recordDevPreview({
      id: `prev-${Date.now()}`,
      event: input.event,
      to: input.to,
      subject,
      htmlBody,
      status: 'disabled_unconfigured',
      createdAt: new Date().toISOString(),
    });
    return {
      sent: false,
      status: 'disabled_unconfigured',
      provider: 'none',
      configured: false,
      missingEnvVars: resendProvider.getMissingEnvVars(),
      previewRecorded,
      reason:
        'External email delivery is disabled because RESEND_API_KEY / EMAIL_FROM are not configured.',
    };
  }

  const res = await resendProvider.send({ to: input.to, subject, htmlBody });
  if (!res.sent) {
    return {
      sent: false,
      status: 'delivery_failed',
      provider: 'resend',
      configured: true,
      reason: res.reason,
    };
  }

  return {
    sent: true,
    status: 'sent',
    provider: 'resend',
    configured: true,
    messageId: res.messageId,
  };
}
