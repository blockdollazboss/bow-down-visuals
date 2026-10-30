import { useCallback, useEffect, useState } from "react";
import { Link } from "wouter";
import { AlertTriangle, CheckCircle2, Flag, Loader2, ShieldAlert, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";

/* ─── Sample Clearance Lane (Stack-200 N2) ───────────────────────────
   Docked panels — NO standalone page:
   - SampleClearancePanel lives inside each song card on /songs:
     declare samples on your own track, see plain-words risk flags,
     get cleared-loop offers from the Beats Marketplace.
   - SampleClearanceShipCheck lives inside the release card on
     /distribute, next to the release checklist: the flags standing
     between this release and shipping, with the acknowledgement the
     submit gate asks for.

   Honesty: clearance is the creator's own statement — the UI always
   labels it "declared by you — not verified", never "verified".
   Declaring and acknowledging are free; nothing here charges. */

export interface DeclarationWire {
  id: string;
  songId: string;
  sourceDescription: string;
  useKind: string;
  clearanceStatus: string;
  clearanceLabel: string;
  recognizable: boolean;
  riskAcknowledged: boolean;
  flag: { level: "none" | "caution" | "high"; headline: string; reason: string; creatorStated: boolean };
  needsAcknowledgement: boolean;
}

interface AlternativeOffer {
  beatId: string;
  title: string;
  genre: string;
  bpm: number | null;
  musicalKey: string | null;
  href: string;
  matchBasis: string[];
  clearanceNote: string;
}

type TokenGetter = () => Promise<string | null>;
type AuthFetch = (path: string, init?: RequestInit) => Promise<Response>;

const USE_KIND_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "loop", label: "Loop — a piece of the source repeats through the track" },
  { value: "interpolation", label: "Interpolation — I re-performed the melody/lyric" },
  { value: "one_shot", label: "One-shot — a short hit or sound" },
  { value: "replay", label: "Replay — a section of the source plays as-is" },
  { value: "other", label: "Something else" },
];

const CLEARANCE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "licensed", label: "I have a license or clearance for it" },
  { value: "public_domain_or_original", label: "It's public domain, or my own original recording" },
  { value: "not_cleared", label: "I do not have a license or clearance" },
  { value: "unsure", label: "I'm not sure" },
];

function flagClasses(level: string, isLight: boolean): string {
  if (level === "high")
    return isLight ? "border-red-700/40 bg-red-50" : "border-red-500/40 bg-red-950/40";
  if (level === "caution")
    return isLight ? "border-amber-600/40 bg-amber-50" : "border-amber-500/40 bg-amber-950/30";
  return isLight ? "border-emerald-700/30 bg-emerald-50" : "border-emerald-500/30 bg-emerald-950/30";
}

function FlagBlock({ d, isLight }: { d: DeclarationWire; isLight: boolean }) {
  const Icon = d.flag.level === "none" ? CheckCircle2 : d.flag.level === "high" ? ShieldAlert : AlertTriangle;
  return (
    <div className={`rounded-xl border p-3 ${flagClasses(d.flag.level, isLight)}`}>
      <p className="flex items-start gap-2 text-sm font-semibold">
        <Icon className="mt-0.5 h-4 w-4 shrink-0" />
        <span>{d.flag.headline}</span>
      </p>
      <p className="mt-1 text-xs leading-relaxed opacity-80">{d.flag.reason}</p>
      <p className="mt-1 text-[11px] uppercase tracking-wider opacity-60">{d.clearanceLabel}</p>
    </div>
  );
}

