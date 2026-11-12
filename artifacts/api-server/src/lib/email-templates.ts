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
 * The markup intentionally mirrors emailShell (same marble splash
 * headband, gold line, panel, button, sign-off, themed signature,
 * foot strip) but is fully static: a dashboard template cannot call
 * our code at send time, so it ships as ONE fixed member of the
 * company-theme pair — the LIGHT send (golden marble, ivory panel,
 * light lockup in the crest and the signature alike). Theme rotation
 * (dark, light, dark, light per customer) applies to the server-sent
 * families, whose code resolves a theme per recipient; a pasted
 * dashboard template has no send-time code, so it cannot rotate —
 * the light member is its honest fixed form, and its body copy's
 * EMAIL_COLORS tokens are the light-surface tokens by design.
 */
import {
  EMAIL_COLORS,
  EMAIL_LOGO_LIGHT_URL,
  EMAIL_MARBLE_URLS,
  EMAIL_THEME_COLORS,
  emailSignatureHtml,
} from "./email";

const SERIF = "Georgia,'Times New Roman',Times,serif";
const SANS =
  "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const SITE = "https://bowdownvisuals.com";
const C = EMAIL_COLORS;

function authButton(href: string, label: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 4px;"><tr><td align="center" bgcolor="${EMAIL_THEME_COLORS.goldButton}" style="border-radius:10px;background:${EMAIL_THEME_COLORS.goldButton};"><a href="${href}" style="display:inline-block;padding:16px 38px;font-family:${SANS};font-size:16px;font-weight:700;letter-spacing:0.2px;color:${EMAIL_THEME_COLORS.buttonInk};text-decoration:none;border-radius:10px;">${label}</a></td></tr></table>`;
}

function authDetailBox(innerHtml: string): string {
  return `<div style="background:${C.box};border:1px solid ${C.boxBorder};border-radius:10px;padding:18px 20px;margin:0 0 18px;">${innerHtml}</div>`;
}

/** Static LIGHT twin of emailShell for dashboard-pasted templates. */
function authShell(title: string, bodyHtml: string, preheader: string): string {
  const t = EMAIL_THEME_COLORS.light;
  const marble = EMAIL_MARBLE_URLS.light;
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark"><title>${title}</title></head>
<body style="margin:0;padding:0;background:${t.page};">
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:${t.page};">${preheader}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${t.page};">
<tr><td align="center" style="padding:28px 12px;">
<table role="presentation" width="620" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:620px;background:${t.panel};border:1px solid ${EMAIL_THEME_COLORS.goldHairline};">
<tr><td background="${marble}" bgcolor="${t.frame}" align="center" style="padding:16px 24px 14px;background-image:url(${marble});background-size:620px auto;background-position:center 32%;background-repeat:no-repeat;border-bottom:2px solid ${EMAIL_THEME_COLORS.goldHairline};">
<img src="${EMAIL_LOGO_LIGHT_URL}" width="138" alt="Bow Down Visuals — The Content Creator's Cheat Code" style="display:block;width:138px;height:auto;border:0;">
</td></tr>
<tr><td bgcolor="${t.panel}" align="center" style="background:${t.panel};padding:30px 30px 6px;">
<div style="font-family:${SERIF};font-size:31px;font-weight:700;letter-spacing:5px;color:${t.ink};">BOW DOWN VISUALS</div>
<div style="font-family:${SANS};font-size:11px;font-weight:700;letter-spacing:4px;color:${t.goldText};padding-top:9px;">THE CONTENT CREATION CHEAT CODE</div>
<div style="padding-top:22px;"><div style="height:1px;background:${EMAIL_THEME_COLORS.goldHairline};width:120px;margin:0 auto;font-size:0;line-height:0;">&nbsp;</div></div>
</td></tr>
<tr><td style="padding:26px 42px 0;">
<div style="font-family:${SERIF};font-size:32px;line-height:1.25;font-weight:700;color:${t.ink};text-align:center;">${title}</div>
</td></tr>
<tr><td style="padding:14px 42px 6px;font-family:${SANS};font-size:15px;line-height:1.65;color:${t.body};">
${bodyHtml}
</td></tr>
<tr><td style="padding:26px 42px 0;">
<div style="font-family:${SERIF};font-style:italic;font-size:16px;color:${t.goldText};">— Thy Cheat Code</div>
<div style="font-family:${SANS};font-size:12px;color:${t.muted};margin-top:3px;">Your host at Bow Down Visuals</div>
</td></tr>
<tr><td style="padding:18px 42px 0;">
${emailSignatureHtml("light")}
</td></tr>
<tr><td align="center" style="padding:26px 42px 30px;font-family:${SANS};">
<div style="height:1px;background:${EMAIL_THEME_COLORS.goldHairline};margin:0 0 22px;font-size:0;line-height:0;">&nbsp;</div>
<div style="font-size:13px;font-weight:700;padding-bottom:10px;"><a href="${SITE}" style="color:${t.goldText};text-decoration:none;">The Studio</a><span style="color:${t.muted};">&nbsp;&nbsp;·&nbsp;&nbsp;</span><a href="${SITE}/world" style="color:${t.goldText};text-decoration:none;">The World</a><span style="color:${t.muted};">&nbsp;&nbsp;·&nbsp;&nbsp;</span><a href="mailto:hello@bowdownvisuals.com" style="color:${t.goldText};text-decoration:none;">Talk to us</a></div>
<div style="font-size:12px;color:${t.muted};line-height:1.6;">This email was sent by Bow Down Visuals.<br><a href="${SITE}" style="color:${t.goldText};text-decoration:none;">bowdownvisuals.com</a></div>
</td></tr>
<tr><td background="${marble}" bgcolor="${t.frame}" height="30" style="height:30px;line-height:30px;font-size:0;background-image:url(${marble});background-size:620px auto;background-position:center 30%;background-repeat:no-repeat;">&nbsp;</td></tr>
</table>
</td></tr>
</table>
</body></html>`;
}

/** Small-print fallback link under the gold button (never the naked primary). */
function fallbackLink(url: string): string {
  return `<p style="margin:14px 0 0;color:${C.muted};font-size:12px;line-height:1.6;">Button not working? Paste this link into your browser:<br><a href="${url}" style="color:${C.goldDeep};word-break:break-all;">${url}</a></p>`;
}

interface AuthEmailTemplate {
  /** Dashboard file name (lib/email-templates/<file>). */
  file: string;
  /** Recommended subject line to set in the dashboard. */
  subject: string;
  html: string;
}

function confirmSignupTemplate(): AuthEmailTemplate {
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

function resetPasswordTemplate(): AuthEmailTemplate {
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

function magicLinkTemplate(): AuthEmailTemplate {
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

function inviteTemplate(): AuthEmailTemplate {
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

function changeEmailTemplate(): AuthEmailTemplate {
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
