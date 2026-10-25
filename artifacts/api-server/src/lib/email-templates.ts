/**
 * Supabase Auth email templates — the auth family (signup confirmation,
 * password reset, magic link, invite, email change) is sent by Supabase
 * Auth, NOT by this server, so these templates live in the Supabase
 * dashboard (Authentication → Email Templates), not in a send path here.
 *
 * This module is the source of truth: each builder returns the exact
 * subject + full HTML document for one dashboard template, carrying
 * Supabase's own merge variables ({{ .ConfirmationURL }} etc.) verbatim —
 * behavior is unchanged, only the presentation is rebuilt to the house
 * design system (see email.ts). The rendered documents are also checked
 * in as standalone files under lib/email-templates/*.html for direct
 * paste-in; email-templates.test.ts pins files ↔ builders so they can
 * never drift apart silently.
 *
 * The markup intentionally mirrors emailShell (same band, card, button,
 * sign-off, footer) but is fully static: a dashboard template cannot call
 * our code, so colors and the logo URL are inlined literally. The logo is
 * the same EMAIL_LOGO_URL asset (jsDelivr @main — the production host is
 * gated/dark pre-launch, so mail clients could not fetch it from there).
 */
import { EMAIL_COLORS, EMAIL_LOGO_URL } from "./email";

const SERIF = "Georgia,'Times New Roman',Times,serif";
const SANS =
  "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const SITE = "https://bowdownvisuals.com";
const C = EMAIL_COLORS;

function authButton(href: string, label: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 4px;"><tr><td align="center" bgcolor="${C.gold}" style="border-radius:999px;background:${C.gold};"><a href="${href}" style="display:inline-block;padding:13px 32px;font-family:${SANS};font-size:14px;font-weight:700;letter-spacing:0.4px;color:#171204;text-decoration:none;border-radius:999px;">${label}</a></td></tr></table>`;
}

function authDetailBox(innerHtml: string): string {
  return `<div style="background:${C.box};border:1px solid ${C.boxBorder};border-radius:10px;padding:18px 20px;margin:0 0 18px;">${innerHtml}</div>`;
}

/** Static twin of emailShell for dashboard-pasted templates. */
function authShell(title: string, bodyHtml: string, preheader: string): string {
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><title>${title}</title></head>
<body style="margin:0;padding:0;background:${C.canvas};">
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:${C.canvas};">${preheader}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.canvas};">
<tr><td align="center" style="padding:36px 16px 40px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;">
<tr><td align="center" bgcolor="${C.band}" style="background:${C.band};border:1px solid ${C.bandBorder};border-bottom:none;border-radius:16px 16px 0 0;padding:30px 24px 22px;">
<img src="${EMAIL_LOGO_URL}" width="232" alt="Bow Down Visuals — The Content Creator's Cheat Code" style="display:block;width:232px;max-width:72%;height:auto;border:0;">
<div style="font-family:${SANS};color:${C.gold};font-weight:800;font-size:15px;letter-spacing:4px;margin-top:14px;">THY CHEAT CODE</div>
</td></tr>
<tr><td bgcolor="${C.gold}" style="background:${C.gold};font-size:0;line-height:0;height:3px;">&nbsp;</td></tr>
<tr><td bgcolor="#57441a" style="background:#57441a;font-size:0;line-height:0;height:1px;">&nbsp;</td></tr>
<tr><td bgcolor="${C.card}" style="background:${C.card};border:1px solid ${C.cardBorder};border-top:none;border-radius:0 0 16px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
<tr><td style="padding:30px 36px 0;">
<div style="font-family:${SERIF};font-size:27px;line-height:1.25;font-weight:700;color:${C.ink};">${title}</div>
</td></tr>
<tr><td style="padding:14px 36px 6px;font-family:${SANS};font-size:15px;line-height:1.65;color:${C.body};">
${bodyHtml}
</td></tr>
<tr><td style="padding:2px 36px 30px;">
<div style="border-top:1px solid ${C.cardBorder};padding-top:18px;">
<div style="font-family:${SERIF};font-style:italic;font-size:16px;color:${C.goldDeep};">— Thy Cheat Code</div>
<div style="font-family:${SANS};font-size:12px;color:${C.muted};margin-top:3px;">Your host at Bow Down Visuals</div>
</div>
</td></tr>
</table>
</td></tr>
<tr><td align="center" style="padding:24px 24px 0;">
<div style="font-family:${SANS};font-size:12px;font-weight:700;letter-spacing:3px;color:${C.gold};">BOW DOWN VISUALS</div>
<div style="font-family:${SERIF};font-style:italic;font-size:13px;color:${C.goldDim};margin-top:5px;">The Content Creator's Cheat Code</div>
<div style="font-family:${SANS};font-size:12px;color:#6f6450;margin-top:12px;line-height:1.6;">This email was sent by Bow Down Visuals.<br><a href="${SITE}" style="color:${C.gold};text-decoration:none;">bowdownvisuals.com</a></div>
</td></tr>
</table>
</td></tr>
</table>
</body></html>`;
}

/** Small-print fallback link under the gold button (never the naked primary). */
function fallbackLink(url: string): string {
  return `<p style="margin:14px 0 0;color:${C.muted};font-size:12px;line-height:1.6;">Button not working? Paste this link into your browser:<br><a href="${url}" style="color:${C.goldDeep};word-break:break-all;">${url}</a></p>`;
}

export interface AuthEmailTemplate {
  /** Dashboard file name (lib/email-templates/<file>). */
  file: string;
  /** Recommended subject line to set in the dashboard. */
  subject: string;
  html: string;
}

export function confirmSignupTemplate(): AuthEmailTemplate {
  const url = "{{ .ConfirmationURL }}";
  return {
    file: "confirm-signup.html",
    subject: "Confirm your email — welcome to Bow Down Visuals",
    html: authShell(
      "One last step — confirm it's you",
      `<p style="margin:0 0 12px;">Welcome to Bow Down Visuals. Tap the button below to confirm this email address and finish signing up — then the whole studio is yours: make it, brand it, promote it, sell it, all in one place.</p>
${authButton(url, "Confirm email address")}
${fallbackLink(url)}
<p style="margin:14px 0 0;color:${C.muted};font-size:12px;">Didn't sign up for Bow Down Visuals? Ignore this email — nothing happens without the tap.</p>`,
      "Confirm your email address to finish signing up for Bow Down Visuals.",
    ),
  };
}

