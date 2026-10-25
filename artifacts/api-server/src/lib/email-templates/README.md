# Supabase Auth email templates — Bow Down Visuals design system

The auth emails (signup confirmation, password reset, magic link, invite,
email change) are sent by **Supabase Auth**, not by the api-server — their
templates live in the Supabase dashboard. The files in this folder are the
redesigned, dashboard-ready versions (Oct 24, 2026), generated from the
source-of-truth builders in `../email-templates.ts`. Do not hand-edit the
`.html` files — edit the builder and regenerate
(`email-templates.test.ts` fails if a file drifts from its builder).

## How to apply (dashboard step — owner/admin)

Supabase Dashboard → **Authentication → Email Templates**, one template
at a time: set the subject below, replace the body with the matching
file's full contents, save.

| Dashboard template | File | Subject |
|---|---|---|
| Confirm signup | `confirm-signup.html` | Confirm your email — welcome to Bow Down Visuals |
| Reset password | `reset-password.html` | Reset your Bow Down Visuals password |
| Magic Link | `magic-link.html` | Your Bow Down Visuals sign-in link |
| Invite user | `invite.html` | You've been invited to Bow Down Visuals |
| Change email address | `change-email.html` | Confirm your new email address — Bow Down Visuals |

## Rules baked into these files

- **Merge variables are Supabase's own and unchanged** — `{{ .ConfirmationURL }}`
  drives every action button and fallback link; `{{ .Token }}` (magic link)
  and `{{ .NewEmail }}` (change email) render exactly as before the redesign.
  Presentation only; no flow, trigger, or token behavior changes.
- **The logo** is the full illustrated lockup (`logo-email.png`, 600×600,
  exported from `public/logo-static.webp`), shown whole at 232px in the
  black-marble header band — never cropped, never the app icon, no emoji
  anywhere in the family.
- **Client-proofing:** the band carries its own near-black background and
  the card its own golden-marble ivory, so the design renders identically
  on light and dark client canvases and stays legible if a client strips
  backgrounds and forces white.
- The logo URL is the jsDelivr `@main` copy of the repo file — the
  production host is gated/dark pre-launch, so mail clients could not
  fetch the logo from bowdownvisuals.com. When the logo moves to the R2
  media bucket, update `EMAIL_LOGO_URL` in `../email.ts` and regenerate.
