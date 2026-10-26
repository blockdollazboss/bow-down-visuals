import { useCallback, useEffect, useState } from "react";
import { Link } from "wouter";
import { Loader2, Repeat2, Hammer, Check, X, Coins, Upload } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/contexts/AuthContext";
import { useIsLightTheme } from "@/hooks/use-is-light-theme";
import {
  buildProposedSplits,
  loopMetaLine,
  parseLoopDetailResponse,
  parseLoopsResponse,
  parseMineResponse,
  parseSaleResponse,
  termsLine,
  LOOP_BUILD_STATUS_LABELS,
  LOOP_ROLE_LABELS,
  type LoopExchangeBuild,
  type LoopExchangeLoop,
  type LoopExchangeMine,
  type LoopExchangeSaleResult,
} from "@/lib/loop-exchange";

/* ─── Loop Exchange ──────────────────────────────────────────────────────
   Docked in the existing audio/sample surfaces: the Beats catalog
   browse tab (CREATE) and the Sounds page — never a standalone page.
   Post a loop or hook with YOUR terms up front (your share of every
   downstream sale's net). Another creator builds on it and proposes the
   build's full splits on the existing splits rail; you accept or
   decline; only an agreed build can sell, and you're credited and paid
   per the agreed split on EVERY downstream sale of that build.
   Money is TEST MODE Visual Bucs only — never cash. Split payments land
   as exactly-once ledger rows server-side; this panel never computes a
   share, a fee, or an earning — it renders what the API returns. */

interface CollabRow { userId: string; sharePct: string }

