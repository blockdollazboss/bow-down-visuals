import { useEffect, useState } from "react";
import { Link } from "wouter";
import { Loader2, Layers, Search, FolderPlus, Check } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/contexts/AuthContext";
import { useHubProject } from "@/lib/hub-project";
import { useIsLightTheme } from "@/hooks/use-is-light-theme";
import {
  coverageLine, listedPrice, parseFitResponse, parseStackResponse, studioUrlFor,
  ROLE_LABELS, type SoundFitItem, type SoundFitResponse, type SoundFitSource,
  type SoundFitStackResponse,
} from "@/lib/sound-fit";

/* ─── Sound-Fit Discovery + Stack Builder ────────────────────────────────
   Docked in CREATE: the Audio Studio "sounds" (Sound Library) tab and
   the Beats catalog page — never a standalone page.
   Pick a source (one of your songs, a catalog beat, or the BPM + key
   you're working in) and get catalog sounds ranked by KEY + TEMPO + TAG
   fit, plus a one-click starter stack (drums + bass + melodic layers
   that mutually fit, on a fitting foundation).
   HONESTY: fit is metadata only — nothing listens to the audio. Sounds
   with no BPM or no readable key are UNANALYSED: they're excluded from
   results and the coverage line says how many ("6 of 10 sounds
   analysed"). A source song with no DJ analysis is refused with the
   way to analyse it — no key or score is ever invented here.
   Discovery is free; beat prices shown are exactly as listed. */

interface SourceOption { id: string; title: string; detail: string }

