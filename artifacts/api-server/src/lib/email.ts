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
import {
  recordEmailThemeSent,
  resolveEmailThemeForRecipient,
  type EmailTheme,
} from "./email-theme-rotation.js";

export type { EmailTheme } from "./email-theme-rotation.js";

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
 * staging host is password-gated (401), so the asset lives in its
 * PERMANENT home: the R2 media bucket alongside the rest of the site's
 * media, as logo-email.png (600×600, the same export as the repo file
 * artifacts/bow-down-visuals/public/logo-email.png, sha256 1c583113…).
 * It previously served from the owner's public repo via the jsDelivr
 * CDN (@main) as an interim home; that default retired in the R2 flip
 * (Oct 26, 2026). The EMAIL_LOGO_URL env var still overrides this
 * default when set.
 */
export const EMAIL_LOGO_URL =
  process.env.EMAIL_LOGO_URL ??
  "https://pub-424304b1e8d24fa28e3a072be022c74b.r2.dev/logo-email.png";

/**
 * The LIGHT send's lockup: the light-theme export of the same full
 * illustrated lockup (from public/logo-light.webp), hosted in the
 * approved automatic-email design (artifact
 * "automatic-emails-company-theme", owner-approved Nov 7 + Nov 11,
 * 2026 — its exported template carries this exact hosted asset).
 * The EMAIL_LOGO_LIGHT_URL env var overrides it, mirroring
 * EMAIL_LOGO_URL. The dark send keeps EMAIL_LOGO_URL above (the
 * permanent R2 home of the dark lockup) — same artwork family, the
 * dark email export of public/logo-static.webp.
 */
export const EMAIL_LOGO_LIGHT_URL =
  process.env.EMAIL_LOGO_LIGHT_URL ??
  "https://cdn.jsdelivr.net/gh/blockdollazboss/bow-down-visuals@theme-asset/theme/logo-email-light-transparent.png";

/** The lockup a themed send carries — dark logo on the dark send,
    light logo on the light send, header crest and signature alike. */
export function emailLogoUrlForTheme(theme: EmailTheme): string {
  return theme === "dark" ? EMAIL_LOGO_URL : EMAIL_LOGO_LIGHT_URL;
}

/**
 * The marble splash stones, exactly as the approved design's export
 * carries them (same hosted masters the Brevo sends use): black
 * marble for the dark send, golden marble for the light send. The
 * stone appears ONLY in the header band and the 30px foot strip —
 * a splash (~15% of the surface), never a ground or a frame.
 */
export const EMAIL_MARBLE_URLS: Record<EmailTheme, string> = {
  dark: "https://cdn.jsdelivr.net/gh/blockdollazboss/bow-down-visuals@theme-asset/theme/marble-black-email-v3.jpg",
  light: "https://cdn.jsdelivr.net/gh/blockdollazboss/bow-down-visuals@theme-asset/theme/marble-gold-email-v3.jpg",
};

export function emailMarbleUrlForTheme(theme: EmailTheme): string {
  return EMAIL_MARBLE_URLS[theme];
}

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

interface SendEmailOpts {
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
  /**
   * Theme-rotation bookkeeping: when both are set and the send is
   * VERIFIED sent, the customer's rotation flips past `theme`
   * (see lib/email-theme-rotation.ts). A failed or skipped send
   * records nothing, so a retry keeps its assigned theme.
   */
  theme?: EmailTheme;
  themeRecipient?: string;
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
    if (opts.theme && opts.themeRecipient) {
      /* Verified sent — the ONLY moment a customer's theme flips. */
      void recordEmailThemeSent(opts.themeRecipient, opts.theme).catch(
        () => undefined,
      );
    }
    return { sent: true, id: data?.id };
  } catch (err) {
    // Never throw — email must not break the triggering request.
    logger.warn({ to, subject: opts.subject, err }, "[email] exception (fail-open)");
    return { sent: false, reason: "exception" };
  }
}