export function resetPasswordTemplate(): AuthEmailTemplate {
  const url = "{{ .ConfirmationURL }}";
  return {
    file: "reset-password.html",
    subject: "Reset your Bow Down Visuals password",
    html: authShell(
      "Reset your password",
      `<p style="margin:0 0 12px;">Somebody asked to reset the password for this Bow Down Visuals account. If that was you, tap below — the link takes you straight to setting a new one.</p>
${authButton(url, "Set a new password")}
${fallbackLink(url)}
<p style="margin:14px 0 0;color:${C.muted};font-size:12px;">Didn't ask? Ignore this email — your password stays exactly as it is.</p>`,
      "Set a new password for your Bow Down Visuals account.",
    ),
  };
}

export function magicLinkTemplate(): AuthEmailTemplate {
  const url = "{{ .ConfirmationURL }}";
  return {
    file: "magic-link.html",
    subject: "Your Bow Down Visuals sign-in link",
    html: authShell(
      "Your sign-in link",
      `<p style="margin:0 0 12px;">Tap below to sign in to Bow Down Visuals — no password needed. The link works once, so use it now.</p>
${authButton(url, "Sign in to Bow Down Visuals")}
${authDetailBox(`<div style="color:${C.muted};font-size:12px;letter-spacing:2px;text-align:center;">OR ENTER THIS CODE</div><div style="color:${C.goldDeep};font-weight:700;font-size:24px;letter-spacing:3px;text-align:center;margin-top:6px;">{{ .Token }}</div>`)}
${fallbackLink(url)}
<p style="margin:14px 0 0;color:${C.muted};font-size:12px;">Didn't ask to sign in? Ignore this email — nobody gets in without it.</p>`,
      "Tap to sign in to Bow Down Visuals — no password needed.",
    ),
  };
}

export function inviteTemplate(): AuthEmailTemplate {
  const url = "{{ .ConfirmationURL }}";
  return {
    file: "invite.html",
    subject: "You've been invited to Bow Down Visuals",
    html: authShell(
      "You've been invited",
      `<p style="margin:0 0 12px;">You've been invited to join Bow Down Visuals — the studio where creators make, brand, promote, and sell in one place. Tap below to accept and set up your account.</p>
${authButton(url, "Accept the invite")}
${fallbackLink(url)}
<p style="margin:14px 0 0;color:${C.muted};font-size:12px;">Not expecting this? You can ignore it — the invite expires on its own.</p>`,
      "Accept your invite to Bow Down Visuals.",
    ),
  };
}

export function changeEmailTemplate(): AuthEmailTemplate {
  const url = "{{ .ConfirmationURL }}";
  return {
    file: "change-email.html",
    subject: "Confirm your new email address — Bow Down Visuals",
    html: authShell(
      "Confirm your new email",
      `<p style="margin:0 0 12px;">You asked to change the email on your Bow Down Visuals account to <strong style="color:${C.goldDeep};">{{ .NewEmail }}</strong>. Tap below to confirm the switch.</p>
${authButton(url, "Confirm new email")}
${fallbackLink(url)}
<p style="margin:14px 0 0;color:${C.muted};font-size:12px;">Didn't ask for this? Ignore this email and your address stays unchanged.</p>`,
      "Confirm the new email address for your Bow Down Visuals account.",
    ),
  };
}

export const AUTH_EMAIL_TEMPLATES: AuthEmailTemplate[] = [
  confirmSignupTemplate(),
  resetPasswordTemplate(),
  magicLinkTemplate(),
  inviteTemplate(),
  changeEmailTemplate(),
];