export function SampleClearancePanel({
  songId,
  getAccessToken,
  isLight,
}: {
  songId: string;
  getAccessToken: TokenGetter;
  isLight: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [declarations, setDeclarations] = useState<DeclarationWire[]>([]);
  const [offers, setOffers] = useState<AlternativeOffer[]>([]);
  const [offersBasis, setOffersBasis] = useState("");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [source, setSource] = useState("");
  const [useKind, setUseKind] = useState("loop");
  const [clearanceStatus, setClearanceStatus] = useState("unsure");
  const [recognizable, setRecognizable] = useState(true);

  const authFetch = useCallback(
    async (path: string, init?: RequestInit): Promise<Response> => {
      const token = await getAccessToken();
      return fetch(path, {
        ...init,
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(init?.headers ?? {}) },
      });
    },
    [getAccessToken],
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [dRes, aRes] = await Promise.all([
        authFetch(`/api/sample-clearance/songs/${songId}/declarations`),
        authFetch(`/api/sample-clearance/songs/${songId}/alternatives`),
      ]);
      if (dRes.ok) {
        const data = (await dRes.json()) as { declarations?: DeclarationWire[] };
        setDeclarations(data.declarations ?? []);
      }
      if (aRes.ok) {
        const data = (await aRes.json()) as { offers?: AlternativeOffer[]; basedOn?: string };
        setOffers(data.offers ?? []);
        setOffersBasis(data.basedOn ?? "");
      }
    } catch {
      /* honest silence on the panel body; the toggle still opens */
    } finally {
      setLoading(false);
    }
  }, [authFetch, songId]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  async function declare() {
    if (busy || source.trim().length < 3) return;
    setBusy(true);
    setNote(null);
    try {
      const res = await authFetch(`/api/sample-clearance/songs/${songId}/declarations`, {
        method: "POST",
        body: JSON.stringify({ sourceDescription: source.trim(), useKind, clearanceStatus, recognizable }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Couldn't save that declaration.");
      setSource("");
      setNote({ ok: true, text: "Declared. This rides your track's credits as your statement." });
      await load();
    } catch (err) {
      setNote({ ok: false, text: err instanceof Error ? err.message : "Couldn't save that declaration." });
    } finally {
      setBusy(false);
    }
  }

  async function acknowledge(id: string) {
    setBusy(true);
    try {
      await authFetch(`/api/sample-clearance/declarations/${id}/acknowledge`, { method: "POST" });
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    setBusy(true);
    try {
      await authFetch(`/api/sample-clearance/declarations/${id}`, { method: "DELETE" });
      await load();
    } finally {
      setBusy(false);
    }
  }

  const flagged = declarations.filter((d) => d.flag.level !== "none");

  const inputClass = `w-full rounded-xl border px-3 py-2 text-sm outline-none ${
    isLight ? "border-[#C9A84C]/40 bg-white/70 text-[#2A2118] focus:border-[#C9A84C]" : "border-white/10 bg-black/40 text-white focus:border-white/25"
  }`;

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 text-xs font-semibold text-white/50 hover:text-primary transition-colors"
        aria-expanded={open}
      >
        <Flag className="h-3.5 w-3.5" />
        Samples{declarations.length > 0 ? ` (${declarations.length} declared)` : ""} — declare &amp; check clearance
      </button>

      {open && (
        <div className={`mt-2 rounded-xl border p-3 space-y-3 ${isLight ? "border-[#C9A84C]/40 bg-[#FCF7EA]" : "border-white/10 bg-black/30"}`}>
          <p className="text-xs leading-relaxed opacity-70">
            Used a sample? Declare it honestly. We flag the risk in plain words and offer cleared alternatives —
            your declaration rides the track's credits as <strong>your statement, not verified by us</strong>. Declaring is free.
          </p>

          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin opacity-50" />
          ) : declarations.length === 0 ? (
            <p className="text-xs opacity-60">No samples declared on this track yet. If the track is all original, there's nothing to declare.</p>
          ) : (
            <div className="space-y-2">
              {declarations.map((d) => (
                <div key={d.id} className="space-y-1.5">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-semibold">“{d.sourceDescription}”</p>
                    <button aria-label="Remove this declaration"
                      type="button"
                      onClick={() => void remove(d.id)}
                      disabled={busy}
                      className="shrink-0 opacity-50 hover:opacity-100 transition-opacity"
                      title="Remove this declaration"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <FlagBlock d={d} isLight={isLight} />
                  {d.needsAcknowledgement && (
                    <Button size="sm" variant="outline" disabled={busy} onClick={() => void acknowledge(d.id)} className="rounded-xl">
                      I've read this flag — ship anyway
                    </Button>
                  )}
                  {d.riskAcknowledged && d.flag.level !== "none" && (
                    <p className="text-[11px] opacity-60">You acknowledged this flag — recorded with the declaration.</p>
                  )}
                </div>
              ))}
            </div>
          )}

          <div className="space-y-2 border-t border-white/10 pt-3">
            <p className="text-xs font-bold uppercase tracking-wider opacity-70">Declare a sample</p>
            <input
              value={source}
              onChange={(e) => setSource(e.target.value)}
              placeholder="What did you sample? (artist / track / sound, in your words)"
              className={inputClass}
              maxLength={500}
            />
            <select value={useKind} onChange={(e) => setUseKind(e.target.value)} className={inputClass}>
              {USE_KIND_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            <select value={clearanceStatus} onChange={(e) => setClearanceStatus(e.target.value)} className={inputClass}>
              {CLEARANCE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            <label className="flex items-center gap-2 text-xs">
              <input type="checkbox" checked={recognizable} onChange={(e) => setRecognizable(e.target.checked)} />
              Listeners can recognize the source in my track
            </label>
            <Button size="sm" onClick={() => void declare()} disabled={busy || source.trim().length < 3} className="rounded-xl">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Declare this sample
            </Button>
            {note && <p className={`text-xs ${note.ok ? "text-emerald-400" : "text-red-400"}`}>{note.text}</p>}
          </div>

          {flagged.length > 0 && (
            <div className="space-y-2 border-t border-white/10 pt-3">
              <p className="text-xs font-bold uppercase tracking-wider opacity-70">Cleared-loop alternatives</p>
              {offersBasis && <p className="text-[11px] opacity-60">{offersBasis}</p>}
              {offers.length === 0 ? (
                <p className="text-xs opacity-60">No licensable beats in the catalog to offer right now — the Beats Marketplace is empty for this right now.</p>
              ) : (
                offers.map((o) => (
                  <div key={o.beatId} className={`rounded-xl border p-2.5 ${isLight ? "border-[#C9A84C]/30 bg-white/60" : "border-white/10 bg-black/40"}`}>
                    <p className="text-sm font-semibold">
                      {o.title} <span className="text-xs font-normal opacity-60">· {o.genre}{o.bpm ? ` · ${o.bpm} BPM` : ""}{o.musicalKey ? ` · ${o.musicalKey}` : ""}</span>
                    </p>
                    <p className="text-[11px] opacity-60">{o.matchBasis.join(" · ")}</p>
                    <p className="mt-0.5 text-[11px] opacity-60">{o.clearanceNote}</p>
                    <Link href={o.href} className="text-xs font-semibold text-primary hover:underline">Hear it in the Beats Marketplace →</Link>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function SampleClearanceShipCheck({
  releaseId,
  songId,
  authFetch,
  isLight,
}: {
  releaseId: string;
  songId: string | null;
  authFetch: AuthFetch;
  isLight: boolean;
}) {
  const [state, setState] = useState<{ blocking: DeclarationWire[]; warnings: DeclarationWire[]; unavailable: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await authFetch(`/api/sample-clearance/releases/${releaseId}/pre-ship`);
      if (!res.ok) return;
      const data = (await res.json()) as { blocking?: DeclarationWire[]; warnings?: DeclarationWire[]; checkUnavailable?: boolean };
      setState({ blocking: data.blocking ?? [], warnings: data.warnings ?? [], unavailable: Boolean(data.checkUnavailable) });
    } catch {
      /* the panel simply doesn't render until the check answers */
    }
  }, [authFetch, releaseId]);

  useEffect(() => {
    if (songId) void load();
  }, [songId, load]);

  if (!songId || !state) return null;
  if (state.blocking.length === 0 && state.warnings.length === 0 && !state.unavailable) {
    return (
      <p className="mt-3 flex items-center gap-2 text-xs opacity-70">
        <CheckCircle2 className="h-4 w-4 text-emerald-400" /> Sample clearance: no open risk flags on this track's declared samples.
      </p>
    );
  }

  async function acknowledge(id: string) {
    setBusy(true);
    try {
      await authFetch(`/api/sample-clearance/declarations/${id}/acknowledge`, { method: "POST" });
      await load();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-3 space-y-2">
      <p className="text-xs font-bold uppercase tracking-wider opacity-70">Sample clearance — before this ships</p>
      {state.unavailable && (
        <p className="text-xs opacity-60">The sample-clearance check couldn't run just now — declarations aren't switched on yet. Nothing is blocked by this panel.</p>
      )}
      {state.blocking.map((d) => (
        <div key={d.id} className="space-y-1.5">
          <FlagBlock d={d} isLight={isLight} />
          <Button size="sm" variant="outline" disabled={busy} onClick={() => void acknowledge(d.id)} className="rounded-xl">
            I've read this flag — ship anyway
          </Button>
        </div>
      ))}
      {state.warnings.map((d) => (
        <FlagBlock key={d.id} d={d} isLight={isLight} />
      ))}
      {state.blocking.length > 0 && (
        <p className="text-xs text-amber-400">Shipping pauses until you acknowledge each flag above — or fix the declaration on the track's Samples panel in your Songs library.</p>
      )}
    </div>
  );
}