/**
 * ── Bow Down Visuals email design system ───────────────────────────────────
 *
 * COMPANY-THEME DESIGN (owner-approved Nov 7, 2026, re-approved
 * Nov 11, 2026 — artifact "automatic-emails-company-theme"): every
 * automatic email is a 620px table shell carrying a SPLASH of marble
 * (~15% of the surface) — one calm stone HEADER BAND across the very
 * top with the full illustrated logo lockup floating on it as a crest
 * (never cropped, never boxed, never the app icon, never an emoji),
 * a 2px gold line under the band, one calm panel for the words, a
 * rich gold call-to-action button, a closing SIGNATURE whose lockup
 * matches the send, and a matching 30px stone strip at the foot.
 * No marble ground, no marble frames, no text on the stone.
 *
 * BOTH THEMES, AS A DESIGNED PAIR (not an inversion): the DARK send
 * is black marble + a deep-charcoal panel with warm gold; the LIGHT
 * send is golden marble + the golden-marble ivory panel. Which theme
 * a customer gets alternates per customer in strict rotation
 * (dark, light, dark, light — lib/email-theme-rotation.ts); callers
 * resolve the theme for their recipient and pass it to emailShell,
 * or use emailShellForRecipient(). With no theme passed, the shell
 * renders LIGHT — the token-native theme every existing call-site
 * body (EMAIL_COLORS below) was written against.
 *
 * Client-proofing choice: every surface carries its own explicit
 * background (page, band fallback, panel, signature plate), so a
 * themed send renders as designed on light and dark client canvases
 * alike — no reliance on client dark-mode behaviour.
 *
 * Contrast (email-theme-truth.test.ts): every shell text token in
 * EMAIL_THEME_COLORS clears WCAG AA (≥4.5:1) on the surface it sits
 * on, in BOTH themes; the shared EMAIL_COLORS body tokens below keep
 * their Oct 30, 2026 AA pins on the light panel and the detail box.
 * Known boundary, stated plainly: call-site body copy that colors
 * small print with the light-surface EMAIL_COLORS accents (muted /
 * goldDeep) directly on the panel reads as designed in light sends;
 * in dark sends those accents sit mostly inside the ivory detail
 * box (where they stay correct), and migrating body copy to themed
 * tokens is a call-site follow-on, not hidden here.
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
  /** Muted small print on the card. (≥4.5:1 on card AND box.) */
  muted: "#71644a",
  /** Antique gold — accents, links and strong text ON the ivory card.
      (≥4.5:1 on card AND box.) */
  goldDeep: "#856010",
  /** Bright gold — on the dark band/canvas, and the button fill. */
  gold: "#d4af37",
  goldDim: "#9a8c6a",
  /** Small legal print on the dark canvas footer. (≥4.5:1 on canvas.) */
  footerInk: "#8d8271",
} as const;

/**
 * Per-theme shell tokens for the company-theme design. Every text
 * token here is pinned ≥4.5:1 on its own surface by
 * email-theme-truth.test.ts. Values are the approved design's own
 * (artifact "automatic-emails-company-theme" export), with two
 * house-token reconciliations: the light panel is the house
 * golden-marble ivory (EMAIL_COLORS.card, #faf7f0) and the dark
 * send's crest is EMAIL_LOGO_URL (the R2 permanent home).
 */
export const EMAIL_THEME_COLORS = {
  /** The gold of hairlines and the call-to-action fill, both themes. */
  goldHairline: "#c9a227",
  goldButton: "#c9a227",
  /** Label ink on the gold button. */
  buttonInk: "#171204",
  dark: {
    /** Outer page ground. */
    page: "#0b0b0b",
    /** The one calm panel the words sit on. */
    panel: "#111111",
    ink: "#f2f2f2",
    body: "#d9d4c7",
    muted: "#a99e83",
    /** Gold for text on the panel / page (wordmark sub, links). */
    goldText: "#e9c860",
    /** Flat stone tone behind the marble images if they fail. */
    frame: "#060606",
    /** The signature plate's own ground. */
    sigBg: "#0b0b0b",
    sigName: "#e9c860",
    sigInk: "#f2f2f2",
    sigSub: "#bcbcbc",
  },
  light: {
    page: "#f3ecda",
    panel: "#faf7f0",
    ink: "#241f12",
    body: "#4a4230",
    muted: "#71644a",
    goldText: "#7c5c0a",
    frame: "#e7d9b4",
    sigBg: "#faf5ea",
    sigName: "#97700d",
    sigInk: "#241f12",
    sigSub: "#5d543c",
  },
} as const;

export type EmailThemePalette =
  (typeof EMAIL_THEME_COLORS)[EmailTheme];

const EMAIL_SERIF = "Georgia,'Times New Roman',Times,serif";
const EMAIL_SANS =
  "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

