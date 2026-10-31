/* referral-link.ts — attach the sharer's referral code to shared URLs.
   The ShareMenu pattern, factored out so every surface that promises
   "?ref= credit" actually carries the code: same-site URLs get
   ?ref=CODE appended (App.tsx captures it at landing and AuthContext
   applies it at signup via POST /api/referrals/apply); off-site URLs,
   URLs that already carry a ref, and a missing code all pass through
   untouched — sharing must never break over attribution. */

export function withRefCode(url: string, code: string | null): string {
  if (!code) return url;
  try {
    const u = new URL(url, window.location.origin);
    const sameSite =
      u.hostname === window.location.hostname ||
      u.hostname.endsWith("bowdownvisuals.com");
    if (!sameSite) return url;
    if (!u.searchParams.get("ref")) u.searchParams.set("ref", code);
    return u.toString();
  } catch {
    return url;
  }
}
