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

/** Display name every house send carries. Mail from this platform is
    Thy Cheat Code speaking — a bare address reads as a robot. */
export const EMAIL_FROM_NAME = "Thy Cheat Code";

/**
 * Compose the From header. If the configured value already carries a
 * display name ("Some Name <addr>") it is respected untouched; a bare
 * address gets the house name. (Staging's EMAIL_FROM is a bare address,
 * which is why sends arrived with no sender name at all.)
 */
export function houseFromAddress(raw: string): string {
  const value = raw.trim();
  if (value.includes("<")) return value;
  return `${EMAIL_FROM_NAME} <${value}>`;
}

/**
 * The brand mark rendered in the email header: the owner's REAL logo —
 * the full illustrated lockup (King Shark over the BOW DOWN VISUALS
 * banner, "THE CONTENT CREATOR'S CHEAT CODE"), exported from
 * public/logo-static.webp as public/logo-email.png (600×600). The app
 * icon (public/icon-192.png) is NOT the logo and must never stand in
 * for it. Also NOT an emoji: mail clients render a raw 🦈 as a stock
 * cartoon shark, which is how a stock graphic ended up in the owner's
 * inbox.
 *
 * The URL must be absolute and anonymously reachable by mail clients.
 * bowdownvisuals.com is suspended-dark until launch (503) and the
 * staging host is password-gated (401), so the asset is served from the
 * owner's own public repo via the jsDelivr CDN — byte-identical to the
 * repo file (sha256 1c583113…). INTERIM home only: the default pins
 * @main because logo-email.png exists on main (shipped Oct 22, 2026)
 * and does NOT exist on the staging branch (the old @staging default
 * 404'd in every email header). The PERMANENT home is the R2 media
 * bucket alongside the rest of the site's media — move the file there
 * and point EMAIL_LOGO_URL at it when that upload happens.
 */
export const EMAIL_LOGO_URL =
  process.env.EMAIL_LOGO_URL ??
  "https://cdn.jsdelivr.net/gh/blockdollazboss/bow-down-visuals@main/artifacts/bow-down-visuals/public/logo-email.png";

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
  /** Provider tags (Resend carries them back on webhook events, which
     is one of the joins the engagement recorder uses). */
  tags?: Array<{ name: string; value: string }>;
  /** Extra RFC headers (e.g. List-Unsubscribe for bulk/list mail). */
  headers?: Record<string, string>;
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
      from: houseFromAddress(EMAIL_FROM),
      to,
      subject: opts.subject,
      html: opts.html,
      ...(opts.text ? { text: opts.text } : {}),
      ...(opts.replyTo ? { replyTo: opts.replyTo } : {}),
      ...(opts.tags && opts.tags.length > 0 ? { tags: opts.tags } : {}),
      ...(opts.headers ? { headers: opts.headers } : {}),
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

/**
 * ── Bow Down Visuals email design system (redesigned Oct 24, 2026) ──────────
 *
 * One branded shell for every transactional email: table-based layout +
 * inline styles only (Gmail / Apple Mail / Outlook), the full illustrated
 * logo lockup WHOLE at the top (EMAIL_LOGO_URL — never cropped, never the
 * app icon, never an emoji), a black-marble header band, a golden-marble
 * ivory card for the message, gold pill buttons, the King's sign-off, and
 * the brand line in the footer.
 *
 * Client-proofing choice: the band carries its own near-black background
 * and the card carries its own ivory background, so the design renders
 * identically on light and dark client canvases — no reliance on client
 * dark-mode behaviour. Body copy uses the on-card tokens below (dark ink
 * + antique gold on ivory), which stay premium and legible even if a
 * client strips backgrounds and forces everything onto white.
 */

/** Palette tokens shared by the shell and call-site email bodies. */
export const EMAIL_COLORS = {
  /** Deep warm black of the outer canvas. */
  canvas: "#12100b",
  /** Black-marble header band. */
  band: "#0c0a07",
  bandBorder: "#2b2416",
  /** Golden-marble ivory of the body card. */
  card: "#faf7f0",
  cardBorder: "#e2d3a7",
  /** Inset detail box (receipts, amounts, codes) on the card. */
  box: "#f3ecdb",
  boxBorder: "#d9c68d",
  /** Main text on the card. */
  ink: "#221c0e",
  /** Secondary text on the card. */
  body: "#4a4230",
  /** Muted small print on the card. */
  muted: "#8a7c5c",
  /** Antique gold — accents, links and strong text ON the ivory card. */
  goldDeep: "#a67c1a",
  /** Bright gold — on the dark band/canvas, and the button fill. */
  gold: "#d4af37",
  goldDim: "#9a8c6a",
} as const;

const EMAIL_SERIF = "Georgia,'Times New Roman',Times,serif";
const EMAIL_SANS =
  "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