interface EmailShellOpts {
  /**
   * Sign-off rendered under the body. Defaults to the King's sign-off —
   * pass a string to override it, or `false` for internal mail (admin
   * alerts) that should not speak in the King's voice (no sign-off
   * line and no signature block).
   */
  signoff?: string | false;
  /** Hidden inbox preview line shown by mail clients next to the subject. */
  preheader?: string;
  /**
   * The send's theme (company-theme pair). Defaults to "light" — the
   * token-native theme; rotation-aware callers pass the theme
   * resolved for their recipient (see emailShellForRecipient).
   */
  theme?: EmailTheme;
}

/**
 * The approved design's rich gold call-to-action (table-based so
 * Outlook renders it too): flat house gold, 10px radius, generous
 * padding — one clear action per send. Presentation only — `href`
 * is used verbatim as the anchor target.
 */
export function emailButton(href: string, label: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 4px;"><tr><td align="center" bgcolor="${EMAIL_THEME_COLORS.goldButton}" style="border-radius:10px;background:${EMAIL_THEME_COLORS.goldButton};"><a href="${href}" style="display:inline-block;padding:16px 38px;font-family:${EMAIL_SANS};font-size:16px;font-weight:700;letter-spacing:0.2px;color:${EMAIL_THEME_COLORS.buttonInk};text-decoration:none;border-radius:10px;">${label}</a></td></tr></table>`;
}

/**
 * The closing signature — the approved design's signature block,
 * themed to the send it rides in: its lockup is the theme's lockup
 * (dark logo on the dark send, light logo on the light send), its
 * plate is the theme's calm ground, set off from the body only by a
 * hairline gold rule above it. No marble anywhere near it — the
 * splash lives only at the email's very top and foot. The King sits
 * at the ruled modest size (160px), floating, never boxed.
 */
