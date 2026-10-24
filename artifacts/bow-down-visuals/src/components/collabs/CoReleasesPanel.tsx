import { useEffect, useState } from "react";
import { CheckCircle2, Disc3, Loader2, Package, Send, Undo2, XCircle } from "lucide-react";
import {
  CO_RELEASE_CONSENT_COPY,
  CO_RELEASES_MINE_PATH,
  CO_RELEASES_PATH,
  coReleaseActionPath,
  coReleaseAttributionPath,
  coReleaseStateLabel,
  coReleaseViewerActions,
  displaySharePct,
  splitValidationError,
  standingSides,
  type CoReleaseItem,
} from "@/lib/co-releases";
import type { CoPostPartner } from "./CoPostsPanel";

/* ─── Co-releases panel — co-posts phase 2 (Stack-100 #3 Wave 3) ───────────
   Docked INSIDE the Collabs page as its own tab (the collab payoff
   workflow), never a standalone page: an accepted collab partner (or a
   direct invite) turns ONE of my existing releases or store products
   into a release on BOTH profiles, with a royalty split captured as
   consent up front.

   The consent copy on this panel is the product rule, stated where
   creators act (lib/co-releases CO_RELEASE_CONSENT_COPY, pinned by
   tests): both creators approve the split AND the release before it
   goes live on either profile; the platform's flat 5% fee is taken by
   the store rail first and is never part of the split; the approved
   split locks at publish; either side can withdraw their profile copy
   — agreed splits for earnings stay as agreed. */

type AuthedFn = (
  path: string,
  opts?: { method?: string; body?: unknown },
) => Promise<{ res: Response; data: Record<string, unknown> }>;

const inputClass =
  "w-full rounded-xl border border-white/10 bg-black/60 px-4 py-3 text-sm text-white placeholder:text-white/25 outline-none transition focus:border-primary/60 focus:ring-1 focus:ring-primary/40";
const labelClass = "mb-1.5 block text-xs font-bold uppercase tracking-widest text-white/50";
const goldBtn =
  "inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-b from-amber-300 to-yellow-600 px-5 py-3 text-sm font-extrabold uppercase tracking-wider text-black shadow-[0_0_24px_rgba(234,179,8,0.35)] transition hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed";
const ghostBtn =
  "inline-flex items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/5 px-4 py-2.5 text-sm font-bold text-white/80 transition hover:border-primary/50 hover:text-white disabled:opacity-50";

interface ItemOption {
  id: string;
  title: string;
}