export default function LoopExchangePanel() {
  const { t } = useTranslation();
  const isLight = useIsLightTheme();
  const { user, getAccessToken } = useAuth();

  const [loops, setLoops] = useState<LoopExchangeLoop[]>([]);
  const [mine, setMine] = useState<LoopExchangeMine | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  /* post-a-loop form */
  const [postTitle, setPostTitle] = useState("");
  const [postAudio, setPostAudio] = useState("");
  const [postDesc, setPostDesc] = useState("");
  const [postBpm, setPostBpm] = useState("");
  const [postKey, setPostKey] = useState("");
  const [postShare, setPostShare] = useState("25");

  /* selected loop detail + build proposal */
  const [selected, setSelected] = useState<{ loop: LoopExchangeLoop; builds: LoopExchangeBuild[] } | null>(null);
  const [buildTitle, setBuildTitle] = useState("");
  const [buildAudio, setBuildAudio] = useState("");
  const [buildPosterShare, setBuildPosterShare] = useState("");
  const [collabs, setCollabs] = useState<CollabRow[]>([]);

  /* record-a-sale form, keyed by build id */
  const [saleRef, setSaleRef] = useState("");
  const [saleGross, setSaleGross] = useState("");
  const [lastSale, setLastSale] = useState<LoopExchangeSaleResult | null>(null);

  const authHeaders = useCallback(async (): Promise<HeadersInit> => {
    const token = await getAccessToken().catch(() => null);
    return token ? { Authorization: `Bearer ${token}` } : {};
  }, [getAccessToken]);

  const reload = useCallback(async () => {
    try {
      const [loopsRes, mineRes] = await Promise.all([
        fetch("/api/loop-exchange/loops"),
        user ? fetch("/api/loop-exchange/mine", { headers: await authHeaders() }) : Promise.resolve(null),
      ]);
      if (loopsRes.ok) {
        const parsed = parseLoopsResponse(await loopsRes.json().catch(() => null));
        if (parsed) setLoops(parsed);
      }
      if (mineRes && mineRes.ok) {
        const parsed = parseMineResponse(await mineRes.json().catch(() => null));
        if (parsed) setMine(parsed);
      }
    } catch { /* lists stay as they are; actions surface their own errors */ }
    finally { setLoading(false); }
  }, [user, authHeaders]);

  useEffect(() => { void reload(); }, [reload]);

  async function callApi(path: string, method: string, body?: unknown): Promise<{ ok: boolean; status: number; data: unknown }> {
    const res = await fetch(path, {
      method,
      headers: { "Content-Type": "application/json", ...(await authHeaders()) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const data: unknown = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, data };
  }

  function surfaceError(data: unknown, fallback: string) {
    const msg = (data as { error?: string }).error;
    setError(msg || fallback);
  }

  async function postLoop() {
    if (busy) return;
    setError(null); setNotice(null);
    const share = Number(postShare);
    if (!postTitle.trim() || !postAudio.trim() || !Number.isFinite(share)) {
      setError(t("loopExchange.errorPost", { defaultValue: "Give your loop a title, its audio link, and your share — the percent of every downstream sale's net that goes to you." }));
      return;
    }
    setBusy("post");
    try {
      const bpm = Number.parseInt(postBpm, 10);
      const { ok, data } = await callApi("/api/loop-exchange/loops", "POST", {
        title: postTitle.trim(),
        audioUrl: postAudio.trim(),
        ...(postDesc.trim() ? { description: postDesc.trim() } : {}),
        ...(Number.isFinite(bpm) ? { bpm } : {}),
        ...(postKey.trim() ? { musicalKey: postKey.trim() } : {}),
        posterSharePct: share,
      });
      if (!ok) { surfaceError(data, t("loopExchange.errorGeneric", { defaultValue: "The Loop Exchange hit a snag. Please try again." })); return; }
      setPostTitle(""); setPostAudio(""); setPostDesc(""); setPostBpm(""); setPostKey("");
      setNotice(t("loopExchange.posted", { defaultValue: "Your loop is posted — builders can now propose splits on your terms." }));
      await reload();
    } catch {
      setError(t("loopExchange.errorGeneric", { defaultValue: "The Loop Exchange hit a snag. Please try again." }));
    } finally { setBusy(null); }
  }

  async function openLoop(loop: LoopExchangeLoop) {
    setError(null);
    try {
      const res = await fetch(`/api/loop-exchange/loops/${loop.id}`);
      const parsed = parseLoopDetailResponse(await res.json().catch(() => null));
      if (!res.ok || !parsed) { setError(t("loopExchange.errorGeneric", { defaultValue: "The Loop Exchange hit a snag. Please try again." })); return; }
      setSelected(parsed);
      setBuildPosterShare(String(parsed.loop.posterSharePct));
      setCollabs([]);
    } catch {
      setError(t("loopExchange.errorGeneric", { defaultValue: "The Loop Exchange hit a snag. Please try again." }));
    }
  }

  async function proposeBuild(loop: LoopExchangeLoop) {
    if (!user || busy) return;
    setError(null); setNotice(null);
    const posterShare = Number(buildPosterShare);
    if (!buildTitle.trim() || !Number.isFinite(posterShare)) {
      setError(t("loopExchange.errorBuild", { defaultValue: "Give your build a title and the poster's share (at least their posted terms)." }));
      return;
    }
    const splits = buildProposedSplits({
      builderUserId: user.id,
      posterUserId: loop.posterUserId,
      posterSharePct: posterShare,
      collaborators: collabs
        .filter((c) => c.userId.trim())
        .map((c) => ({ userId: c.userId.trim(), sharePct: Number(c.sharePct) })),
    });
    if (!splits) {
      setError(t("loopExchange.errorSplits", { defaultValue: "Those splits don't add up — shares must total 100%, the poster keeps at least their posted terms, and you keep a share too." }));
      return;
    }
    setBusy("build");
    try {
      const { ok, data } = await callApi(`/api/loop-exchange/loops/${loop.id}/builds`, "POST", {
        title: buildTitle.trim(),
        ...(buildAudio.trim() ? { audioUrl: buildAudio.trim() } : {}),
        splits,
      });
      if (!ok) { surfaceError(data, t("loopExchange.errorGeneric", { defaultValue: "The Loop Exchange hit a snag. Please try again." })); return; }
      setBuildTitle(""); setBuildAudio("");
      setNotice(t("loopExchange.buildSent", { defaultValue: "Your build's terms are with the loop's poster — nothing sells until they accept." }));
      await openLoop(loop);
      await reload();
    } catch {
      setError(t("loopExchange.errorGeneric", { defaultValue: "The Loop Exchange hit a snag. Please try again." }));
    } finally { setBusy(null); }
  }

  async function decide(build: LoopExchangeBuild, decision: "agreed" | "declined") {
    if (busy) return;
    setError(null); setNotice(null);
    setBusy(`decide-${build.id}`);
    try {
      const { ok, data } = await callApi(`/api/loop-exchange/builds/${build.id}/decision`, "POST", { decision });
      if (!ok) { surfaceError(data, t("loopExchange.errorGeneric", { defaultValue: "The Loop Exchange hit a snag. Please try again." })); return; }
      setNotice(decision === "agreed"
        ? t("loopExchange.agreed", { defaultValue: "Terms agreed — this build can now sell, and every sale pays out on these splits." })
        : t("loopExchange.declined", { defaultValue: "Terms declined." }));
      if (selected) await openLoop(selected.loop);
      await reload();
    } catch {
      setError(t("loopExchange.errorGeneric", { defaultValue: "The Loop Exchange hit a snag. Please try again." }));
    } finally { setBusy(null); }
  }

  async function recordSale(build: LoopExchangeBuild) {
    if (busy) return;
    setError(null); setNotice(null);
    const gross = Number(saleGross);
    if (!saleRef.trim() || !Number.isInteger(gross) || gross <= 0) {
      setError(t("loopExchange.errorSale", { defaultValue: "A downstream sale needs its sale reference and its price in whole Visual Bucs." }));
      return;
    }
    setBusy(`sale-${build.id}`);
    try {
      const { ok, data } = await callApi(`/api/loop-exchange/builds/${build.id}/sales`, "POST", {
        saleRef: saleRef.trim(),
        grossVb: gross,
      });
      const parsed = parseSaleResponse(data);
      if (!ok || !parsed) { surfaceError(data, t("loopExchange.errorGeneric", { defaultValue: "The Loop Exchange hit a snag. Please try again." })); return; }
      setLastSale(parsed);
      setNotice(parsed.outcome === "recorded"
        ? t("loopExchange.saleRecorded", { defaultValue: "Sale recorded — every split share was paid exactly once." })
        : t("loopExchange.saleAlready", { defaultValue: "That sale was already recorded — nobody was paid twice." }));
      setSaleRef(""); setSaleGross("");
      await reload();
    } catch {
      setError(t("loopExchange.errorGeneric", { defaultValue: "The Loop Exchange hit a snag. Please try again." }));
    } finally { setBusy(null); }
  }

  const panelCls = isLight
    ? "rounded-3xl border border-[#C9A84C]/40 bg-gradient-to-b from-[#FCF7EA] to-[#F4E7C3] p-6"
    : "rounded-3xl border border-primary/25 bg-gradient-to-b from-[#14100a] to-[#0d0a04] p-6";
  const cardCls = "rounded-2xl border border-white/10 bg-black/30 p-4";
  const inputCls = "rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-white placeholder:text-white/30 outline-none focus:border-primary/50";
  const myUserId = user?.id ?? null;

  const buildCard = (build: LoopExchangeBuild, loop: LoopExchangeLoop) => (
    <div key={build.id} className={cardCls}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-bold">{build.title}</p>
          <p className="text-xs text-white/45">{LOOP_BUILD_STATUS_LABELS[build.status]}</p>
        </div>
        <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold ${build.status === "agreed" ? "bg-emerald-400/15 text-emerald-300" : build.status === "declined" ? "bg-red-400/15 text-red-300" : "bg-amber-400/15 text-amber-200"}`}>
          {build.status}
        </span>
      </div>
      <ul className="mt-2 space-y-0.5 text-[13px] text-white/65">
        {build.splits.map((s) => (
          <li key={s.userId}>
            {s.userId === loop.posterUserId ? t("loopExchange.rolePoster", { defaultValue: "Original poster" })
              : s.userId === build.builderUserId ? t("loopExchange.roleBuilder", { defaultValue: "Builder" })
              : t("loopExchange.roleCollab", { defaultValue: "Collaborator" })}
            {" — "}{s.sharePct}%
          </li>
        ))}
      </ul>
      {build.audioUrl && <audio controls src={build.audioUrl} className="mt-3 w-full" preload="none" />}

      {loop.posterUserId === myUserId && build.status === "pending_terms" && (
        <div className="mt-3 flex gap-2">
          <button type="button" disabled={busy !== null} onClick={() => void decide(build, "agreed")}
            className="inline-flex items-center gap-1 rounded-full bg-primary px-3.5 py-1.5 text-xs font-bold text-black hover:brightness-110 disabled:opacity-50">
            <Check className="h-3.5 w-3.5" /> {t("loopExchange.acceptTerms", { defaultValue: "Accept these terms" })}
          </button>
          <button type="button" disabled={busy !== null} onClick={() => void decide(build, "declined")}
            className="inline-flex items-center gap-1 rounded-full border border-white/15 px-3.5 py-1.5 text-xs font-semibold text-white/75 hover:border-red-400/40 disabled:opacity-50">
            <X className="h-3.5 w-3.5" /> {t("loopExchange.declineTerms", { defaultValue: "Decline" })}
          </button>
        </div>
      )}

      {build.builderUserId === myUserId && build.status === "agreed" && (
        <div className="mt-3 rounded-xl border border-white/10 bg-black/20 p-3">
          <p className="text-[11px] font-bold uppercase tracking-widest text-white/40">
            {t("loopExchange.recordSaleTitle", { defaultValue: "Record a downstream sale (test mode — Visual Bucs)" })}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <input value={saleRef} onChange={(e) => setSaleRef(e.target.value)} placeholder={t("loopExchange.saleRefPlaceholder", { defaultValue: "Sale reference" })} aria-label={t("loopExchange.saleRefPlaceholder", { defaultValue: "Sale reference" })} className={`${inputCls} w-44`} />
            <input value={saleGross} onChange={(e) => setSaleGross(e.target.value)} inputMode="numeric" placeholder={t("loopExchange.saleGrossPlaceholder", { defaultValue: "Price in Visual Bucs" })} aria-label={t("loopExchange.saleGrossPlaceholder", { defaultValue: "Price in Visual Bucs" })} className={`${inputCls} w-40`} />
            <button type="button" disabled={busy !== null} onClick={() => void recordSale(build)}
              className="inline-flex items-center gap-1 rounded-full bg-primary px-3.5 py-1.5 text-xs font-bold text-black hover:brightness-110 disabled:opacity-50">
              <Coins className="h-3.5 w-3.5" /> {t("loopExchange.recordSale", { defaultValue: "Record sale" })}
            </button>
          </div>
          <p className="mt-1.5 text-[11px] text-white/40">
            {t("loopExchange.saleOnceNote", { defaultValue: "The same sale reference can only ever pay once — replays are safe and pay nobody twice." })}
          </p>
        </div>
      )}
    </div>
  );

  return (
    <section className={panelCls} aria-label={t("loopExchange.title", { defaultValue: "Loop Exchange" })}>
      <h2 className="flex items-center gap-2 text-xl font-bold">
        <Repeat2 className="h-5 w-5 text-primary" />
        {t("loopExchange.title", { defaultValue: "Loop Exchange" })}
      </h2>
      <p className="mt-1 text-sm text-white/55">
        {t("loopExchange.intro", { defaultValue: "Post a loop or hook for other creators to build on. Your split terms are agreed up front — the original poster is credited and paid on every downstream sale of a build, at the share they posted. Test mode: Visual Bucs only, never cash." })}
      </p>

      {error && <p className="mt-3 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">{error}</p>}
      {notice && <p className="mt-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">{notice}</p>}

      {!user ? (
        <p className="mt-4 text-sm text-white/60">
          <Link href="/login" className="font-bold text-primary underline">{t("loopExchange.signIn", { defaultValue: "Sign in" })}</Link>{" "}
          {t("loopExchange.signInRest", { defaultValue: "to post a loop, build on one, or collect your split earnings." })}
        </p>
      ) : (
        <details className="mt-4">
          <summary className="inline-flex cursor-pointer items-center gap-2 rounded-full border border-primary/50 px-4 py-2 text-sm font-bold text-primary">
            <Upload className="h-4 w-4" /> {t("loopExchange.postLoop", { defaultValue: "Post a loop" })}
          </summary>
          <div className="mt-3 grid gap-2 md:grid-cols-2">
            <input value={postTitle} onChange={(e) => setPostTitle(e.target.value)} placeholder={t("loopExchange.loopTitlePlaceholder", { defaultValue: "Loop title" })} aria-label={t("loopExchange.loopTitlePlaceholder", { defaultValue: "Loop title" })} className={inputCls} />
            <input value={postAudio} onChange={(e) => setPostAudio(e.target.value)} placeholder={t("loopExchange.loopAudioPlaceholder", { defaultValue: "Audio link (URL)" })} aria-label={t("loopExchange.loopAudioPlaceholder", { defaultValue: "Audio link (URL)" })} className={inputCls} />
            <input value={postDesc} onChange={(e) => setPostDesc(e.target.value)} placeholder={t("loopExchange.loopDescPlaceholder", { defaultValue: "Description (optional)" })} aria-label={t("loopExchange.loopDescPlaceholder", { defaultValue: "Description (optional)" })} className={inputCls} />
            <div className="flex gap-2">
              <input value={postBpm} onChange={(e) => setPostBpm(e.target.value)} inputMode="numeric" placeholder="BPM" aria-label="BPM" className={`${inputCls} w-24`} />
              <input value={postKey} onChange={(e) => setPostKey(e.target.value)} placeholder={t("loopExchange.keyPlaceholder", { defaultValue: "Key — e.g. G minor" })} aria-label={t("loopExchange.keyPlaceholder", { defaultValue: "Key — e.g. G minor" })} className={`${inputCls} flex-1`} />
            </div>
            <label className="flex items-center gap-2 text-sm text-white/70">
              {t("loopExchange.myShare", { defaultValue: "My share of every downstream sale's net:" })}
              <input value={postShare} onChange={(e) => setPostShare(e.target.value)} inputMode="decimal" aria-label={t("loopExchange.myShare", { defaultValue: "My share of every downstream sale's net:" })} className={`${inputCls} w-20`} />
              %
            </label>
            <button type="button" disabled={busy !== null} onClick={() => void postLoop()}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-black text-black hover:brightness-110 disabled:opacity-50">
              {busy === "post" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              {t("loopExchange.postLoopButton", { defaultValue: "Post it on my terms" })}
            </button>
          </div>
        </details>
      )}

      <h3 className="mt-6 text-sm font-bold uppercase tracking-wider text-white/60">
        {t("loopExchange.openLoops", { defaultValue: "Open loops — build on one" })}
      </h3>
      {loading ? (
        <div className="mt-4 flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
      ) : loops.length === 0 ? (
        <p className="mt-3 text-sm text-white/50">{t("loopExchange.noLoops", { defaultValue: "No loops are posted yet — post the first one and set your terms." })}</p>
      ) : (
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          {loops.map((loop) => (
            <div key={loop.id} className={cardCls}>
              <p className="truncate font-bold">{loop.title}</p>
              {loopMetaLine(loop) && <p className="text-xs text-white/45">{loopMetaLine(loop)}</p>}
              {loop.description && <p className="mt-1 text-[13px] text-white/60">{loop.description}</p>}
              <p className="mt-2 text-xs font-semibold text-primary/90">{termsLine(loop)}</p>
              <audio controls src={loop.audioUrl} className="mt-3 w-full" preload="none" />
              <button type="button" onClick={() => void openLoop(loop)}
                className="mt-3 inline-flex items-center gap-1 rounded-full border border-white/15 px-3.5 py-1.5 text-xs font-semibold text-white/75 hover:border-primary/40">
                <Hammer className="h-3.5 w-3.5" />
                {loop.posterUserId === myUserId
                  ? t("loopExchange.viewBuilds", { defaultValue: "View builds & terms" })
                  : t("loopExchange.buildOnIt", { defaultValue: "Build on this loop" })}
              </button>
            </div>
          ))}
        </div>
      )}

      {selected && (
        <div className="mt-6">
          <h3 className="text-sm font-bold uppercase tracking-wider text-white/60">
            {selected.loop.title} — {t("loopExchange.buildsHeading", { defaultValue: "builds" })}
          </h3>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            {selected.builds.map((b) => buildCard(b, selected.loop))}
            {selected.builds.length === 0 && (
              <p className="text-sm text-white/50">{t("loopExchange.noBuilds", { defaultValue: "No builds yet on this loop." })}</p>
            )}
          </div>

          {user && selected.loop.posterUserId !== myUserId && selected.loop.status === "open" && (
            <div className="mt-4 rounded-2xl border border-white/10 bg-black/20 p-4">
              <p className="text-sm font-bold">{t("loopExchange.proposeTitle", { defaultValue: "Propose your build — splits agreed up front" })}</p>
              <p className="mt-1 text-xs text-white/45">{termsLine(selected.loop)}. {t("loopExchange.proposeNote", { defaultValue: "You can offer the poster more than their terms, never less. Your share is whatever remains." })}</p>
              <div className="mt-3 grid gap-2 md:grid-cols-2">
                <input value={buildTitle} onChange={(e) => setBuildTitle(e.target.value)} placeholder={t("loopExchange.buildTitlePlaceholder", { defaultValue: "Your build's title" })} aria-label={t("loopExchange.buildTitlePlaceholder", { defaultValue: "Your build's title" })} className={inputCls} />
                <input value={buildAudio} onChange={(e) => setBuildAudio(e.target.value)} placeholder={t("loopExchange.buildAudioPlaceholder", { defaultValue: "Build audio link (optional)" })} aria-label={t("loopExchange.buildAudioPlaceholder", { defaultValue: "Build audio link (optional)" })} className={inputCls} />
                <label className="flex items-center gap-2 text-sm text-white/70">
                  {t("loopExchange.posterGets", { defaultValue: "Poster gets:" })}
                  <input value={buildPosterShare} onChange={(e) => setBuildPosterShare(e.target.value)} inputMode="decimal" aria-label={t("loopExchange.posterGets", { defaultValue: "Poster gets:" })} className={`${inputCls} w-20`} />
                  %
                </label>
              </div>
              {collabs.map((c, i) => (
                <div key={i} className="mt-2 flex flex-wrap gap-2">
                  <input value={c.userId} onChange={(e) => setCollabs(collabs.map((x, j) => (j === i ? { ...x, userId: e.target.value } : x)))} placeholder={t("loopExchange.collabIdPlaceholder", { defaultValue: "Collaborator account id" })} aria-label={t("loopExchange.collabIdPlaceholder", { defaultValue: "Collaborator account id" })} className={`${inputCls} flex-1`} />
                  <input value={c.sharePct} onChange={(e) => setCollabs(collabs.map((x, j) => (j === i ? { ...x, sharePct: e.target.value } : x)))} inputMode="decimal" placeholder="%" aria-label={t("loopExchange.collabShare", { defaultValue: "Collaborator share %" })} className={`${inputCls} w-20`} />
                  <button type="button" onClick={() => setCollabs(collabs.filter((_, j) => j !== i))} className="rounded-full border border-white/15 px-3 py-1.5 text-xs text-white/60">
                    {t("loopExchange.removeCollab", { defaultValue: "Remove" })}
                  </button>
                </div>
              ))}
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" onClick={() => setCollabs([...collabs, { userId: "", sharePct: "" }])}
                  className="rounded-full border border-white/15 px-3.5 py-1.5 text-xs font-semibold text-white/75 hover:border-primary/40">
                  {t("loopExchange.addCollab", { defaultValue: "Add a collaborator" })}
                </button>
                <button type="button" disabled={busy !== null} onClick={() => void proposeBuild(selected.loop)}
                  className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-black text-black hover:brightness-110 disabled:opacity-50">
                  {busy === "build" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Hammer className="h-4 w-4" />}
                  {t("loopExchange.proposeButton", { defaultValue: "Send terms to the poster" })}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {lastSale && (
        <div className="mt-5 rounded-2xl border border-primary/25 bg-black/20 p-4">
          <p className="text-sm font-bold">
            {t("loopExchange.lastSaleTitle", { defaultValue: "Last recorded sale" })} — {lastSale.sale.grossVb} VB
            {" · "}{t("loopExchange.feeLine", { defaultValue: "platform fee" })} {lastSale.sale.feeVb} VB
            {" · "}{t("loopExchange.netLine", { defaultValue: "net split" })} {lastSale.sale.netVb} VB
          </p>
          <ul className="mt-2 space-y-0.5 text-[13px] text-white/65">
            {lastSale.allocations.map((a) => (
              <li key={a.userId}>{LOOP_ROLE_LABELS[a.role]} — {a.sharePct}% → {a.amountVb} VB</li>
            ))}
          </ul>
        </div>
      )}

      {user && mine && (mine.loops.length > 0 || mine.builds.length > 0 || mine.earnings.length > 0) && (
        <div className="mt-6">
          <h3 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-white/60">
            <Coins className="h-4 w-4 text-primary" />
            {t("loopExchange.mineHeading", { defaultValue: "My Loop Exchange" })}
          </h3>
          <p className="mt-2 text-sm text-white/70">
            {t("loopExchange.totalEarned", { defaultValue: "Total split earnings:" })}{" "}
            <span className="font-black text-primary">{mine.totalEarnedVb} VB</span>{" "}
            <span className="text-white/40">({t("loopExchange.testModeNote", { defaultValue: "test mode — Visual Bucs only, never cash" })})</span>
          </p>
          {mine.earnings.length > 0 && (
            <ul className="mt-2 space-y-1 text-[13px] text-white/65">
              {mine.earnings.slice(0, 10).map((e) => (
                <li key={e.id}>{LOOP_ROLE_LABELS[e.role]} — {e.sharePct}% → {e.amountVb} VB</li>
              ))}
            </ul>
          )}
          {mine.builds.length > 0 && (
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              {mine.builds.map((b) => {
                const loop = loops.find((l) => l.id === b.loopId) ?? mine.loops.find((l) => l.id === b.loopId);
                return loop ? buildCard(b, loop) : null;
              })}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
