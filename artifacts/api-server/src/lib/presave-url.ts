/* Canonical public URL formation for release links.
   APP_PUBLIC_URL is the public origin every shareable release URL is
   formed against (env-overridable, trailing slash stripped).
   presaveUrl(slug) is THE formation for a release's pre-save page —
   the page minted at /presave/:slug, which persists after release
   day as the release's smartlink (one page, one URL). The mint
   endpoint (routes/generate/distribution.ts) returns this exact
   string to clients; every other surface that composes the link
   from a stored slug (pitch packet, emails, …) must form it here
   too — never a second scheme. */
export const APP_PUBLIC_URL = (
  process.env["APP_PUBLIC_URL"] ?? "https://bowdownvisuals.com"
).replace(/\/$/, "");

export function presaveUrl(slug: string): string {
  return `${APP_PUBLIC_URL}/presave/${slug}`;
}
