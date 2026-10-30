import { apiErrorMessage } from "../../lib/api-error";
import { useEffect, useMemo, useState } from "react";
import {
  CheckCircle2, FileSignature, Handshake, Loader2, PenLine, Undo2, XCircle,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import {
  PLAIN_DEAL_COPY,
  PLAIN_DEALS_MINE_PATH,
  PLAIN_DEALS_PATH,
  dealSplitError,
  plainDealActionPath,
  plainDealStateLabel,
  plainDealViewerActions,
  type PlainDealItem,
  type PlainDealItemKind,
} from "@/lib/plain-deals";

/* ─── Plain-Words Deals — docked into the Contracts page (#164) ──────────
   The deals home sits with the site's other agreements (CREATE →
   PROMOTE → MONEY: a collab deal is written here, signed here, and its
   split lands on the release/product rails). The builder writes the
   deal in plain words; the list shows every deal the viewer is a side
   of, the exact words both sides sign, and — once signed — the frozen
   text plus which rail the split was wired into. All state comes from
   /api/plain-deals; the buttons shown mirror the server machine
   (lib/plain-deals plainDealViewerActions). */

const inputClass =
  "w-full rounded-xl border border-white/10 bg-black/40 px-4 py-3 text-sm text-white/85 placeholder:text-white/25 focus:outline-none focus:border-amber-400/50";
const labelClass = "block text-xs font-bold uppercase tracking-widest text-white/40 mb-2";
const goldBtn =
  "inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-amber-300 to-yellow-500 px-5 py-2.5 text-sm font-black text-black transition hover:from-amber-200 hover:to-yellow-400 disabled:opacity-40 disabled:cursor-not-allowed";
const ghostBtn =
  "inline-flex items-center justify-center gap-2 rounded-xl border border-white/15 px-4 py-2.5 text-sm font-bold text-white/70 transition hover:border-white/35 hover:text-white disabled:opacity-40";

interface PartnerOption {
  id: string;
  userId: string;
  displayName: string;
  slug: string;
}
interface ItemOption {
  id: string;
  title: string;
}

const KIND_OPTIONS: Array<{ key: PlainDealItemKind; label: string }> = [
  { key: "general", label: "Just the agreement" },
  { key: "release", label: "One of my releases" },
  { key: "store_product", label: "One of my store products" },
  { key: "shop_product", label: "One of my shop products" },
];

export function PlainWordsDeals({ isLight }: { isLight: boolean }) {
  const { user, getAccessToken } = useAuth();
  const [deals, setDeals] = useState<PlainDealItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [setupPending, setSetupPending] = useState(false);
  const [actingId, setActingId] = useState<string | null>(null);
  const [signNames, setSignNames] = useState<Record<string, string>>({});
  const [actionMsg, setActionMsg] = useState<string | null>(null);

  /* Builder state */
  const [partners, setPartners] = useState<PartnerOption[]>([]);
  const [partnerQuery, setPartnerQuery] = useState("");
  const [partnerId, setPartnerId] = useState("");
  const [kind, setKind] = useState<PlainDealItemKind>("general");
  const [itemOptions, setItemOptions] = useState<ItemOption[]>([]);
  const [itemId, setItemId] = useState("");
  const [title, setTitle] = useState("");
  const [myDoes, setMyDoes] = useState("");
  const [myGets, setMyGets] = useState("");
  const [theirDoes, setTheirDoes] = useState("");
  const [theirGets, setTheirGets] = useState("");
  const [myPct, setMyPct] = useState("50");
  const [theirPct, setTheirPct] = useState("50");
  const [myName, setMyName] = useState("");
  const [creating, setCreating] = useState(false);
  const [createMsg, setCreateMsg] = useState<string | null>(null);

  /* Amend state (one deal at a time) */
  const [amendingId, setAmendingId] = useState<string | null>(null);
  const [amendTitle, setAmendTitle] = useState("");
  const [amendMyDoes, setAmendMyDoes] = useState("");
  const [amendMyGets, setAmendMyGets] = useState("");
  const [amendTheirDoes, setAmendTheirDoes] = useState("");
  const [amendTheirGets, setAmendTheirGets] = useState("");
  const [amendMyPct, setAmendMyPct] = useState("50");
  const [amendTheirPct, setAmendTheirPct] = useState("50");

  async function authed(path: string, opts: { method?: string; body?: unknown } = {}) {
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
  }

  async function load() {
    if (!user) return;
    setLoading(true);
    setLoadError(null);
    try {
      const { res, data } = await authed(PLAIN_DEALS_MINE_PATH);
      if (res.status === 503) {
        setSetupPending(true);
        setDeals([]);
        return;
      }
      if (!res.ok) throw new Error("load failed");
      setSetupPending(false);
      setDeals((data.plain_deals as PlainDealItem[]) ?? []);
    } catch {
      setLoadError("Couldn't load your deals — try again.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  /* Partner picker: the creator directory the Collabs page browses. */
  useEffect(() => {
    if (!user) return;
    (async () => {
      try {
        const { res, data } = await authed("/api/collabs/profiles");
        if (!res.ok) return;
        const rows = (data.profiles as Array<Record<string, unknown>>) ?? [];
        setPartners(
          rows
            .filter((p) => p.userId !== user.id)
            .map((p) => ({
              id: String(p.id),
              userId: String(p.userId),
              displayName: String(p.displayName ?? "Creator"),
              slug: String(p.slug ?? ""),
            })),
        );
      } catch {
        setPartners([]);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  /* Item picker: only MY items can carry a deal's split. */
  useEffect(() => {
    (async () => {
      setItemId("");
      if (!user || kind === "general") {
        setItemOptions([]);
        return;
      }
      try {
        if (kind === "release") {
          const { res, data } = await authed("/api/distribution/releases");
          if (!res.ok) return;
          const rows = (data.releases as Array<{ id: string; title: string }>) ?? [];
          setItemOptions(rows.map((r) => ({ id: r.id, title: r.title })));
        } else if (kind === "store_product") {
          const me = await authed("/api/creator-profiles/me");
          const profile = (me.data.profile ?? me.data) as { id?: string };
          if (!profile?.id) return;
          const { res, data } = await authed(`/api/storefront/products?profileId=${encodeURIComponent(profile.id)}`);
          if (!res.ok) return;
          const rows = (data.products as Array<{ id: string; title: string }>) ?? [];
          setItemOptions(rows.map((r) => ({ id: r.id, title: r.title })));
        } else {
          const shopsRes = await authed("/api/shops");
          const shops = (shopsRes.data.shops as Array<{ id: string; name?: string }>) ?? [];
          const all: ItemOption[] = [];
          for (const shop of shops) {
            const { res, data } = await authed(`/api/shops/${shop.id}/products`);
            if (!res.ok) continue;
            const rows = (data.products as Array<{ id: string; name: string }>) ?? [];
            for (const r of rows) all.push({ id: r.id, title: r.name });
          }
          setItemOptions(all);
        }
      } catch {
        setItemOptions([]);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, user]);

  const filteredPartners = useMemo(() => {
    const q = partnerQuery.trim().toLowerCase();
    if (!q) return partners.slice(0, 8);
    return partners
      .filter((p) => p.displayName.toLowerCase().includes(q) || p.slug.toLowerCase().includes(q))
      .slice(0, 8);
  }, [partners, partnerQuery]);

  const splitErr = dealSplitError(Number(myPct), Number(theirPct));
  const canCreate =
    !!user && !!partnerId && title.trim().length >= 3 && myDoes.trim() && myGets.trim() &&
    theirDoes.trim() && theirGets.trim() && myName.trim().length >= 2 && !splitErr &&
    (kind === "general" || !!itemId) && !creating;

  async function create() {
    if (!canCreate) return;
    setCreating(true);
    setCreateMsg(null);
    try {
      const { res, data } = await authed(PLAIN_DEALS_PATH, {
        method: "POST",
        body: {
          title: title.trim(),
          item_kind: kind,
          ...(kind !== "general" ? { item_id: itemId } : {}),
          partner_profile_id: partnerId,
          author: { does_text: myDoes.trim(), gets_text: myGets.trim(), share_pct: Number(myPct) },
          partner: { does_text: theirDoes.trim(), gets_text: theirGets.trim(), share_pct: Number(theirPct) },
          signed_name: myName.trim(),
        },
      });
      if (!res.ok) {
        setCreateMsg(apiErrorMessage(data, "Couldn't write that deal — check the split and try again."));
        return;
      }
      setCreateMsg("Deal written and signed by you. Your partner got the invite — nothing counts until they sign the same words.");
      setTitle("");
      setMyDoes("");
      setMyGets("");
      setTheirDoes("");
      setTheirGets("");
      await load();
    } catch {
      setCreateMsg("Couldn't write that deal — try again.");
    } finally {
      setCreating(false);
    }
  }

  async function act(deal: PlainDealItem, action: "sign" | "decline" | "withdraw") {
    setActingId(deal.id);
    setActionMsg(null);
    try {
      const body =
        action === "sign"
          ? { signed_name: (signNames[deal.id] ?? deal.viewer_side?.name ?? "").trim() }
          : undefined;
      if (action === "sign" && (!body?.signed_name || body.signed_name.length < 2)) {
        setActionMsg("Type your name the way you sign it first.");
        return;
      }
      const { res, data } = await authed(plainDealActionPath(deal.id, action), { method: "POST", body });
      if (!res.ok) {
        setActionMsg(apiErrorMessage(data, "That didn't go through — refresh and try again."));
        return;
      }
      if (action === "sign") {
        setActionMsg("Signed. When both sides have signed, the split is wired in exactly as written.");
      }
      await load();
    } catch {
      setActionMsg("That didn't go through — try again.");
    } finally {
      setActingId(null);
    }
  }

  function beginAmend(deal: PlainDealItem) {
    const mine = deal.sides.find((s) => s.role === "author");
    const theirs = deal.sides.find((s) => s.role === "partner");
    if (!mine || !theirs) return;
    setAmendingId(deal.id);
    setAmendTitle(deal.title);
    setAmendMyDoes(mine.does_text);
    setAmendMyGets(mine.gets_text);
    setAmendTheirDoes(theirs.does_text);
    setAmendTheirGets(theirs.gets_text);
    setAmendMyPct(String(mine.share_pct));
    setAmendTheirPct(String(theirs.share_pct));
  }

  async function submitAmend(deal: PlainDealItem) {
    const err = dealSplitError(Number(amendMyPct), Number(amendTheirPct));
    if (err) {
      setActionMsg(err);
      return;
    }
    setActingId(deal.id);
    try {
      const { res, data } = await authed(plainDealActionPath(deal.id, "amend"), {
        method: "POST",
        body: {
          title: amendTitle.trim(),
          author: {
            does_text: amendMyDoes.trim(),
            gets_text: amendMyGets.trim(),
            share_pct: Number(amendMyPct),
            signed_name: (deal.viewer_side?.name ?? myName).trim() || "—",
          },
          partner: { does_text: amendTheirDoes.trim(), gets_text: amendTheirGets.trim(), share_pct: Number(amendTheirPct) },
        },
      });
      if (!res.ok) {
        setActionMsg(apiErrorMessage(data, "Couldn't change that deal."));
        return;
      }
      setAmendingId(null);
      setActionMsg("Deal rewritten. Your partner has to sign the new words before anything counts.");
      await load();
    } catch {
      setActionMsg("Couldn't change that deal — try again.");
    } finally {
      setActingId(null);
    }
  }

  const cardClass = `rounded-2xl border p-6 md:p-8 ${isLight ? "border-[#C9A84C]/40 bg-gradient-to-b from-[#FCF7EA] to-[#F4E7C3]" : "border-primary/25 bg-gradient-to-b from-[#14100a] to-[#0d0a04]"}`;

  return (
    <section className={`${cardClass} mt-10`} data-testid="plain-words-deals">
      <div className="flex items-center gap-3 mb-2">
        <Handshake className="h-6 w-6 text-amber-400" />
        <h2 className="text-2xl font-black">{PLAIN_DEAL_COPY.heading}</h2>
      </div>
      <p className="text-sm text-white/55 max-w-3xl mb-1">{PLAIN_DEAL_COPY.intro}</p>
      <p className="text-xs text-white/35 max-w-3xl mb-6">{PLAIN_DEAL_COPY.consent}</p>

      {!user ? (
        <p className="text-sm text-white/40">Sign in to write and sign deals.</p>
      ) : setupPending ? (
        <p className="text-sm text-white/40">
          Plain-Words Deals are rolling out — the deal book opens here the moment the rollout lands. Check back shortly.
        </p>
      ) : (
        <>
          {/* Builder */}
          <div className="rounded-xl border border-white/10 bg-black/30 p-5 mb-8">
            <h3 className="text-sm font-black uppercase tracking-widest text-white/60 mb-4 flex items-center gap-2">
              <PenLine className="h-4 w-4 text-amber-400" /> Write a deal
            </h3>
            <div className="grid md:grid-cols-2 gap-4 mb-4">
              <div>
                <label className={labelClass}>Deal title</label>
                <input aria-label="Deal title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Our song 'Midnight Run'" className={inputClass} />
              </div>
              <div>
                <label className={labelClass}>Your partner</label>
                <input aria-label="Your partner"
                  value={partnerQuery}
                  onChange={(e) => setPartnerQuery(e.target.value)}
                  placeholder="Search creators…"
                  className={inputClass}
                />
                <div className="flex flex-wrap gap-2 mt-2">
                  {filteredPartners.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setPartnerId(p.id)}
                      className={`px-3 py-1.5 rounded-full text-xs font-bold border transition-colors ${
                        partnerId === p.id
                          ? "border-amber-400/60 bg-amber-400/15 text-amber-200"
                          : "border-white/10 bg-white/[0.03] text-white/50 hover:text-white"
                      }`}
                    >
                      {p.displayName}
                    </button>
                  ))}
                  {partners.length === 0 && <span className="text-xs text-white/30">Creator directory unavailable right now.</span>}
                </div>
              </div>
            </div>

            <label className={labelClass}>What is this deal about?</label>
            <div className="flex flex-wrap gap-2 mb-4">
              {KIND_OPTIONS.map((k) => (
                <button
                  key={k.key}
                  type="button"
                  onClick={() => setKind(k.key)}
                  className={`px-4 py-2 rounded-full text-sm font-bold border transition-colors ${
                    kind === k.key
                      ? "border-amber-400/60 bg-amber-400/15 text-amber-200"
                      : "border-white/10 bg-white/[0.03] text-white/50 hover:text-white"
                  }`}
                >
                  {k.label}
                </button>
              ))}
            </div>
            {kind !== "general" && (
              <div className="mb-4">
                <label className={labelClass}>Pick the item — its money follows this split once you both sign</label>
                <select aria-label="Pick the item — its money follows this split once you both sign" value={itemId} onChange={(e) => setItemId(e.target.value)} className={inputClass}>
                  <option value="">{itemOptions.length === 0 ? "No items found yet" : "Pick one…"}</option>
                  {itemOptions.map((o) => (
                    <option key={o.id} value={o.id}>{o.title}</option>
                  ))}
                </select>
              </div>
            )}

            <div className="grid md:grid-cols-2 gap-4 mb-4">
              <div className="rounded-xl border border-white/10 p-4">
                <div className="text-xs font-black uppercase tracking-widest text-amber-300/80 mb-3">You</div>
                <label className={labelClass}>You do</label>
                <textarea aria-label="You do" value={myDoes} onChange={(e) => setMyDoes(e.target.value)} rows={2} placeholder="write and record the song" className={inputClass} />
                <label className={`${labelClass} mt-3`}>You get</label>
                <textarea aria-label="You get" value={myGets} onChange={(e) => setMyGets(e.target.value)} rows={2} placeholder="lead artist credit" className={inputClass} />
                <label className={`${labelClass} mt-3`}>Your share %</label>
                <input aria-label="Your share %" value={myPct} onChange={(e) => setMyPct(e.target.value)} inputMode="decimal" className={inputClass} />
              </div>
              <div className="rounded-xl border border-white/10 p-4">
                <div className="text-xs font-black uppercase tracking-widest text-amber-300/80 mb-3">Your partner</div>
                <label className={labelClass}>They do</label>
                <textarea aria-label="They do" value={theirDoes} onChange={(e) => setTheirDoes(e.target.value)} rows={2} placeholder="produce the beat" className={inputClass} />
                <label className={`${labelClass} mt-3`}>They get</label>
                <textarea aria-label="They get" value={theirGets} onChange={(e) => setTheirGets(e.target.value)} rows={2} placeholder="producer credit" className={inputClass} />
                <label className={`${labelClass} mt-3`}>Their share %</label>
                <input aria-label="Their share %" value={theirPct} onChange={(e) => setTheirPct(e.target.value)} inputMode="decimal" className={inputClass} />
              </div>
            </div>
            {splitErr && (myPct !== "" || theirPct !== "") && (
              <p className="text-xs text-amber-300 mb-3">{splitErr}</p>
            )}
            <div className="flex flex-col md:flex-row gap-3 md:items-end">
              <div className="flex-1">
                <label className={labelClass}>Sign your name — writing the deal signs your side</label>
                <input aria-label="Sign your name — writing the deal signs your side" value={myName} onChange={(e) => setMyName(e.target.value)} placeholder="Your name, the way you sign it" className={inputClass} />
              </div>
              <button type="button" onClick={create} disabled={!canCreate} className={goldBtn}>
                {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSignature className="h-4 w-4" />}
                Write &amp; sign this deal
              </button>
            </div>
            {createMsg && <p className="text-sm text-white/60 mt-3">{createMsg}</p>}
          </div>

          {/* My deals */}
          <h3 className="text-sm font-black uppercase tracking-widest text-white/60 mb-4">Your deals</h3>
          {actionMsg && <p className="text-sm text-amber-200 mb-3">{actionMsg}</p>}
          {loading ? (
            <p className="text-sm text-white/40 flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Loading your deals…</p>
          ) : loadError ? (
            <p className="text-sm text-red-300">{loadError}</p>
          ) : deals.length === 0 ? (
            <p className="text-sm text-white/40">No deals yet. Write your first one above — it takes a minute and reads like you talk.</p>
          ) : (
            <div className="space-y-4">
              {deals.map((deal) => {
                const actions = plainDealViewerActions(deal);
                const busy = actingId === deal.id;
                return (
                  <div key={deal.id} className="rounded-xl border border-white/10 bg-black/30 p-5">
                    <div className="flex flex-wrap items-center gap-2 mb-2">
                      <span className="font-black text-white/90">{deal.title}</span>
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-widest border ${
                        deal.deal_state === "signed"
                          ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/40"
                          : deal.deal_state === "awaiting_signature"
                            ? "bg-amber-400/10 text-amber-300 border-amber-400/40"
                            : "bg-white/5 text-white/40 border-white/15"
                      }`}>
                        {plainDealStateLabel(deal.deal_state)}
                      </span>
                      {deal.item_title && <span className="text-xs text-white/40">about: {deal.item_title}</span>}
                    </div>

                    <div className="grid md:grid-cols-2 gap-3 mb-3">
                      {deal.sides.map((s) => (
                        <div key={s.id} className="rounded-lg border border-white/[0.07] bg-black/20 p-3">
                          <div className="text-sm font-bold text-white/85">
                            {s.name ?? "Creator"} <span className="text-amber-300">{s.share_pct}%</span>
                            {s.is_viewer && <span className="text-white/35 text-xs"> (you)</span>}
                          </div>
                          <p className="text-xs text-white/55 mt-1"><span className="text-white/35">Does:</span> {s.does_text}</p>
                          <p className="text-xs text-white/55"><span className="text-white/35">Gets:</span> {s.gets_text}</p>
                          <p className="text-xs mt-1.5 flex items-center gap-1.5">
                            {s.status === "signed" ? (
                              <span className="text-emerald-300 flex items-center gap-1"><CheckCircle2 className="h-3.5 w-3.5" /> Signed{s.signed_name ? ` as ${s.signed_name}` : ""}</span>
                            ) : s.status === "pending" ? (
                              <span className="text-amber-300">Not signed yet</span>
                            ) : (
                              <span className="text-white/40 flex items-center gap-1"><XCircle className="h-3.5 w-3.5" /> {s.status}</span>
                            )}
                          </p>
                        </div>
                      ))}
                    </div>

                    {deal.deal_state === "signed" && deal.signed_text ? (
                      <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/[0.04] p-3 mb-3">
                        <div className="text-[10px] font-black uppercase tracking-widest text-emerald-300/80 mb-1">The signed words — frozen</div>
                        <p className="text-xs text-white/65 whitespace-pre-line">{deal.signed_text}</p>
                        <p className="text-xs text-emerald-200/80 mt-2">
                          {deal.split_attach?.rail === "co_release"
                            ? PLAIN_DEAL_COPY.attachCoRelease
                            : deal.split_attach?.rail === "sale_splits"
                              ? PLAIN_DEAL_COPY.attachSaleSplits
                              : PLAIN_DEAL_COPY.signedNoAttach}
                        </p>
                      </div>
                    ) : (
                      <p className="text-xs text-white/45 whitespace-pre-line mb-3">{deal.plain_text}</p>
                    )}

                    {actions.length > 0 && amendingId !== deal.id && (
                      <div className="flex flex-wrap items-center gap-2">
                        {actions.includes("sign") && (
                          <>
                            <input aria-label="Your name, the way you sign it"
                              value={signNames[deal.id] ?? deal.viewer_side?.name ?? ""}
                              onChange={(e) => setSignNames((m) => ({ ...m, [deal.id]: e.target.value }))}
                              placeholder="Your name, the way you sign it"
                              className="rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-white/85 placeholder:text-white/25 focus:outline-none focus:border-amber-400/50 w-56"
                            />
                            <button type="button" disabled={busy} onClick={() => act(deal, "sign")} className={goldBtn}>
                              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSignature className="h-4 w-4" />} Sign these words
                            </button>
                          </>
                        )}
                        {actions.includes("amend") && (
                          <button type="button" disabled={busy} onClick={() => beginAmend(deal)} className={ghostBtn}>
                            <PenLine className="h-4 w-4" /> Rewrite the words
                          </button>
                        )}
                        {actions.includes("decline") && (
                          <button type="button" disabled={busy} onClick={() => act(deal, "decline")} className={ghostBtn}>
                            <XCircle className="h-4 w-4" /> Decline
                          </button>
                        )}
                        {actions.includes("withdraw") && (
                          <button type="button" disabled={busy} onClick={() => act(deal, "withdraw")} className={ghostBtn}>
                            <Undo2 className="h-4 w-4" /> Withdraw
                          </button>
                        )}
                      </div>
                    )}

                    {amendingId === deal.id && (
                      <div className="rounded-lg border border-amber-400/25 bg-amber-400/[0.03] p-4 mt-1">
                        <div className="text-xs font-black uppercase tracking-widest text-amber-300/80 mb-3">
                          Rewrite — your partner signs the new words before anything counts
                        </div>
                        <label className={labelClass}>Title</label>
                        <input aria-label="Title" value={amendTitle} onChange={(e) => setAmendTitle(e.target.value)} className={inputClass} />
                        <div className="grid md:grid-cols-2 gap-4 mt-3">
                          <div>
                            <label className={labelClass}>You do</label>
                            <textarea aria-label="You do" value={amendMyDoes} onChange={(e) => setAmendMyDoes(e.target.value)} rows={2} className={inputClass} />
                            <label className={`${labelClass} mt-3`}>You get</label>
                            <textarea aria-label="You get" value={amendMyGets} onChange={(e) => setAmendMyGets(e.target.value)} rows={2} className={inputClass} />
                            <label className={`${labelClass} mt-3`}>Your share %</label>
                            <input aria-label="Your share %" value={amendMyPct} onChange={(e) => setAmendMyPct(e.target.value)} inputMode="decimal" className={inputClass} />
                          </div>
                          <div>
                            <label className={labelClass}>They do</label>
                            <textarea aria-label="They do" value={amendTheirDoes} onChange={(e) => setAmendTheirDoes(e.target.value)} rows={2} className={inputClass} />
                            <label className={`${labelClass} mt-3`}>They get</label>
                            <textarea aria-label="They get" value={amendTheirGets} onChange={(e) => setAmendTheirGets(e.target.value)} rows={2} className={inputClass} />
                            <label className={`${labelClass} mt-3`}>Their share %</label>
                            <input aria-label="Their share %" value={amendTheirPct} onChange={(e) => setAmendTheirPct(e.target.value)} inputMode="decimal" className={inputClass} />
                          </div>
                        </div>
                        <div className="flex gap-2 mt-4">
                          <button type="button" disabled={busy} onClick={() => submitAmend(deal)} className={goldBtn}>
                            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <PenLine className="h-4 w-4" />} Save the new words
                          </button>
                          <button type="button" disabled={busy} onClick={() => setAmendingId(null)} className={ghostBtn}>
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </section>
  );
}
