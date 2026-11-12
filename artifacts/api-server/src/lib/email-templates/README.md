# Supabase Auth email templates — Bow Down Visuals design system

The auth emails (signup confirmation, password reset, magic link, invite,
email change) are sent by **Supabase Auth**, not by the api-server — their
templates live in the Supabase dashboard. The files in this folder are the
dashboard-ready versions of the company-theme design (owner-approved
Nov 7, 2026, re-approved Nov 11, 2026), generated from the
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
- **The design** is the company-theme pair's LIGHT member, fixed: a
  dashboard-pasted template has no send-time code, so it cannot take
  part in the per-customer theme rotation the server-sent families
  run (see `../email-theme-rotation.ts`). Golden-marble header band
  with the light lockup floating on it as a crest at 138px (whole,
  never cropped, never the app icon, no emoji anywhere in the
  family), gold line under the band, ivory panel, gold button, the
  themed closing signature (light lockup again), and a 30px marble
  strip at the foot — marble is a splash only, never a ground.
- **Client-proofing:** every surface carries its own explicit
  background (page, band fallback, panel, signature plate), so the
  template renders as designed on light and dark client canvases.
- The light lockup URL comes from `EMAIL_LOGO_LIGHT_URL` in
  `../email.ts` (the approved design's hosted light export, from
  `public/logo-light.webp`); if it ever changes, update it there
  and regenerate.
