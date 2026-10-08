/**
 * Central transactional email helper (Resend).
 *
 * Fail-open by design: if RESEND_API_KEY is not configured, sends are
 * skipped with a warning log and { sent: false, reason: "no-provider" }.
 * Email must NEVER throw and NEVER break the request that triggered it
 * (purchases, invites, payouts all continue without the email).
 *
 * Env:
 *   RESEND_API_KEY  — Resend API key (secret; set on Render, never in chat)
 *   EMAIL_FROM      — sender address, default noreply@bowdownvisuals.com
 */
import { Resend } from "resend";
import { logger } from "./logger.js";

const RESEND_API_KEY = process.env.RESEND_API_KEY ?? "";
const EMAIL_FROM = process.env.EMAIL_FROM ?? "noreply@bowdownvisuals.com";

let client: Resend | null = null;
function getClient(): Resend | null {
  if (!RESEND_API_KEY) return null;
  if (!client) client = new Resend(RESEND_API_KEY);
  return client;
}

/** True when a provider key is configured. Safe to call at boot. */
export function isEmailConfigured(): boolean {
  return RESEND_API_KEY.length > 0;
}

export interface SendEmailOpts {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  replyTo?: string;
}

export interface SendEmailResult {
  sent: boolean;
  id?: string;
  reason?: string;
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

export async function sendEmail(opts: SendEmailOpts): Promise<SendEmailResult> {
  const to = (Array.isArray(opts.to) ? opts.to : [opts.to])
    .map((e) => e.trim())
    .filter((e) => e.length > 0 && isValidEmail(e));

  if (to.length === 0) {
    logger.warn({ subject: opts.subject }, "[email] skipped: no valid recipient");
    return { sent: false, reason: "no-recipient" };
  }

  const resend = getClient();
  if (!resend) {
    logger.warn(
      { to, subject: opts.subject },
      "[email] skipped: RESEND_API_KEY not configured (fail-open)"
    );
    return { sent: false, reason: "no-provider" };
  }

  try {
    const { data, error } = await resend.emails.send({
      from: EMAIL_FROM,
      to,
      subject: opts.subject,
      html: opts.html,
      ...(opts.text ? { text: opts.text } : {}),
      ...(opts.replyTo ? { replyTo: opts.replyTo } : {}),
    });
    if (error) {
      logger.warn({ to, subject: opts.subject, error }, "[email] provider error (fail-open)");
      return { sent: false, reason: "provider-error" };
    }
    logger.info({ to, subject: opts.subject, id: data?.id }, "[email] sent");
    return { sent: true, id: data?.id };
  } catch (err) {
    // Never throw — email must not break the triggering request.
    logger.warn({ to, subject: opts.subject, err }, "[email] exception (fail-open)");
    return { sent: false, reason: "exception" };
  }
}

/** Minimal gold/black branded shell shared by transactional emails. */
export function emailShell(title: string, bodyHtml: string): string {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0a0a0a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<div style="max-width:560px;margin:0 auto;padding:32px 24px;">
<div style="text-align:center;margin-bottom:24px;">
<span style="font-size:28px;">🦈</span>
<div style="color:#d4af37;font-weight:800;font-size:20px;letter-spacing:1px;margin-top:8px;">THY CHEAT CODE</div>
<div style="color:#888;font-size:12px;letter-spacing:3px;">BOW DOWN VISUALS</div>
</div>
<div style="background:#141414;border:1px solid #2a2a2a;border-radius:12px;padding:28px;color:#eee;">
<div style="color:#d4af37;font-size:18px;font-weight:700;margin-bottom:16px;">${title}</div>
${bodyHtml}
</div>
<div style="text-align:center;color:#666;font-size:12px;margin-top:20px;">
This email was sent by Bow Down Visuals.<br>
<a href="https://bowdownvisuals.com" style="color:#d4af37;">bowdownvisuals.com</a>
</div>
</div>
</body></html>`;
}

export function money(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

/** Escape user-controlled strings before interpolating into email HTML. */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Public site URL for email links. Prefers explicit env, then the request
 * host is handled by callers; falls back to the production domain.
 */
export function baseUrlForEmail(): string {
  return (
    process.env["PUBLIC_BASE_URL"] ??
    process.env["SITE_URL"] ??
    "https://bowdownvisuals.com"
  );
}
