/**
 * Canonical mailbox identity for anti-farming checks.
 *
 * Two addresses are the "same mailbox" when they canonicalize equal:
 *  - lowercased
 *  - any +tag stripped from the local part (plus addressing is a
 *    delivery alias for the same inbox at every major provider)
 *  - for gmail.com / googlemail.com, dots in the local part are ignored
 *    (Gmail delivers a.b@ and ab@ to one inbox) and googlemail.com
 *    folds onto gmail.com.
 *
 * Returns null for anything that is not a plausible email address, so
 * callers decide explicitly how to treat an unparseable value instead
 * of comparing garbage strings.
 */
export function canonicalEmail(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const email = raw.trim().toLowerCase();
  const at = email.lastIndexOf("@");
  if (at <= 0 || at === email.length - 1) return null;
  let local = email.slice(0, at);
  let domain = email.slice(at + 1);
  if (!domain.includes(".")) return null;
  const plus = local.indexOf("+");
  if (plus >= 0) local = local.slice(0, plus);
  if (domain === "googlemail.com") domain = "gmail.com";
  if (domain === "gmail.com") local = local.replace(/\./g, "");
  if (!local || !domain) return null;
  return `${local}@${domain}`;
}