export function emailSignatureHtml(theme: EmailTheme): string {
  const t = EMAIL_THEME_COLORS[theme];
  const base = baseUrlForEmail().replace(/\/$/, "");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;background:${t.sigBg};max-width:600px;">
<tr><td style="padding:20px 20px 0;"><div style="height:1px;background:${EMAIL_THEME_COLORS.goldHairline};font-size:0;line-height:0;">&nbsp;</div></td></tr>
<tr><td style="padding:18px 20px 22px;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">
<tr>
<td style="vertical-align:middle;padding-right:18px;"><img src="${emailLogoUrlForTheme(theme)}" width="160" alt="Thy Cheat Code — Bow Down Visuals" style="display:block;width:160px;height:auto;border:0;"></td>
<td style="vertical-align:middle;">
<div style="font-family:${EMAIL_SERIF};font-size:23px;font-weight:700;letter-spacing:2px;color:${t.sigName};">THY CHEAT CODE</div>
<div style="font-family:${EMAIL_SANS};font-size:12px;font-weight:700;letter-spacing:3px;color:${t.sigInk};padding-top:5px;">BOW DOWN VISUALS</div>
<div style="font-family:${EMAIL_SANS};font-size:13px;font-style:italic;color:${t.sigSub};padding-top:4px;">The Content Creation Cheat Code</div>
<div style="font-family:${EMAIL_SANS};font-size:13px;font-weight:700;padding-top:9px;"><a href="${base}" style="color:${t.sigName};text-decoration:none;">bowdownvisuals.com</a><span style="color:${t.sigSub};">&nbsp;&nbsp;·&nbsp;&nbsp;</span><a href="mailto:hello@bowdownvisuals.com" style="color:${t.sigName};text-decoration:none;">hello@bowdownvisuals.com</a></div>
</td>
</tr>
</table>
</td></tr>
</table>`;
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
  const theme: EmailTheme = opts.theme ?? "light";
  const t = EMAIL_THEME_COLORS[theme];
  const base = baseUrlForEmail().replace(/\/$/, "");
  const marble = emailMarbleUrlForTheme(theme);
  const logo = emailLogoUrlForTheme(theme);
  const signoff =
    opts.signoff === false
      ? ""
      : `<tr><td style="padding:26px 42px 0;">
<div style="font-family:${EMAIL_SERIF};font-style:italic;font-size:16px;color:${t.goldText};">${opts.signoff ?? "— Thy Cheat Code"}</div>
<div style="font-family:${EMAIL_SANS};font-size:12px;color:${t.muted};margin-top:3px;">Your host at Bow Down Visuals</div>
</td></tr>
<tr><td style="padding:18px 42px 0;">
${emailSignatureHtml(theme)}
</td></tr>`;
  const preheader = opts.preheader
    ? `<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:${t.page};">${opts.preheader}</div>`
    : "";
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark"><title>${title}</title></head>
<body style="margin:0;padding:0;background:${t.page};">
${preheader}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${t.page};">
<tr><td align="center" style="padding:28px 12px;">
<table role="presentation" width="620" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:620px;background:${t.panel};border:1px solid ${EMAIL_THEME_COLORS.goldHairline};">
<tr><td background="${marble}" bgcolor="${t.frame}" align="center" style="padding:16px 24px 14px;background-image:url(${marble});background-size:620px auto;background-position:center 32%;background-repeat:no-repeat;border-bottom:2px solid ${EMAIL_THEME_COLORS.goldHairline};">
<img src="${logo}" width="138" alt="Bow Down Visuals — The Content Creator's Cheat Code" style="display:block;width:138px;height:auto;border:0;">
</td></tr>
<tr><td bgcolor="${t.panel}" align="center" style="background:${t.panel};padding:30px 30px 6px;">
<div style="font-family:${EMAIL_SERIF};font-size:31px;font-weight:700;letter-spacing:5px;color:${t.ink};">BOW DOWN VISUALS</div>
<div style="font-family:${EMAIL_SANS};font-size:11px;font-weight:700;letter-spacing:4px;color:${t.goldText};padding-top:9px;">THE CONTENT CREATION CHEAT CODE</div>
<div style="padding-top:22px;"><div style="height:1px;background:${EMAIL_THEME_COLORS.goldHairline};width:120px;margin:0 auto;font-size:0;line-height:0;">&nbsp;</div></div>
</td></tr>
<tr><td style="padding:26px 42px 0;">
<div style="font-family:${EMAIL_SERIF};font-size:32px;line-height:1.25;font-weight:700;color:${t.ink};text-align:center;">${title}</div>
</td></tr>
<tr><td style="padding:14px 42px 6px;font-family:${EMAIL_SANS};font-size:15px;line-height:1.65;color:${t.body};">
${bodyHtml}
</td></tr>
${signoff}
<tr><td align="center" style="padding:26px 42px 30px;font-family:${EMAIL_SANS};">
<div style="height:1px;background:${EMAIL_THEME_COLORS.goldHairline};margin:0 0 22px;font-size:0;line-height:0;">&nbsp;</div>
<div style="font-size:13px;font-weight:700;padding-bottom:10px;"><a href="${base}" style="color:${t.goldText};text-decoration:none;">The Studio</a><span style="color:${t.muted};">&nbsp;&nbsp;·&nbsp;&nbsp;</span><a href="${base}/world" style="color:${t.goldText};text-decoration:none;">The World</a><span style="color:${t.muted};">&nbsp;&nbsp;·&nbsp;&nbsp;</span><a href="mailto:hello@bowdownvisuals.com" style="color:${t.goldText};text-decoration:none;">Talk to us</a></div>
<div style="font-size:12px;color:${t.muted};line-height:1.6;">This email was sent by Bow Down Visuals.<br><a href="${base}" style="color:${t.goldText};text-decoration:none;">bowdownvisuals.com</a></div>
</td></tr>
<tr><td background="${marble}" bgcolor="${t.frame}" height="30" style="height:30px;line-height:30px;font-size:0;background-image:url(${marble});background-size:620px auto;background-position:center 30%;background-repeat:no-repeat;">&nbsp;</td></tr>
</table>
</td></tr>
</table>
</body></html>`;
}

/**
 * Rotation-aware shell: resolves the theme this recipient's next
 * send carries (dark, light, dark, light — per customer) and renders
 * the shell in it. Resolving PEEKS only; the flip is recorded by
 * sendEmail when the send is verified sent and the caller passes
 * { theme, themeRecipient } through (this helper returns both).
 */
export async function emailShellForRecipient(
  recipient: string,
  title: string,
  bodyHtml: string,
  opts: EmailShellOpts = {},
): Promise<{ html: string; theme: EmailTheme }> {
  const theme = opts.theme ?? (await resolveEmailThemeForRecipient(recipient));
  return { html: emailShell(title, bodyHtml, { ...opts, theme }), theme };
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
