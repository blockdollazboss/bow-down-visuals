/* ─── Proxy editing (board 184) — editor-side honesty helpers ─────────
   Pure logic for the ProxyEditingCard docked inside the Visual Vibes
   editor. Mirrors the server contract in api-server lib/proxy-editing:
   - The PREVIEW may play a ready proxy, and must SAY it is a proxy.
   - EXPORT always renders from originals: any timeline URL that is a
     known proxy is swapped back before export (the server relinks
     again at job kickoff — this is the client half of the guarantee).
   - No prices anywhere: proxies are free, on-demand editor tooling. */

export interface ProxyRowLike {
  original_url: string;
  proxy_url: string | null;
  status: "pending" | "generating" | "ready" | "failed";
}

export const PROXY_BADGE = "Viewing: Proxy — preview only";
export const ORIGINAL_BADGE = "Viewing: Original — full-res";
export const EXPORT_HONESTY_LINE = "Export always renders from the full-res originals — never from a proxy.";

/** The URL the preview player should use for one clip, plus the badge
 *  the UI must show next to it. Proxy only when ready AND enabled. */
export function previewUrlFor(originalUrl: string, row: ProxyRowLike | null | undefined, enabled: boolean): { url: string; isProxy: boolean; badge: string } {
  if (enabled && row && row.status === "ready" && row.proxy_url) {
    return { url: row.proxy_url, isProxy: true, badge: PROXY_BADGE };
  }
  return { url: originalUrl, isProxy: false, badge: ORIGINAL_BADGE };
}

/** Swap any known proxy URLs in an export clip list back to their
 *  originals. Returns the cleaned list and how many were relinked. */
export function relinkForExport(clipUrls: string[], rows: ProxyRowLike[]): { urls: string[]; relinked: number } {
  const byProxy = new Map<string, string>();
  for (const r of rows) if (r.proxy_url) byProxy.set(r.proxy_url, r.original_url);
  let relinked = 0;
  const urls = clipUrls.map((u) => {
    const orig = byProxy.get(u);
    if (orig) { relinked++; return orig; }
    return u;
  });
  return { urls, relinked };
}

/** One-line status for a clip in the Proxy panel. Plain language, no
 *  invented state: unknown clips are simply "Original". */
export function proxyStatusLabel(row: ProxyRowLike | null | undefined): string {
  if (!row) return "Original — no proxy";
  switch (row.status) {
    case "ready": return "Proxy ready — preview uses the proxy, export uses the original";
    case "generating": return "Making proxy… — preview still uses the original";
    case "pending": return "Proxy queued — preview still uses the original";
    case "failed": return "Proxy failed — preview uses the original. You can try again.";
  }
}
