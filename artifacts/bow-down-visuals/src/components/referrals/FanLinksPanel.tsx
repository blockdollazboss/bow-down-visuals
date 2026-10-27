import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Copy, Link2, Loader2 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import {
  FAN_LINK_CONTENT_TYPES,
  FAN_LINKS_FOR_ME_PATH,
  FAN_LINKS_MINE_PATH,
  FAN_LINKS_MINT_PATH,
  fanLinkContentLabel,
  fanLinkShareUrl,
  fanLinkStatsLine,
  type FanLinkContentType,
  type FanLinksForMeResponse,
  type FanLinksMineResponse,
} from "@/lib/upg-fans";

/* ─── Fan Links That Prove It (N17) ───────────────────────────────────────
   Docked INSIDE the Referrals page (the share/attribution home), never a
   standalone page. Two honest views over the same recorded events:
   - Fans sharing MY work: per-fan links pointing at my content, with the
     clicks / arrivals / signups each one actually produced.
   - My fan links: the links I minted to share other creators, with my
     own proven numbers and a copy button per link.
   Every number is a count of rows the server recorded — nothing here is
   modelled, estimated, or back-filled. */

const inputClass =
  "w-full rounded-xl border border-white/10 bg-black/60 px-4 py-3 text-sm text-white placeholder:text-white/25 outline-none transition focus:border-primary/60 focus:ring-1 focus:ring-primary/40";
const labelClass = "mb-1.5 block text-xs font-bold uppercase tracking-widest text-white/50";
const goldBtn =
  "inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-b from-amber-300 to-yellow-600 px-5 py-3 text-sm font-extrabold uppercase tracking-wider text-black shadow-[0_0_24px_rgba(234,179,8,0.35)] transition hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed";
const ghostBtn =
  "inline-flex items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/5 px-4 py-2.5 text-sm font-bold text-white/80 transition hover:border-primary/50 hover:text-white disabled:opacity-50";