export default function SoundFitPanel() {
  const { t } = useTranslation();
  const isLight = useIsLightTheme();
  const { user, getAccessToken } = useAuth();
  const { addAsset } = useHubProject();

  const [mode, setMode] = useState<"song" | "beat" | "custom">("song");
  const [songs, setSongs] = useState<SourceOption[]>([]);
  const [beats, setBeats] = useState<SourceOption[]>([]);
  const [sourceId, setSourceId] = useState("");
  const [bpm, setBpm] = useState("140");
  const [musicalKey, setMusicalKey] = useState("Am");
  const [genre, setGenre] = useState("trap");

  const [fit, setFit] = useState<SoundFitResponse | null>(null);
  const [stack, setStack] = useState<SoundFitStackResponse | null>(null);
  const [loading, setLoading] = useState<"fit" | "stack" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const headers: HeadersInit = {};
        const token = await getAccessToken().catch(() => null);
        if (token) headers["Authorization"] = `Bearer ${token}`;
        const [djRes, beatsRes] = await Promise.all([
          fetch("/api/dj/library", { headers }),
          fetch("/api/beats?limit=48"),
        ]);
        if (cancelled) return;
        if (djRes.ok) {
          const dj = (await djRes.json()) as { tracks?: Array<{ id: string; title: string; analysis: { bpm: number | null; keyLabel: string | null } | null }> };
          setSongs((dj.tracks ?? []).map((tr) => ({
            id: tr.id, title: tr.title,
            detail: tr.analysis?.bpm != null ? `${tr.analysis.bpm} BPM · ${tr.analysis.keyLabel ?? "key unknown"}` : t("soundFit.noAnalysisYet", { defaultValue: "no DJ analysis yet" }),
          })));
        }
        if (beatsRes.ok) {
          const b = (await beatsRes.json()) as { beats?: Array<{ id: string; title: string; bpm: number | null; musical_key: string | null }> };
          setBeats((b.beats ?? []).map((x) => ({
            id: x.id, title: x.title,
            detail: x.bpm != null ? `${x.bpm} BPM · ${x.musical_key ?? "key not listed"}` : t("soundFit.noBpmListed", { defaultValue: "no BPM listed" }),
          })));
        }
      } catch { /* pickers just stay empty; errors surface on search */ }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function buildSource(): SoundFitSource | null {
    if (mode === "custom") {
      const n = Number.parseInt(bpm, 10);
      if (!Number.isFinite(n) || !musicalKey.trim()) {
        setError(t("soundFit.errorCustom", { defaultValue: "Enter the BPM and key you're working in." }));
        return null;
      }
      return { kind: "custom", bpm: n, musicalKey: musicalKey.trim(), genre: genre.trim() || undefined };
    }
    if (!sourceId) {
      setError(t("soundFit.errorPick", { defaultValue: "Pick a source sound first." }));
      return null;
    }
    return mode === "song" ? { kind: "song", id: sourceId } : { kind: "beat", id: sourceId };
  }

  async function call(path: "fit" | "stack") {
    const source = buildSource();
    if (!source || loading) return;
    setLoading(path);
    setError(null);
    try {
      const token = await getAccessToken().catch(() => null);
      const res = await fetch(`/api/sound-fit/${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ source }),
      });
      const data: unknown = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg = (data as { error?: string }).error;
        throw new Error(msg || t("soundFit.errorGeneric", { defaultValue: "Sound-fit hit a snag. Please try again." }));
      }
      if (path === "fit") {
        const parsed = parseFitResponse(data);
        if (!parsed) throw new Error(t("soundFit.errorGeneric", { defaultValue: "Sound-fit hit a snag. Please try again." }));
        setFit(parsed);
      } else {
        const parsed = parseStackResponse(data);
        if (!parsed) throw new Error(t("soundFit.errorGeneric", { defaultValue: "Sound-fit hit a snag. Please try again." }));
        setStack(parsed);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : t("soundFit.errorGeneric", { defaultValue: "Sound-fit hit a snag. Please try again." }));
    } finally {
      setLoading(null);
    }
  }

  function addToProject(item: SoundFitItem) {
    addAsset({
      kind: item.kind === "beat" ? "beat" : "song",
      url: item.audioUrl,
      label: item.title,
      meta: {
        ...(item.bpm != null ? { bpm: String(item.bpm) } : {}),
        ...(item.keyLabel ? { key: item.keyLabel } : {}),
        ...(item.genre ? { genre: item.genre } : {}),
      },
    });
    setAdded((prev) => new Set(prev).add(item.id));
  }

  const options = mode === "song" ? songs : beats;
  const panelCls = isLight
    ? "rounded-3xl border border-[#C9A84C]/40 bg-gradient-to-b from-[#FCF7EA] to-[#F4E7C3] p-6"
    : "rounded-3xl border border-primary/25 bg-gradient-to-b from-[#14100a] to-[#0d0a04] p-6";
  const inputCls = "rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-white placeholder:text-white/30 outline-none focus:border-primary/50";

  const itemCard = (item: SoundFitItem) => (
    <div key={item.id} className="rounded-2xl border border-white/10 bg-black/30 p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-bold">{item.title}</p>
          <p className="text-xs text-white/45">
            {item.kind === "beat" ? t("soundFit.kindBeat", { defaultValue: "Catalog beat" }) : t("soundFit.kindSong", { defaultValue: "Your song" })}
            {" · "}{item.bpm} BPM · {item.keyLabel ?? "—"} {item.camelot ? `· ${item.camelot}` : ""}
            {item.genre ? ` · ${item.genre}` : ""}
          </p>
        </div>
        <span className="shrink-0 rounded-full bg-primary/15 px-2.5 py-1 text-sm font-black text-primary">{item.fit.score}</span>
      </div>
      <p className="mt-1 text-[11px] text-white/40">
        {ROLE_LABELS[item.role.role]}
        {item.role.matchedTerm ? ` — ${t("soundFit.roleFromListing", { defaultValue: "read from its listing title/tags" })}` : ""}
      </p>
      <ul className="mt-2 space-y-0.5 text-[13px] text-white/65">
        {item.fit.reasons.map((r, i) => <li key={i}>{r}</li>)}
      </ul>
      {listedPrice(item) && <p className="mt-2 text-xs font-semibold text-primary/90">{listedPrice(item)}</p>}
      <audio controls src={item.audioUrl} className="mt-3 w-full" preload="none" />
      <div className="mt-3 flex flex-wrap gap-2">
        <Link href={studioUrlFor(item)} className="rounded-full bg-primary px-3.5 py-1.5 text-xs font-bold text-black hover:brightness-110">
          {t("soundFit.openInStudio", { defaultValue: "Open in Audio Studio" })}
        </Link>
        <button
          type="button"
          onClick={() => addToProject(item)}
          disabled={added.has(item.id)}
          className="inline-flex items-center gap-1 rounded-full border border-white/15 px-3.5 py-1.5 text-xs font-semibold text-white/75 hover:border-primary/40 disabled:opacity-50"
        >
          {added.has(item.id) ? <Check className="h-3.5 w-3.5" /> : <FolderPlus className="h-3.5 w-3.5" />}
          {added.has(item.id) ? t("soundFit.added", { defaultValue: "In your project" }) : t("soundFit.addToProject", { defaultValue: "Add to my project" })}
        </button>
        {item.kind === "beat" && (
          <Link href="/beats" className="rounded-full border border-white/15 px-3.5 py-1.5 text-xs font-semibold text-white/75 hover:border-primary/40">
            {t("soundFit.licenseOnBeats", { defaultValue: "License on Beats" })}
          </Link>
        )}
      </div>
    </div>
  );

  return (
    <section className={panelCls} aria-label={t("soundFit.title", { defaultValue: "Sounds that fit" })}>
      <h2 className="flex items-center gap-2 text-xl font-bold">
        <Layers className="h-5 w-5 text-primary" />
        {t("soundFit.title", { defaultValue: "Sounds that fit" })}
      </h2>
      <p className="mt-1 text-sm text-white/55">
        {t("soundFit.intro", { defaultValue: "Pick a song or loop and find catalog sounds in a compatible key and tempo — plus a one-click starter stack. Fit is read from listing + DJ-analysis metadata (key, tempo, tags); nothing listens to the audio, and sounds with no BPM or key are never guessed at." })}
      </p>
      <p className="mt-1 text-xs font-semibold text-primary/80">{t("soundFit.freeNote", { defaultValue: "Discovery is free. Beat prices are exactly as listed." })}</p>

      {!user ? (
        <p className="mt-4 text-sm text-white/60">
          <Link href="/login" className="font-bold text-primary underline">{t("soundFit.signIn", { defaultValue: "Sign in" })}</Link>{" "}
          {t("soundFit.signInRest", { defaultValue: "to search sounds that fit your songs." })}
        </p>
      ) : (
        <>
          <div className="mt-4 flex flex-wrap gap-2" role="tablist" aria-label={t("soundFit.sourceKind", { defaultValue: "Source kind" })}>
            {(["song", "beat", "custom"] as const).map((m) => (
              <button
                key={m} type="button" role="tab" aria-selected={mode === m}
                onClick={() => { setMode(m); setSourceId(""); }}
                className={`rounded-full px-3.5 py-1.5 text-xs font-bold ${mode === m ? "bg-primary text-black" : "border border-white/15 text-white/60 hover:text-white"}`}
              >
                {m === "song" ? t("soundFit.modeSong", { defaultValue: "My song" }) : m === "beat" ? t("soundFit.modeBeat", { defaultValue: "Catalog beat" }) : t("soundFit.modeCustom", { defaultValue: "BPM + key" })}
              </button>
            ))}
          </div>

          {mode === "custom" ? (
            <div className="mt-3 flex flex-wrap gap-2">
              <input value={bpm} onChange={(e) => setBpm(e.target.value)} inputMode="numeric" placeholder="BPM" aria-label="BPM" className={`${inputCls} w-24`} />
              <input value={musicalKey} onChange={(e) => setMusicalKey(e.target.value)} placeholder={t("soundFit.keyPlaceholder", { defaultValue: "Key — e.g. Am, F# maj" })} aria-label={t("soundFit.keyLabel", { defaultValue: "Musical key" })} className={`${inputCls} w-44`} />
              <input value={genre} onChange={(e) => setGenre(e.target.value)} placeholder={t("soundFit.genrePlaceholder", { defaultValue: "Genre — e.g. trap" })} aria-label="Genre" className={`${inputCls} w-36`} />
            </div>
          ) : (
            <select
              value={sourceId}
              onChange={(e) => setSourceId(e.target.value)}
              aria-label={t("soundFit.pickSource", { defaultValue: "Pick a source sound" })}
              className={`${inputCls} mt-3 w-full`}
            >
              <option value="">{t("soundFit.pickSource", { defaultValue: "Pick a source sound" })}…</option>
              {options.map((o) => <option key={o.id} value={o.id}>{o.title} — {o.detail}</option>)}
            </select>
          )}
          {mode === "song" && (
            <p className="mt-1.5 text-xs text-white/40">
              {t("soundFit.songNote", { defaultValue: "Songs need a DJ analysis first (free) — run it in Song Library → DJ Sets if yours has none." })}
            </p>
          )}

          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button" disabled={loading !== null} onClick={() => void call("fit")}
              className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-black text-black hover:brightness-110 disabled:opacity-50"
            >
              {loading === "fit" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              {t("soundFit.findButton", { defaultValue: "Find sounds that fit" })}
            </button>
            <button
              type="button" disabled={loading !== null} onClick={() => void call("stack")}
              className="inline-flex items-center gap-2 rounded-xl border border-primary/50 px-5 py-2.5 text-sm font-black text-primary hover:bg-primary hover:text-black disabled:opacity-50"
            >
              {loading === "stack" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Layers className="h-4 w-4" />}
              {t("soundFit.stackButton", { defaultValue: "Build a starter stack" })}
            </button>
          </div>

          {error && <p className="mt-3 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">{error}</p>}

          {(fit || stack) && (
            <p className="mt-4 text-xs text-white/45">
              {coverageLine((fit ?? stack)!.coverage)} — {t("soundFit.coverageRest", { defaultValue: "the rest are hidden from fit results, not guessed." })}{" "}
              {(fit ?? stack)!.method}
            </p>
          )}

          {fit && (
            fit.results.length === 0 ? (
              <p className="mt-4 text-sm text-white/50">{t("soundFit.noFits", { defaultValue: "No analysed sounds fit this yet — try another source, or check the coverage line above." })}</p>
            ) : (
              <div className="mt-4 grid gap-3 md:grid-cols-2">{fit.results.map(itemCard)}</div>
            )
          )}

          {stack && (
            <div className="mt-5">
              <h3 className="text-sm font-bold uppercase tracking-wider text-white/60">{t("soundFit.stackTitle", { defaultValue: "Your starter stack" })}</h3>
              {stack.stack.slots.length > 0 && (
                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  {stack.stack.slots.map((s) => (
                    <div key={s.item.id}>
                      <p className="mb-1 text-[11px] font-bold uppercase tracking-widest text-primary/80">{ROLE_LABELS[s.role]}</p>
                      {itemCard(s.item)}
                    </div>
                  ))}
                </div>
              )}
              {stack.stack.missing.map((m) => (
                <p key={m.role} className="mt-2 rounded-xl border border-amber-400/30 bg-amber-400/10 px-4 py-2.5 text-sm text-amber-200">
                  <span className="font-bold capitalize">{m.role}: </span>{m.reason}
                </p>
              ))}
              {stack.stack.fillSuggestion && (
                <p className="mt-3 text-sm text-white/60">
                  {t("soundFit.fillLead", { defaultValue: "Fill the missing layers with the Sample Pack Generator — set it to" })}{" "}
                  <span className="font-bold text-white">
                    {stack.stack.fillSuggestion.genre ?? ""} · {stack.stack.fillSuggestion.bpm} BPM · {t("soundFit.keyOf", { defaultValue: "key of" })} {stack.stack.fillSuggestion.musicalKey}
                  </span>{" "}
                  <Link href="/audio-studio?tab=aiaudio&sub=samples" className="font-bold text-primary underline">
                    {t("soundFit.fillLink", { defaultValue: "Open the Sample Pack Generator" })}
                  </Link>
                </p>
              )}
              {stack.stack.slots.length > 0 && (
                <button
                  type="button"
                  onClick={() => stack.stack.slots.forEach((s) => addToProject(s.item))}
                  className="mt-4 inline-flex items-center gap-2 rounded-full border border-primary/50 px-4 py-2 text-sm font-bold text-primary hover:bg-primary hover:text-black"
                >
                  <FolderPlus className="h-4 w-4" />
                  {t("soundFit.addStackToProject", { defaultValue: "Add the whole stack to my project" })}
                </button>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}