export interface EmailShellOpts {
  /**
   * Sign-off rendered under the body. Defaults to the King's sign-off —
   * pass a string to override it, or `false` for internal mail (admin
   * alerts) that should not speak in the King's voice.
   */
  signoff?: string | false;
  /** Hidden inbox preview line shown by mail clients next to the subject. */
  preheader?: string;
}

/**
 * Bulletproof gold pill button (table-based so Outlook renders it too).
 * Presentation only — `href` is used verbatim as the anchor target.
 */
export function emailButton(href: string, label: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 4px;"><tr><td align="center" bgcolor="${EMAIL_COLORS.gold}" style="border-radius:999px;background:${EMAIL_COLORS.gold};"><a href="${href}" style="display:inline-block;padding:13px 32px;font-family:${EMAIL_SANS};font-size:14px;font-weight:700;letter-spacing:0.4px;color:#171204;text-decoration:none;border-radius:999px;">${label}</a></td></tr></table>`;
}

/** Gold-bordered inset box for receipts / amounts / codes / report details. */
export function emailDetailBox(innerHtml: string): string {
  return `<div style="background:${EMAIL_COLORS.box};border:1px solid ${EMAIL_COLORS.boxBorder};border-radius:10px;padding:18px 20px;margin:0 0 18px;">${innerHtml}</div>`;
}

export function emailShell(
  title: string,
  bodyHtml: string,
  opts: EmailShellOpts = {},
): string {
  const base = baseUrlForEmail();
  const signoff =
    opts.signoff === false
      ? ""
      : `<tr><td style="padding:2px 36px 30px;">
<div style="border-top:1px solid ${EMAIL_COLORS.cardBorder};padding-top:18px;">
<div style="font-family:${EMAIL_SERIF};font-style:italic;font-size:16px;color:${EMAIL_COLORS.goldDeep};">${opts.signoff ?? "— Thy Cheat Code"}</div>
<div style="font-family:${EMAIL_SANS};font-size:12px;color:${EMAIL_COLORS.muted};margin-top:3px;">Your host at Bow Down Visuals</div>
</div>
</td></tr>`;
  const preheader = opts.preheader
    ? `<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:${EMAIL_COLORS.canvas};">${opts.preheader}</div>`
    : "";
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><title>${title}</title></head>
<body style="margin:0;padding:0;background:${EMAIL_COLORS.canvas};">
${preheader}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${EMAIL_COLORS.canvas};">
<tr><td align="center" style="padding:36px 16px 40px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;">
<tr><td align="center" bgcolor="${EMAIL_COLORS.band}" style="background:${EMAIL_COLORS.band};border:1px solid ${EMAIL_COLORS.bandBorder};border-bottom:none;border-radius:16px 16px 0 0;padding:30px 24px 22px;">
<img src="${EMAIL_LOGO_URL}" width="232" alt="Bow Down Visuals — The Content Creator's Cheat Code" style="display:block;width:232px;max-width:72%;height:auto;border:0;">
<div style="font-family:${EMAIL_SANS};color:${EMAIL_COLORS.gold};font-weight:800;font-size:15px;letter-spacing:4px;margin-top:14px;">THY CHEAT CODE</div>
</td></tr>
<tr><td bgcolor="${EMAIL_COLORS.gold}" style="background:${EMAIL_COLORS.gold};font-size:0;line-height:0;height:3px;">&nbsp;</td></tr>
<tr><td bgcolor="#57441a" style="background:#57441a;font-size:0;line-height:0;height:1px;">&nbsp;</td></tr>
<tr><td bgcolor="${EMAIL_COLORS.card}" style="background:${EMAIL_COLORS.card};border:1px solid ${EMAIL_COLORS.cardBorder};border-top:none;border-radius:0 0 16px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
<tr><td style="padding:30px 36px 0;">
<div style="font-family:${EMAIL_SERIF};font-size:27px;line-height:1.25;font-weight:700;color:${EMAIL_COLORS.ink};">${title}</div>
</td></tr>
<tr><td style="padding:14px 36px 6px;font-family:${EMAIL_SANS};font-size:15px;line-height:1.65;color:${EMAIL_COLORS.body};">
${bodyHtml}
</td></tr>
${signoff}
</table>
</td></tr>
<tr><td align="center" style="padding:24px 24px 0;">
<div style="font-family:${EMAIL_SANS};font-size:12px;font-weight:700;letter-spacing:3px;color:${EMAIL_COLORS.gold};">BOW DOWN VISUALS</div>
<div style="font-family:${EMAIL_SERIF};font-style:italic;font-size:13px;color:${EMAIL_COLORS.goldDim};margin-top:5px;">The Content Creator's Cheat Code</div>
<div style="font-family:${EMAIL_SANS};font-size:12px;color:#6f6450;margin-top:12px;line-height:1.6;">This email was sent by Bow Down Visuals.<br><a href="${base}" style="color:${EMAIL_COLORS.gold};text-decoration:none;">bowdownvisuals.com</a></div>
</td></tr>
</table>
</td></tr>
</table>
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
