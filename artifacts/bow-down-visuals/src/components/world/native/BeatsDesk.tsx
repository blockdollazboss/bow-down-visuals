import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import {
  BadgeDollarSign, Check, Disc3, Loader2, LogIn, Pause, Pencil, Play, Plus, Search, Trash2, X,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import {
  NativeCard, NativeEmptyState, NativeErrorState, NativeLoadingState,
} from "@/components/world/native";
import { deskInputCls, useDeskAuthHeaders } from "@/components/world/native/CreateDeskShared";
import { BEAT_LICENSE_FORMATS, describeTermsInline, templateTerms, type BeatLicenseTemplate } from "@/lib/beat-license-terms";
import { GUEST_SIGN_IN_HREF } from "@/lib/world/guest-honest";
import {
  BEATS_COMMISSION_LINE,
  BEATS_PAYMENT_NOTE,
  BEATS_PAGE_SIZE,
  apiErrorLine,
  beatCheckoutSessionId,
  beatCheckoutUrl,
  beatLicensePath,
  beatLicensePayload,
  beatListingProblem,
  beatSaleStatusLabel,
  beatTemplateFormFromDto,
  beatTemplateOffer,
  beatTierOffers,
  beatsBrowsePath,
  buildBeatListingPayload,
  buildBeatTemplatePayload,
  beatTemplateProblem,
  emptyBeatListingForm,
  emptyBeatTemplateForm,
  moneyCents,
  parseBeatDashboard,
  parseBeatList,
  parseMyLicenses,
  parseMyTemplates,
  beatVerifyConfirmed,
  type BeatDashboard,
  type BeatDto,
  type BeatFilters,
  type BeatListingForm,
  type BeatSale,
  type BeatTemplateForm,
} from "@/lib/world/money-desks-2";
import { BEAT_GENRES } from "@/lib/world/money-desks-2";

/* ─── BeatsDesk — the Beats licensing marketplace in the Music Hall
   (Stack-100 #65). The beats page (pages/beats.tsx) is the reference
   implementation and every verb rides its rails verbatim:
   browse/preview on GET /api/beats (its filters, its limit/offset),
   licensing on POST /api/beats/:id/license naming exactly one offer
   — a Basic/Premium/Exclusive tier or one of the producer's custom
   templates — with the hosted checkout opening in a NEW TAB (the
   sanctioned exit) and the license confirmed on return through
   POST /api/beats/licenses/verify, the very call the page makes
   when it lands back with a session id. Selling is the page's free
   POST /api/beats; the seller dashboard is GET
   /api/beats/mine/dashboard (gross → net already net of the 15%
   commission server-side) plus the license-template CRUD. The
   commission line is the page's own subtitle, shown where the page
   shows it. Guests browse and preview (the browse rail is public);
   licensing, selling and the dashboard are members' business and
   meet the sign-in pitch instead of a dead button. */

type BeatsTab = "browse" | "sell" | "dashboard";

export function BeatsDesk({ isLight, isGuest }: { isLight: boolean; isGuest: boolean }) {
  const authHeaders = useDeskAuthHeaders();
  const [tab, setTab] = useState<BeatsTab>("browse");

  /* ── Browse ── */
  const [filters, setFilters] = useState<BeatFilters>({ genre: "", mood: "", search: "", minBpm: "", maxBpm: "" });
  const [beats, setBeats] = useState<BeatDto[] | null>(null);
  const [browseFailed, setBrowseFailed] = useState(false);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);

  const loadBrowse = useCallback(async (nextOffset: number, append: boolean) => {
    try {
      const res = await fetch(beatsBrowsePath(filters, nextOffset));
      if (!res.ok) throw new Error("browse");
      const page = parseBeatList(await res.json());
      setBeats((prev) => (append && prev ? [...prev, ...page] : page));
      setHasMore(page.length === BEATS_PAGE_SIZE);
      setOffset(nextOffset);
      setBrowseFailed(false);
    } catch {
      if (!append) setBrowseFailed(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters]);

  useEffect(() => { void loadBrowse(0, false); }, [loadBrowse]);

  const togglePlay = (beat: BeatDto) => {
    const el = audioRef.current;
    if (!el) return;
    if (playingId === beat.id) {
      el.pause();
      setPlayingId(null);
      return;
    }
    el.src = beat.previewUrl ?? beat.audioUrl;
    void el.play().catch(() => {});
    setPlayingId(beat.id);
  };

  /* ── Licensing ── */
  const [licenseBeat, setLicenseBeat] = useState<BeatDto | null>(null);
  const [offerKey, setOfferKey] = useState<string>("basic");
  const [licensing, setLicensing] = useState(false);
  const [licenseNote, setLicenseNote] = useState<string | null>(null);
  const [licenseError, setLicenseError] = useState<string | null>(null);
  const [myLicenses, setMyLicenses] = useState<BeatSale[] | null>(null);
  const pendingSessionRef = useRef<string | null>(null);

  const loadMyLicenses = useCallback(async () => {
    if (isGuest) return;
    try {
      const res = await fetch("/api/beats/licenses/mine", { headers: await authHeaders() });
      if (!res.ok) return;
      setMyLicenses(parseMyLicenses(await res.json()));
    } catch { /* the library is a quiet extra — browse never depends on it */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isGuest]);

  useEffect(() => { void loadMyLicenses(); }, [loadMyLicenses]);

  /* Returning from the hosted checkout tab: verify the pending
     session ONCE on focus — the same verify rail the beats page
     calls when it lands back with ?session_id. */
  useEffect(() => {
    if (isGuest) return;
    const onFocus = () => {
      const sessionId = pendingSessionRef.current;
      if (!sessionId) return;
      pendingSessionRef.current = null;
      void (async () => {
        try {
          const res = await fetch("/api/beats/licenses/verify", {
            method: "POST",
            headers: { "Content-Type": "application/json", ...(await authHeaders()) },
            body: JSON.stringify({ sessionId }),
          });
          const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
          if (beatVerifyConfirmed(data)) {
            setLicenseNote("Payment confirmed — your license is active. Find it in your licenses below.");
            void loadMyLicenses();
          } else {
            setLicenseError(apiErrorLine(data, "We couldn't confirm that payment. If you were charged, contact support."));
          }
        } catch {
          setLicenseError("We couldn't confirm that payment. If you were charged, contact support.");
        }
      })();
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isGuest, loadMyLicenses]);

  const reserveLicense = async () => {
    if (!licenseBeat || licensing) return;
    setLicensing(true);
    setLicenseNote(null);
    setLicenseError(null);
    try {
      const isTemplate = offerKey.startsWith("tpl:");
      const payload = isTemplate
        ? beatLicensePayload({ templateId: offerKey.slice(4) })
        : beatLicensePayload({ tier: offerKey });
      const res = await fetch(beatLicensePath(licenseBeat.id), {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify(payload),
      });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) throw new Error(apiErrorLine(data, "That license couldn't be reserved."));
      const url = beatCheckoutUrl(data);
      if (url) {
        pendingSessionRef.current = beatCheckoutSessionId(data);
        window.open(url, "_blank", "noopener,noreferrer");
        setLicenseNote("Checkout opened in a new tab — finish paying there and your license activates the moment the payment confirms.");
        return;
      }
      setLicenseNote(typeof data["message"] === "string" ? data["message"] : "License reserved.");
    } catch (e) {
      setLicenseError(e instanceof Error ? e.message : "That license couldn't be reserved — try again.");
    } finally {
      setLicensing(false);
    }
  };

  /* ── Sell ── */
  const [listingForm, setListingForm] = useState<BeatListingForm>(() => emptyBeatListingForm());
  const [listing, setListing] = useState(false);
  const [listNote, setListNote] = useState<string | null>(null);
  const [listError, setListError] = useState<string | null>(null);

  const submitListing = async () => {
    const problem = beatListingProblem(listingForm);
    if (problem) { setListError(problem); setListNote(null); return; }
    setListing(true);
    setListError(null);
    setListNote(null);
    try {
      const res = await fetch("/api/beats", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify(buildBeatListingPayload(listingForm)),
      });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) throw new Error(apiErrorLine(data, "That listing couldn't go live."));
      const title = isObjTitle(data);
      setListNote(`"${title}" is live in the marketplace.`);
      setListingForm(emptyBeatListingForm());
      void loadBrowse(0, false);
    } catch (e) {
      setListError(e instanceof Error ? e.message : "That listing couldn't go live — try again.");
    } finally {
      setListing(false);
    }
  };

  /* ── Seller dashboard + templates ── */
  const [dashboard, setDashboard] = useState<BeatDashboard | null>(null);
  const [dashFailed, setDashFailed] = useState(false);
  const [templates, setTemplates] = useState<BeatLicenseTemplate[] | null>(null);
  const [tplForm, setTplForm] = useState<BeatTemplateForm | null>(null);
  const [tplEditingId, setTplEditingId] = useState<string | null>(null);
  const [tplSaving, setTplSaving] = useState(false);
  const [tplError, setTplError] = useState<string | null>(null);
  const [confirmingDeleteTpl, setConfirmingDeleteTpl] = useState<string | null>(null);

  const loadDashboard = useCallback(async () => {
    if (isGuest) return;
    try {
      const res = await fetch("/api/beats/mine/dashboard", { headers: await authHeaders() });
      if (!res.ok) throw new Error("dash");
      setDashboard(parseBeatDashboard(await res.json()));
      setDashFailed(false);
    } catch { setDashFailed(true); }
    try {
      const res = await fetch("/api/beats/license-templates/mine", { headers: await authHeaders() });
      if (res.ok) setTemplates(parseMyTemplates(await res.json()));
    } catch { /* templates degrade alone — the dashboard above already settled */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isGuest]);

  useEffect(() => { if (tab === "dashboard") void loadDashboard(); }, [tab, loadDashboard]);

  const saveTemplate = async () => {
    if (!tplForm || tplSaving) return;
    const problem = beatTemplateProblem(tplForm);
    if (problem) { setTplError(problem); return; }
    setTplSaving(true);
    setTplError(null);
    try {
      const res = await fetch(
        tplEditingId ? `/api/beats/license-templates/${tplEditingId}` : "/api/beats/license-templates",
        {
          method: tplEditingId ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json", ...(await authHeaders()) },
          body: JSON.stringify(buildBeatTemplatePayload(tplForm)),
        },
      );
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) throw new Error(apiErrorLine(data, "Couldn't save that template — check the fields and try again."));
      setTplForm(null);
      setTplEditingId(null);
      await loadDashboard();
    } catch (e) {
      setTplError(e instanceof Error ? e.message : "Couldn't save that template — check the fields and try again.");
    } finally {
      setTplSaving(false);
    }
  };

  const deleteTemplate = async (id: string) => {
    try {
      const res = await fetch(`/api/beats/license-templates/${id}`, {
        method: "DELETE",
        headers: await authHeaders(),
      });
      if (res.ok) {
        setConfirmingDeleteTpl(null);
        await loadDashboard();
      }
    } catch { /* the reload in loadDashboard surfaces the truth */ }
  };

  const muted = isLight ? "text-[#6B5B36]" : "text-white/50";
  const tabBtn = (active: boolean) =>
    `rounded-full px-3.5 py-1.5 text-xs font-bold transition ${
      active ? "bg-[#d4af37] text-black" : isLight ? "border border-[#7A5A12]/30 text-[#6B5B36]" : "border border-white/15 text-white/75"
    }`;
  const inputCls = deskInputCls(isLight);
  const setF = (patch: Partial<BeatFilters>) => setFilters((f) => ({ ...f, ...patch }));
  const setL = (patch: Partial<BeatListingForm>) => setListingForm((f) => ({ ...f, ...patch }));
  const setT = (patch: Partial<BeatTemplateForm>) => setTplForm((f) => (f ? { ...f, ...patch } : f));

  const memberPitch = (what: string) => (
    <NativeCard isLight={isLight}>
      <p className={`inline-flex flex-wrap items-center gap-2 text-sm ${muted}`}>
        {what} is members&rsquo; business — sign in and it happens right here.
        <Link href={GUEST_SIGN_IN_HREF} className="inline-flex items-center gap-1 rounded-full bg-[#d4af37] px-3 py-1 text-xs font-bold text-black transition hover:scale-105">
          <LogIn className="h-3 w-3" /> Sign in
        </Link>
      </p>
    </NativeCard>
  );

  return (
    <div className="space-y-3" data-testid="world-beats-desk">
      <audio ref={audioRef} onEnded={() => setPlayingId(null)} className="hidden" />
      <p className={`px-1 text-xs ${muted}`}>{BEATS_COMMISSION_LINE}</p>
      <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Beat marketplace">
        <button type="button" role="tab" aria-selected={tab === "browse"} data-testid="world-beats-tab-browse" onClick={() => setTab("browse")} className={tabBtn(tab === "browse")}>Browse</button>
        <button type="button" role="tab" aria-selected={tab === "sell"} data-testid="world-beats-tab-sell" onClick={() => setTab("sell")} className={tabBtn(tab === "sell")}>Sell a beat</button>
        <button type="button" role="tab" aria-selected={tab === "dashboard"} data-testid="world-beats-tab-dashboard" onClick={() => setTab("dashboard")} className={tabBtn(tab === "dashboard")}>Seller dashboard</button>
      </div>

      {tab === "browse" && (
        <>
          <NativeCard isLight={isLight} title="Find a beat">
            <div className="flex flex-wrap gap-2">
              <span className="relative min-w-40 flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#d4af37]" />
                <input aria-label="Search beats" value={filters.search} onChange={(e) => setF({ search: e.target.value })} placeholder="Search titles…" className={`${inputCls} pl-8`} />
              </span>
              <select aria-label="Genre" value={filters.genre} onChange={(e) => setF({ genre: e.target.value })} className={inputCls}>
                <option value="">All genres</option>
                {BEAT_GENRES.map((g) => <option key={g} value={g}>{g}</option>)}
              </select>
              <input aria-label="Mood" value={filters.mood} onChange={(e) => setF({ mood: e.target.value })} placeholder="Mood" className={`${inputCls} w-24`} />
              <input aria-label="Min BPM" value={filters.minBpm} onChange={(e) => setF({ minBpm: e.target.value })} placeholder="Min BPM" inputMode="numeric" className={`${inputCls} w-24`} />
              <input aria-label="Max BPM" value={filters.maxBpm} onChange={(e) => setF({ maxBpm: e.target.value })} placeholder="Max BPM" inputMode="numeric" className={`${inputCls} w-24`} />
            </div>
          </NativeCard>

          {browseFailed ? (
            <NativeErrorState isLight={isLight} title="The marketplace wouldn't open" message="The beats are safe on the real rails — this stand just couldn't read them. Try again." onRetry={() => void loadBrowse(0, false)} />
          ) : beats === null ? (
            <NativeLoadingState isLight={isLight} message="Loading the marketplace…" />
          ) : beats.length === 0 ? (
            <NativeEmptyState isLight={isLight} message="No beats match that search." detail="Loosen a filter, or be the first to list one under Sell a beat." />
          ) : (
            <div className="space-y-2">
              {beats.map((beat) => (
                <NativeCard key={beat.id} isLight={isLight}>
                  <div className="flex flex-wrap items-center gap-2">
                    <button type="button" data-testid="world-beats-preview" onClick={() => togglePlay(beat)} className="inline-flex items-center gap-1.5 rounded-full bg-[#d4af37] px-3 py-1.5 text-xs font-bold text-black transition hover:scale-105">
                      {playingId === beat.id ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                      {playingId === beat.id ? "Pause" : "Preview"}
                    </button>
                    <span className="min-w-0 flex-1">
                      <span className={`block truncate text-sm font-bold ${isLight ? "text-[#2a1e07]" : "text-white"}`}>{beat.title}</span>
                      <span className={`block text-[11px] ${muted}`}>
                        {beat.genre}{beat.bpm ? ` · ${beat.bpm} BPM` : ""}{beat.musicalKey ? ` · ${beat.musicalKey}` : ""}
                        {beat.moodTags.length ? ` · ${beat.moodTags.map((t) => `#${t}`).join(" ")}` : ""} · {beat.plays.toLocaleString("en-US")} plays
                      </span>
                    </span>
                    <span className="text-xs font-bold text-[#d4af37]">from {moneyCents(beat.basicPriceCents)}</span>
                    {isGuest ? null : (
                      <button type="button" data-testid="world-beats-license-open" onClick={() => { setLicenseBeat(licenseBeat?.id === beat.id ? null : beat); setOfferKey("basic"); setLicenseError(null); }} className={`rounded-full border px-3 py-1.5 text-xs font-bold transition ${isLight ? "border-[#7A5A12]/40 text-[#2a1e07]" : "border-white/20 text-white"}`}>
                        License
                      </button>
                    )}
                  </div>
                  {licenseBeat?.id === beat.id && !isGuest && (
                    <div className="mt-3 space-y-2" data-testid="world-beats-license-box">
                      {beatTierOffers(beat).map((offer) => (
                        <button key={offer.key} type="button" disabled={offer.soldOut} onClick={() => setOfferKey(offer.key)}
                          className={`w-full rounded-xl border p-3 text-left transition disabled:opacity-40 ${offerKey === offer.key ? "border-[#d4af37] bg-[#d4af37]/10" : isLight ? "border-[#7A5A12]/25" : "border-white/10"}`}>
                          <span className="flex items-center justify-between gap-2">
                            <span className={`text-sm font-bold ${isLight ? "text-[#2a1e07]" : "text-white"}`}>{offer.label}</span>
                            <span className="text-sm font-bold text-[#d4af37]">{offer.soldOut ? "Sold out" : moneyCents(offer.priceCents)}</span>
                          </span>
                          <span className={`block text-[11px] ${muted}`}>{offer.blurb}</span>
                          <span className={`block text-[11px] ${muted}`}>{offer.termsLine}</span>
                        </button>
                      ))}
                      {beat.licenseTemplates.length > 0 && (
                        <p className={`pt-1 text-[11px] font-black uppercase tracking-[0.14em] ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>Producer&rsquo;s custom licenses</p>
                      )}
                      {beat.licenseTemplates.map((tpl) => {
                        const offer = beatTemplateOffer(beat, tpl);
                        const key = `tpl:${tpl.id}`;
                        return (
                          <button key={tpl.id} type="button" disabled={offer.soldOut} onClick={() => setOfferKey(key)}
                            className={`w-full rounded-xl border p-3 text-left transition disabled:opacity-40 ${offerKey === key ? "border-[#d4af37] bg-[#d4af37]/10" : isLight ? "border-[#7A5A12]/25" : "border-white/10"}`}>
                            <span className="flex items-center justify-between gap-2">
                              <span className={`text-sm font-bold ${isLight ? "text-[#2a1e07]" : "text-white"}`}>{offer.name}</span>
                              <span className="text-sm font-bold text-[#d4af37]">{offer.soldOut ? "Sold out" : moneyCents(offer.priceCents)}</span>
                            </span>
                            <span className={`block text-[11px] ${muted}`}>{offer.termsLine}</span>
                          </button>
                        );
                      })}
                      <p className={`rounded-xl border border-yellow-500/25 bg-yellow-500/[0.06] p-3 text-[11px] ${isLight ? "text-[#92600a]" : "text-yellow-200/80"}`}>{BEATS_PAYMENT_NOTE}</p>
                      {licenseNote && <p className={`text-xs font-semibold ${isLight ? "text-emerald-700" : "text-emerald-300"}`}>{licenseNote}</p>}
                      {licenseError && <p className="text-xs font-semibold text-red-400">{licenseError}</p>}
                      <button type="button" data-testid="world-beats-license-buy" onClick={() => void reserveLicense()} disabled={licensing}
                        className="inline-flex w-full items-center justify-center gap-1.5 rounded-full bg-[#d4af37] px-4 py-2 text-xs font-bold text-black transition hover:scale-105 disabled:opacity-50">
                        {licensing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <BadgeDollarSign className="h-3.5 w-3.5" />}
                        {licensing ? "Reserving…" : "License this beat"}
                      </button>
                    </div>
                  )}
                </NativeCard>
              ))}
              {hasMore && (
                <button type="button" data-testid="world-beats-more" onClick={() => void loadBrowse(offset + BEATS_PAGE_SIZE, true)} className={`w-full rounded-full border px-4 py-2 text-xs font-bold ${isLight ? "border-[#7A5A12]/30 text-[#6B5B36]" : "border-white/15 text-white/75"}`}>
                  More beats
                </button>
              )}
            </div>
          )}

          {!isGuest && myLicenses !== null && myLicenses.length > 0 && (
            <NativeCard isLight={isLight} title="Your licenses">
              <div className="space-y-1.5">
                {myLicenses.map((lic) => (
                  <p key={lic.id} className={`flex flex-wrap items-baseline justify-between gap-2 text-xs ${isLight ? "text-[#2a1e07]" : "text-white/80"}`}>
                    <span className="font-bold capitalize">{lic.terms?.name ?? `${lic.tier} license`}</span>
                    <span className={muted}>{moneyCents(lic.priceCents)} · {beatSaleStatusLabel(lic.status)}</span>
                    {lic.terms && <span className={`block w-full text-[11px] ${muted}`}>{describeTermsInline(lic.terms)}</span>}
                  </p>
                ))}
              </div>
            </NativeCard>
          )}
        </>
      )}

      {tab === "sell" && (isGuest ? memberPitch("Listing a beat") : (
        <NativeCard isLight={isLight} title="List a beat — free">
          <div className="grid gap-2 sm:grid-cols-2">
            <input aria-label="Beat title" value={listingForm.title} onChange={(e) => setL({ title: e.target.value })} placeholder="Title" className={inputCls} />
            <input aria-label="Audio URL" value={listingForm.audioUrl} onChange={(e) => setL({ audioUrl: e.target.value })} placeholder="Audio URL" className={inputCls} />
            <select aria-label="Genre" value={listingForm.genre} onChange={(e) => setL({ genre: e.target.value })} className={inputCls}>
              {BEAT_GENRES.map((g) => <option key={g} value={g}>{g}</option>)}
            </select>
            <span className="flex gap-2">
              <input aria-label="BPM" value={listingForm.bpm} onChange={(e) => setL({ bpm: e.target.value })} placeholder="BPM" inputMode="numeric" className={inputCls} />
              <input aria-label="Musical key" value={listingForm.musicalKey} onChange={(e) => setL({ musicalKey: e.target.value })} placeholder="Key (e.g. F#m)" className={inputCls} />
            </span>
            <input aria-label="Mood tags" value={listingForm.moodTags} onChange={(e) => setL({ moodTags: e.target.value })} placeholder="Mood tags, comma separated" className={inputCls} />
            <input aria-label="Description" value={listingForm.description} onChange={(e) => setL({ description: e.target.value })} placeholder="Description (optional)" className={inputCls} />
            <span className="flex gap-2">
              <label className="flex-1"><span className={`text-[11px] ${muted}`}>Basic $</span><input aria-label="Basic price" value={listingForm.basicPrice} onChange={(e) => setL({ basicPrice: e.target.value })} inputMode="decimal" className={inputCls} /></label>
              <label className="flex-1"><span className={`text-[11px] ${muted}`}>Premium $</span><input aria-label="Premium price" value={listingForm.premiumPrice} onChange={(e) => setL({ premiumPrice: e.target.value })} inputMode="decimal" className={inputCls} /></label>
              <label className="flex-1"><span className={`text-[11px] ${muted}`}>Exclusive $</span><input aria-label="Exclusive price" value={listingForm.exclusivePrice} onChange={(e) => setL({ exclusivePrice: e.target.value })} inputMode="decimal" className={inputCls} /></label>
            </span>
          </div>
          {listNote && <p className={`mt-2 text-xs font-semibold ${isLight ? "text-emerald-700" : "text-emerald-300"}`}>{listNote}</p>}
          {listError && <p className="mt-2 text-xs font-semibold text-red-400">{listError}</p>}
          <button type="button" data-testid="world-beats-list-submit" onClick={() => void submitListing()} disabled={listing}
            className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-[#d4af37] px-4 py-2 text-xs font-bold text-black transition hover:scale-105 disabled:opacity-50">
            {listing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Disc3 className="h-3.5 w-3.5" />}
            {listing ? "Listing…" : "List this beat"}
          </button>
        </NativeCard>
      ))}

      {tab === "dashboard" && (isGuest ? memberPitch("The seller dashboard") : dashFailed ? (
        <NativeErrorState isLight={isLight} title="Your dashboard wouldn't open" message="Your beats and sales are safe — the dashboard just couldn't load them. Try again." onRetry={() => void loadDashboard()} />
      ) : dashboard === null ? (
        <NativeLoadingState isLight={isLight} message="Opening your seller dashboard…" />
      ) : (
        <>
          {dashboard.stats && (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" data-testid="world-beats-dash-stats">
              {[
                { label: "Beats listed", value: String(dashboard.stats.beatCount) },
                { label: "Licenses sold", value: String(dashboard.stats.saleCount) },
                { label: "Gross", value: moneyCents(dashboard.stats.grossCents) },
                { label: "Your cut (after 15%)", value: moneyCents(dashboard.stats.netCents) },
              ].map((s) => (
                <NativeCard key={s.label} isLight={isLight}>
                  <p className="text-center text-xl font-black text-[#d4af37]">{s.value}</p>
                  <p className={`text-center text-[11px] ${muted}`}>{s.label}</p>
                </NativeCard>
              ))}
            </div>
          )}
          <NativeCard isLight={isLight} title="Your beats">
            {dashboard.beats.length === 0 ? (
              <p className={`text-xs ${muted}`}>No beats listed yet — the Sell tab puts your first one up, free.</p>
            ) : dashboard.beats.map((b) => (
              <p key={b.id} className={`flex items-baseline justify-between gap-2 border-b py-1.5 text-xs last:border-0 ${isLight ? "border-[#7A5A12]/15 text-[#2a1e07]" : "border-white/10 text-white/80"}`}>
                <span className="font-bold">{b.title}</span>
                <span className={muted}>{b.genre} · {b.plays.toLocaleString("en-US")} plays</span>
              </p>
            ))}
          </NativeCard>
          <NativeCard isLight={isLight} title="Sales">
            {dashboard.sales.length === 0 ? (
              <p className={`text-xs ${muted}`}>No sales yet — they land here the moment a license sells.</p>
            ) : dashboard.sales.map((s) => (
              <div key={s.id} className={`border-b py-1.5 text-xs last:border-0 ${isLight ? "border-[#7A5A12]/15" : "border-white/10"}`}>
                <p className={`flex items-baseline justify-between gap-2 ${isLight ? "text-[#2a1e07]" : "text-white/80"}`}>
                  <span className="font-bold capitalize">{s.terms?.name ?? `${s.tier} license`}</span>
                  <span>{moneyCents(s.priceCents)}</span>
                  <span className={muted}>{beatSaleStatusLabel(s.status)}</span>
                </p>
                {s.terms && <p className={`mt-0.5 text-[11px] ${muted}`}>{describeTermsInline(s.terms)}</p>}
              </div>
            ))}
          </NativeCard>

          <NativeCard isLight={isLight} title="Your custom licenses">
            <p className={`text-[11px] ${muted}`}>Define named offers with your own price and terms — they appear on all your beats next to the fixed tiers. Editing or deleting changes future sales only; a sold license keeps its snapshot.</p>
            {templates === null ? (
              <p className={`mt-2 text-xs ${muted}`}>Reading your templates…</p>
            ) : templates.length === 0 && !tplForm ? (
              <p className={`mt-2 text-xs ${muted}`}>No custom licenses yet.</p>
            ) : (
              <div className="mt-2 space-y-1.5">
                {templates.map((tpl) => (
                  <div key={tpl.id} className={`flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2 text-xs ${isLight ? "border-[#7A5A12]/25 text-[#2a1e07]" : "border-white/10 text-white/80"}`}>
                    <span className="min-w-0 flex-1">
                      <span className="block font-bold">{tpl.name} · {moneyCents(tpl.priceCents)}</span>
                      <span className={`block text-[11px] ${muted}`}>{describeTermsInline(templateTerms(tpl))}</span>
                    </span>
                    <button type="button" data-testid="world-beats-template-edit" onClick={() => { setTplEditingId(tpl.id); setTplForm(beatTemplateFormFromDto(tpl)); setTplError(null); }} className={`rounded-full border px-2.5 py-1 text-[11px] font-bold ${isLight ? "border-[#7A5A12]/30" : "border-white/15"}`}>
                      <Pencil className="mr-1 inline h-3 w-3" /> Edit
                    </button>
                    {confirmingDeleteTpl === tpl.id ? (
                      <>
                        <button type="button" data-testid="world-beats-template-delete-confirm" onClick={() => void deleteTemplate(tpl.id)} className="rounded-full border border-red-400/50 bg-red-400/10 px-2.5 py-1 text-[11px] font-bold text-red-300">Delete?</button>
                        <button type="button" onClick={() => setConfirmingDeleteTpl(null)} className={`rounded-full border px-2.5 py-1 text-[11px] font-bold ${isLight ? "border-[#7A5A12]/30" : "border-white/15"}`}>Keep</button>
                      </>
                    ) : (
                      <button type="button" data-testid="world-beats-template-delete" onClick={() => setConfirmingDeleteTpl(tpl.id)} className="rounded-full border border-red-400/40 px-2.5 py-1 text-[11px] font-bold text-red-300">
                        <Trash2 className="mr-1 inline h-3 w-3" /> Delete
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
            {tplForm ? (
              <div className="mt-3 space-y-2" data-testid="world-beats-template-form">
                <div className="grid gap-2 sm:grid-cols-2">
                  <input aria-label="Template name" value={tplForm.name} onChange={(e) => setT({ name: e.target.value })} placeholder="Name (e.g. Lease Plus)" className={inputCls} />
                  <input aria-label="Template price" value={tplForm.priceDollars} onChange={(e) => setT({ priceDollars: e.target.value })} placeholder="Price $" inputMode="decimal" className={inputCls} />
                  <select aria-label="Format" value={tplForm.format} onChange={(e) => setT({ format: e.target.value })} className={inputCls}>
                    {BEAT_LICENSE_FORMATS.map((f) => <option key={f} value={f}>{f}</option>)}
                  </select>
                  <input aria-label="Territory" value={tplForm.territory} onChange={(e) => setT({ territory: e.target.value })} placeholder="Territory" className={inputCls} />
                  <input aria-label="Streams cap" value={tplForm.streamsCap} onChange={(e) => setT({ streamsCap: e.target.value })} placeholder="Streams cap (blank = unlimited)" inputMode="numeric" className={inputCls} />
                  <input aria-label="Sales cap" value={tplForm.salesCap} onChange={(e) => setT({ salesCap: e.target.value })} placeholder="Sales cap (blank = unlimited)" inputMode="numeric" className={inputCls} />
                  <input aria-label="Music videos cap" value={tplForm.musicVideosCap} onChange={(e) => setT({ musicVideosCap: e.target.value })} placeholder="Music videos cap" inputMode="numeric" className={inputCls} />
                  <input aria-label="Live performances cap" value={tplForm.livePerformancesCap} onChange={(e) => setT({ livePerformancesCap: e.target.value })} placeholder="Live performances cap" inputMode="numeric" className={inputCls} />
                  <input aria-label="Term years" value={tplForm.termYears} onChange={(e) => setT({ termYears: e.target.value })} placeholder="Term years (blank = no fixed term)" inputMode="numeric" className={inputCls} />
                  <input aria-label="Credit line" value={tplForm.creditLine} onChange={(e) => setT({ creditLine: e.target.value })} placeholder="Credit line (optional)" className={inputCls} />
                </div>
                <input aria-label="Terms note" value={tplForm.termsNote} onChange={(e) => setT({ termsNote: e.target.value })} placeholder="Terms note (optional)" className={inputCls} />
                <div className="flex flex-wrap gap-3 text-xs">
                  <label className={`inline-flex items-center gap-1.5 ${isLight ? "text-[#2a1e07]" : "text-white/80"}`}>
                    <input type="checkbox" checked={tplForm.radioTvAllowed} onChange={(e) => setT({ radioTvAllowed: e.target.checked })} /> Radio/TV allowed
                  </label>
                  <label className={`inline-flex items-center gap-1.5 ${isLight ? "text-[#2a1e07]" : "text-white/80"}`}>
                    <input type="checkbox" checked={tplForm.isExclusive} onChange={(e) => setT({ isExclusive: e.target.checked })} /> Exclusive offer
                  </label>
                </div>
                {tplError && <p className="text-xs font-semibold text-red-400">{tplError}</p>}
                <div className="flex flex-wrap gap-1.5">
                  <button type="button" data-testid="world-beats-template-save" onClick={() => void saveTemplate()} disabled={tplSaving} className="inline-flex items-center gap-1.5 rounded-full bg-[#d4af37] px-3.5 py-1.5 text-xs font-bold text-black transition hover:scale-105 disabled:opacity-50">
                    {tplSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Save license
                  </button>
                  <button type="button" onClick={() => { setTplForm(null); setTplEditingId(null); }} className={`inline-flex items-center gap-1 rounded-full border px-3 py-1.5 text-xs font-bold ${isLight ? "border-[#7A5A12]/30 text-[#6B5B36]" : "border-white/15 text-white/75"}`}>
                    <X className="h-3 w-3" /> Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button type="button" data-testid="world-beats-template-new" onClick={() => { setTplEditingId(null); setTplForm(emptyBeatTemplateForm()); setTplError(null); }} className={`mt-2 inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold ${isLight ? "border-[#7A5A12]/40 text-[#2a1e07]" : "border-white/20 text-white"}`}>
                <Plus className="h-3.5 w-3.5" /> New custom license
              </button>
            )}
          </NativeCard>
        </>
      ))}
    </div>
  );
}

function isObjTitle(data: Record<string, unknown>): string {
  const beat = data["beat"];
  if (beat && typeof beat === "object") {
    const title = (beat as Record<string, unknown>)["title"];
    if (typeof title === "string" && title) return title;
  }
  return "Your beat";
}