export function FanLinksPanel() {
  const { user, getAccessToken } = useAuth();
  const [mine, setMine] = useState<FanLinksMineResponse | null>(null);
  const [forMe, setForMe] = useState<FanLinksForMeResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  const [creatorUserId, setCreatorUserId] = useState("");
  const [contentType, setContentType] = useState<FanLinkContentType>("song");
  const [contentId, setContentId] = useState("");
  const [minting, setMinting] = useState(false);
  const [mintMsg, setMintMsg] = useState<string | null>(null);

  const authed = useCallback(
    async (path: string, opts: { method?: string; body?: unknown } = {}) => {
      const token = await getAccessToken();
      const res = await fetch(path, {
        method: opts.method ?? "GET",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        ...(opts.body ? { body: JSON.stringify(opts.body) } : {}),
      });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      return { res, data };
    },
    [getAccessToken],
  );

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setLoadError(null);
    try {
      const [mineRes, forMeRes] = await Promise.all([authed(FAN_LINKS_MINE_PATH), authed(FAN_LINKS_FOR_ME_PATH)]);
      if (!mineRes.res.ok || !forMeRes.res.ok) throw new Error("load failed");
      setMine(mineRes.data as unknown as FanLinksMineResponse);
      setForMe(forMeRes.data as unknown as FanLinksForMeResponse);
    } catch {
      setLoadError("Couldn't load your fan links — try again.");
    } finally {
      setLoading(false);
    }
  }, [user, authed]);

  useEffect(() => {
    load();
  }, [load]);

  async function copy(path: string, code: string) {
    try {
      await navigator.clipboard.writeText(fanLinkShareUrl(window.location.origin, path));
      setCopiedCode(code);
      setTimeout(() => setCopiedCode(null), 2000);
    } catch {
      /* clipboard unavailable */
    }
  }

  async function mint() {
    const target = creatorUserId.trim();
    if (!target || minting) return;
    setMinting(true);
    setMintMsg(null);
    try {
      const { res, data } = await authed(FAN_LINKS_MINT_PATH, {
        method: "POST",
        body: {
          creatorUserId: target,
          contentType,
          contentId: contentId.trim() ? contentId.trim() : null,
        },
      });
      if (!res.ok) throw new Error(typeof data.error === "string" ? data.error : "Could not mint your link — try again.");
      setMintMsg("Your fan link is ready — it's in your list below.");
      setCreatorUserId("");
      setContentId("");
      await load();
    } catch (err) {
      setMintMsg(err instanceof Error ? err.message : "Could not mint your link — try again.");
    } finally {
      setMinting(false);
    }
  }

  if (!user) return null;

  return (
    <section className="mt-10">
      <div className="mb-6 text-center">
        <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-4 py-1.5 text-xs font-bold uppercase tracking-widest text-primary">
          <Link2 className="h-3.5 w-3.5" /> Fan Links
        </div>
        <h2 className="text-2xl font-black text-white">Links that prove it</h2>
        <p className="mx-auto mt-2 max-w-xl text-sm text-white/55">
          A fan link is one fan's personal link to a creator's work. Every click, arrival, and
          signup it produces is recorded — so credit goes to the fan who actually moved people.
        </p>
      </div>

      {loading && (
        <div className="flex items-center justify-center gap-2 py-10 text-white/50">
          <Loader2 className="h-5 w-5 animate-spin" /> Loading your fan links…
        </div>
      )}

      {loadError && (
        <div className="rounded-2xl border border-red-400/30 bg-red-400/5 p-6 text-center">
          <p className="text-sm text-red-200">{loadError}</p>
          <button onClick={load} className={`${ghostBtn} mt-4`}>Try again</button>
        </div>
      )}

      {!loading && forMe && (
        <div className="lux-card mb-6 p-5">
          <p className="mb-4 text-xs font-bold uppercase tracking-widest text-white/45">
            Fans sharing your work
          </p>
          <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              { label: "Fan links", value: forMe.rollup.totalLinks },
              { label: "Clicks", value: forMe.rollup.totalClicks },
              { label: "Arrivals", value: forMe.rollup.totalArrivals },
              { label: "Signups", value: forMe.rollup.totalSignups },
            ].map((s) => (
              <div key={s.label} className="rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-center">
                <p className="text-xl font-black text-white">{s.value.toLocaleString("en-US")}</p>
                <p className="text-[11px] font-bold uppercase tracking-widest text-white/40">{s.label}</p>
              </div>
            ))}
          </div>
          {forMe.links.length === 0 ? (
            <p className="text-sm text-white/55">
              No fan links point at your work yet. When a fan shares your page with their own
              link, it shows up here with the numbers it earned.
            </p>
          ) : (
            <ul className="space-y-2">
              {forMe.links.map((l) => (
                <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/10 bg-black/30 px-4 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold text-white">
                      {l.fanDisplayName} <span className="font-normal text-white/40">· {fanLinkContentLabel(l.contentType, l.contentId)}</span>
                    </p>
                    <p className="text-xs text-white/45">{fanLinkStatsLine(l.stats)}</p>
                  </div>
                  <span className="rounded-full bg-primary/15 px-2.5 py-0.5 text-[11px] font-bold text-primary">/f/{l.code}</span>
                </li>
              ))}
            </ul>
          )}
          {forMe.topFans.length > 0 && (
            <p className="mt-4 text-xs text-white/40">
              Top fan: {forMe.topFans[0]?.displayName} — {fanLinkStatsLine({
                linkId: "",
                clicks: forMe.topFans[0]?.clicks ?? 0,
                arrivals: forMe.topFans[0]?.arrivals ?? 0,
                signups: forMe.topFans[0]?.signups ?? 0,
                arrivalRate: null,
              })}
            </p>
          )}
        </div>
      )}

      {!loading && mine && (
        <div className="lux-card p-5">
          <p className="mb-4 text-xs font-bold uppercase tracking-widest text-white/45">
            My fan links
          </p>
          {mine.links.length === 0 ? (
            <p className="mb-4 text-sm text-white/55">
              You haven't minted a fan link yet. Paste a creator's user ID below to get your
              personal link to their work — every fan you bring them is credited to you.
            </p>
          ) : (
            <ul className="mb-4 space-y-2">
              {mine.links.map((l) => (
                <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/10 bg-black/30 px-4 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold text-white">
                      {fanLinkContentLabel(l.contentType, l.contentId)}
                      <span className="ml-2 rounded-full bg-primary/15 px-2.5 py-0.5 text-[11px] font-bold text-primary">/f/{l.code}</span>
                    </p>
                    <p className="text-xs text-white/45">{fanLinkStatsLine(l.stats)}</p>
                  </div>
                  <button onClick={() => copy(l.path, l.code)} className={ghostBtn}>
                    {copiedCode === l.code ? <CheckCircle2 className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
                    {copiedCode === l.code ? "Copied" : "Copy link"}
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
            <div>
              <label className={labelClass} htmlFor="fanlink-creator">Creator user ID</label>
              <input
                id="fanlink-creator"
                value={creatorUserId}
                onChange={(e) => setCreatorUserId(e.target.value)}
                placeholder="The creator's user ID"
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass} htmlFor="fanlink-type">Sharing</label>
              <select
                id="fanlink-type"
                value={contentType}
                onChange={(e) => setContentType(e.target.value as FanLinkContentType)}
                className={inputClass}
              >
                {FAN_LINK_CONTENT_TYPES.map((ct) => (
                  <option key={ct} value={ct}>{ct.replace(/_/g, " ")}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="mt-3">
            <label className={labelClass} htmlFor="fanlink-content">Content ID (optional)</label>
            <input
              id="fanlink-content"
              value={contentId}
              onChange={(e) => setContentId(e.target.value)}
              placeholder="A specific track or video ID — blank links their whole page"
              className={inputClass}
            />
          </div>
          <button onClick={mint} disabled={minting || !creatorUserId.trim()} className={`${goldBtn} mt-4`}>
            {minting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}
            Mint my fan link
          </button>
          {mintMsg && <p className="mt-3 text-sm text-white/60">{mintMsg}</p>}
        </div>
      )}
    </section>
  );
}