export function CoReleasesPanel({
  authed,
  partners,
  preselectUserId,
}: {
  authed: AuthedFn;
  partners: CoPostPartner[];
  preselectUserId: string | null;
}) {
  const [items, setItems] = useState<CoReleaseItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [setupPending, setSetupPending] = useState(false);

  const [partnerUserId, setPartnerUserId] = useState("");
  const [itemKind, setItemKind] = useState<"release" | "product">("release");
  const [itemOptions, setItemOptions] = useState<ItemOption[]>([]);
  const [itemId, setItemId] = useState("");
  const [authorPct, setAuthorPct] = useState("50");
  const [coAuthorPct, setCoAuthorPct] = useState("50");
  const [creating, setCreating] = useState(false);
  const [createMsg, setCreateMsg] = useState<string | null>(null);
  const [actingId, setActingId] = useState<string | null>(null);
  const [attribution, setAttribution] = useState<Record<string, string>>({});

  async function load() {
    setLoading(true);
    setLoadError(null);
    try {
      const { res, data } = await authed(CO_RELEASES_MINE_PATH);
      if (!res.ok) throw new Error("load failed");
      setItems((data.co_releases as CoReleaseItem[]) ?? []);
      setSetupPending(data.pending_setup === true);
    } catch {
      setLoadError("Couldn't load your co-releases — try again.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (preselectUserId) setPartnerUserId(preselectUserId);
  }, [preselectUserId]);

  /* Item picker: only MY existing items can be co-released — releases
     from the distribution list, products from my own storefront. */
  useEffect(() => {
    (async () => {
      setItemId("");
      try {
        if (itemKind === "release") {
          const { res, data } = await authed("/api/distribution/releases");
          if (!res.ok) return;
          const rows = (data.releases as Array<{ id: string; title: string }>) ?? [];
          setItemOptions(rows.map((r) => ({ id: r.id, title: r.title })));
        } else {
          const me = await authed("/api/creator-profiles/me");
          const profile = (me.data.profile ?? me.data) as { id?: string };
          if (!profile?.id) return;
          const { res, data } = await authed(`/api/storefront/products?profileId=${encodeURIComponent(profile.id)}`);
          if (!res.ok) return;
          const rows = (data.products as Array<{ id: string; title: string }>) ?? [];
          setItemOptions(rows.map((r) => ({ id: r.id, title: r.title })));
        }
      } catch {
        setItemOptions([]);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemKind]);

  const splitError = splitValidationError(Number(authorPct), Number(coAuthorPct));

  async function create() {
    if (creating || !partnerUserId || !itemId || splitError) return;
    setCreating(true);
    setCreateMsg(null);
    try {
      const { res, data } = await authed(CO_RELEASES_PATH, {
        method: "POST",
        body: {
          item_kind: itemKind,
          item_id: itemId,
          co_author_user_id: partnerUserId,
          author_share_pct: Number(authorPct),
          co_author_share_pct: Number(coAuthorPct),
        },
      });
      if (res.status === 503) {
        setCreateMsg("Co-releases are almost ready — the final setup step hasn't landed yet, so nothing was published, no split was agreed, and your collaborator hasn't been notified.");
        return;
      }
      if (!res.ok) throw new Error((data.message as string) || (data.error as string) || "Couldn't create that co-release.");
      setCreateMsg("Co-release drafted — it's waiting on your collaborator to approve the split and the release. It goes live on both profiles only when they approve.");
      load();
    } catch (err) {
      setCreateMsg(err instanceof Error ? err.message : "Couldn't create that co-release.");
    } finally {
      setCreating(false);
    }
  }

  async function act(item: CoReleaseItem, action: "accept" | "decline" | "withdraw") {
    if (actingId) return;
    if (action === "withdraw" && !window.confirm(CO_RELEASE_CONSENT_COPY.withdraw)) return;
    setActingId(item.id);
    try {
      const { res, data } = await authed(coReleaseActionPath(item.id, action), { method: "POST", body: {} });
      if (res.status === 503) {
        setCreateMsg("Co-releases are almost ready — the final setup step hasn't landed yet, so nothing changed.");
        return;
      }
      if (!res.ok) throw new Error((data.message as string) || "That action isn't available.");
      load();
    } catch (err) {
      setCreateMsg(err instanceof Error ? err.message : "Couldn't do that.");
    } finally {
      setActingId(null);
    }
  }

  async function showAttribution(item: CoReleaseItem) {
    try {
      const { res, data } = await authed(coReleaseAttributionPath(item.id));
      if (!res.ok) throw new Error((data.message as string) || "No attribution yet.");
      const totals = (data.totals as Array<{ display_name: string | null; sharePct: number; amountCents: number }>) ?? [];
      const total = (data.total_creator_cents as number) ?? 0;
      setAttribution((prev) => ({
        ...prev,
        [item.id]:
          total === 0
            ? "No earnings recorded for this item since it went live yet."
            : totals.map((t) => `${t.display_name ?? "Creator"} — ${t.sharePct}% · $${(t.amountCents / 100).toFixed(2)}`).join("  ·  "),
      }));
    } catch (err) {
      setAttribution((prev) => ({ ...prev, [item.id]: err instanceof Error ? err.message : "Couldn't load attribution." }));
    }
  }

  return (
    <section className="space-y-6">
      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
        <h3 className="flex items-center gap-2 text-lg font-extrabold">
          <Disc3 className="h-5 w-5 text-primary" aria-hidden="true" /> Co-release a song or product
        </h3>
        <ul className="mt-3 space-y-1.5 text-sm text-white/60">
          <li>{CO_RELEASE_CONSENT_COPY.bothApproveSplit}</li>
          <li>{CO_RELEASE_CONSENT_COPY.feeOutsideSplit}</li>
          <li>{CO_RELEASE_CONSENT_COPY.lockedAtPublish}</li>
          <li>{CO_RELEASE_CONSENT_COPY.withdraw}</li>
        </ul>

        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <div>
            <label className={labelClass} htmlFor="corel-partner">Co-release with</label>
            <select id="corel-partner" className={inputClass} value={partnerUserId} onChange={(e) => setPartnerUserId(e.target.value)}>
              <option value="">Pick a collaborator…</option>
              {partners.map((p) => (
                <option key={p.userId} value={p.userId}>{p.displayName}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass} htmlFor="corel-kind">Item</label>
            <select id="corel-kind" className={inputClass} value={itemKind} onChange={(e) => setItemKind(e.target.value as "release" | "product")}>
              <option value="release">A release (song)</option>
              <option value="product">A store product</option>
            </select>
          </div>
          <div className="sm:col-span-2">
            <label className={labelClass} htmlFor="corel-item">{itemKind === "release" ? "Your release" : "Your product"}</label>
            <select id="corel-item" className={inputClass} value={itemId} onChange={(e) => setItemId(e.target.value)}>
              <option value="">{itemOptions.length === 0 ? "No items found yet" : "Pick one…"}</option>
              {itemOptions.map((o) => (
                <option key={o.id} value={o.id}>{o.title}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass} htmlFor="corel-mine">Your share %</label>
            <input id="corel-mine" className={inputClass} type="number" min="0" max="100" step="0.01" value={authorPct} onChange={(e) => setAuthorPct(e.target.value)} />
          </div>
          <div>
            <label className={labelClass} htmlFor="corel-theirs">Their share %</label>
            <input id="corel-theirs" className={inputClass} type="number" min="0" max="100" step="0.01" value={coAuthorPct} onChange={(e) => setCoAuthorPct(e.target.value)} />
          </div>
        </div>
        {splitError && (authorPct !== "" || coAuthorPct !== "") && <p className="mt-2 text-sm text-red-300">{splitError}</p>}
        <button type="button" className={`${goldBtn} mt-4`} disabled={creating || !partnerUserId || !itemId || !!splitError} onClick={create}>
          {creating ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Send className="h-4 w-4" aria-hidden="true" />}
          Propose co-release
        </button>
        {createMsg && <p className="mt-3 text-sm text-white/70">{createMsg}</p>}
        {setupPending && <p className="mt-3 text-sm text-white/50">Co-releases are almost ready — the final setup step hasn't landed yet.</p>}
      </div>

      <div>
        <h4 className="mb-3 flex items-center gap-2 text-sm font-extrabold uppercase tracking-widest text-white/60">
          <Package className="h-4 w-4 text-primary" aria-hidden="true" /> Your co-releases
        </h4>
        {loading && <p className="flex items-center gap-2 text-sm text-white/50"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Loading…</p>}
        {loadError && <p className="text-sm text-red-300">{loadError}</p>}
        {!loading && !loadError && items.length === 0 && <p className="text-sm text-white/50">No co-releases yet — propose one above.</p>}
        <div className="space-y-3">
          {items.map((item) => {
            const actions = coReleaseViewerActions(item);
            const standing = standingSides(item.sides);
            return (
              <article key={item.id} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-bold">
                    {item.item_title || "Co-release"}{" "}
                    <span className="ml-1 rounded-full bg-primary/15 px-2 py-0.5 text-[11px] font-bold text-primary">
                      {item.item_kind === "release" ? "Release" : "Product"} · Co-release
                    </span>
                  </p>
                  <span className="text-xs font-bold text-white/50">{coReleaseStateLabel(item.co_release_state)}</span>
                </div>
                <p className="mt-1 text-sm text-white/60">
                  {standing.length > 0
                    ? standing.map((s) => `${s.display_name ?? "Creator"} — ${displaySharePct(item, s)}%`).join("  ×  ")
                    : item.sides.map((s) => `${s.display_name ?? "Creator"} — ${s.share_pct}% (${s.status})`).join("  ×  ")}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {actions.includes("accept") && (
                    <button type="button" className={goldBtn} disabled={actingId === item.id} onClick={() => act(item, "accept")}>
                      <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> Approve split + release
                    </button>
                  )}
                  {actions.includes("decline") && (
                    <button type="button" className={ghostBtn} disabled={actingId === item.id} onClick={() => act(item, "decline")}>
                      <XCircle className="h-4 w-4" aria-hidden="true" /> Decline
                    </button>
                  )}
                  {actions.includes("withdraw") && (
                    <button type="button" className={ghostBtn} disabled={actingId === item.id} onClick={() => act(item, "withdraw")}>
                      <Undo2 className="h-4 w-4" aria-hidden="true" /> Withdraw my side
                    </button>
                  )}
                  {(item.co_release_state === "live" || item.co_release_state === "live_one_side") && (
                    <button type="button" className={ghostBtn} onClick={() => showAttribution(item)}>
                      Split of earnings so far
                    </button>
                  )}
                </div>
                {attribution[item.id] && <p className="mt-2 text-sm text-white/70">{attribution[item.id]}</p>}
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}
