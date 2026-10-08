import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import {
  Loader2, ShieldCheck, ShieldAlert, ShieldPlus, ShieldOff, Trash2,
  Plus, AlertTriangle, BadgeCheck, Clock3, CircleDollarSign,
  ChevronDown, ExternalLink, Info, CheckCircle2, XCircle,
} from "lucide-react";

/* Brand marks: lucide-react 1.x dropped brand icons, so this is a minimal
   hand-drawn YouTube mark (same pattern as analytics-hub.tsx). */
function YouTubeGlyph({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="#FF0000" strokeWidth="2" className={className} aria-hidden="true">
      <rect x="2.5" y="5.5" width="19" height="13" rx="4" />
      <path d="M10.5 9.8v4.4l4-2.2z" fill="#FF0000" stroke="none" />
    </svg>
  );
}

/* ─── Content ID Monitor — YouTube Content ID parity (DistroKid) ──────────
   Lives as a tab inside /analytics-hub. NO new page, NO new sidebar item.

   HONESTY: real YouTube Content ID claiming requires a distribution/CMS
   partnership we do NOT have. Every opt-in starts at "Pending partner" and
   the "File claim" action always fails with a clear message naming the
   missing partnership — a claim is NEVER faked.

   What IS real today:
   - opt tracks IN/OUT of monitoring (stored in content_id_optins)
   - manually-logged detected uses (stored in content_id_detections)
   - Content ID income logging, attributed to the Money Tracker (/coach)
     via POST /api/money with category "content_id_income"

   FREE — no credits, no external API calls. */

interface Optin {
  id: string;
  release_id: string | null;
  track_title: string;
  artist_name: string | null;
  opted_in: boolean;
  status: "pending_partner" | "active" | "paused" | "opted_out";
  opted_in_at: string;
  created_at: string;
}

interface Detection {
  id: string;
  optin_id: string | null;
  video_url: string;
  channel_name: string;
  status: "detected" | "claim_pending" | "claimed" | "disputed" | "released";
  notes: string;
  detected_at: string | null;
  created_at: string;
}

const PARTNER_NOTE =
  "Monitoring setup ready — actual Content ID claims activate when our distribution partner integration goes live.";

const inputClass =
  "w-full rounded-xl border border-white/10 bg-black/60 px-3.5 py-2.5 text-sm text-white placeholder:text-white/25 outline-none transition focus:border-primary/60 focus:ring-1 focus:ring-primary/40";
const labelClass = "mb-1.5 block text-[11px] font-bold uppercase tracking-widest text-white/40";
const goldBtn =
  "inline-flex items-center gap-2 rounded-xl bg-gradient-to-br from-[#f5d67b] via-primary to-[#8a6d1f] px-5 py-2.5 text-sm font-black text-black shadow-[0_4px_20px_rgba(212,175,55,0.35)] transition hover:scale-[1.02] active:scale-95 disabled:cursor-not-allowed disabled:opacity-50";
const ghostBtn =
  "inline-flex items-center gap-2 rounded-xl border border-white/15 px-4 py-2.5 text-sm font-semibold text-white/70 transition hover:border-white/30 hover:text-white disabled:opacity-50";

const DETECTION_STATUS_LABEL: Record<Detection["status"], string> = {
  detected: "Detected",
  claim_pending: "Claim pending",
  claimed: "Claimed",
  disputed: "Disputed",
  released: "Released",
};

function todayYmd(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

export default function ContentIdMonitor() {
  const { user, getAccessToken } = useAuth();

  const [optins, setOptins] = useState<Optin[]>([]);
  const [detections, setDetections] = useState<Detection[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /* opt-in form */
  const [title, setTitle] = useState("");
  const [artist, setArtist] = useState("");
  const [releaseId, setReleaseId] = useState("");
  const [optinSaving, setOptinSaving] = useState(false);
  const [optinError, setOptinError] = useState<string | null>(null);
  const [claimBusyId, setClaimBusyId] = useState<string | null>(null);
  const [claimError, setClaimError] = useState<string | null>(null);

  /* detection form */
  const [showDetForm, setShowDetForm] = useState(false);
  const [detOptinId, setDetOptinId] = useState("");
  const [detChannel, setDetChannel] = useState("");
  const [detUrl, setDetUrl] = useState("");
  const [detDate, setDetDate] = useState(todayYmd());
  const [detNotes, setDetNotes] = useState("");
  const [detSaving, setDetSaving] = useState(false);
  const [detError, setDetError] = useState<string | null>(null);

  /* revenue form */
  const [showRevForm, setShowRevForm] = useState(false);
  const [revAmount, setRevAmount] = useState("");
  const [revNote, setRevNote] = useState("");
  const [revSaving, setRevSaving] = useState(false);
  const [revError, setRevError] = useState<string | null>(null);
  const [revOk, setRevOk] = useState(false);

  const [showEdu, setShowEdu] = useState(false);

  const authed = useCallback(
    async (path: string, init?: RequestInit) => {
      const token = await getAccessToken();
      return fetch(path, {
        ...init,
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(init?.headers ?? {}),
        },
      });
    },
    [getAccessToken],
  );

  const load = useCallback(async () => {
    if (!user) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [oRes, dRes] = await Promise.all([
        authed("/api/content-id/optins"),
        authed("/api/content-id/detections"),
      ]);
      const oData = (await oRes.json().catch(() => ({}))) as { optins?: Optin[]; error?: string; message?: string };
      const dData = (await dRes.json().catch(() => ({}))) as { detections?: Detection[]; error?: string; message?: string };
      if (!oRes.ok) throw new Error(oData.message || oData.error || "Couldn't load your opt-ins.");
      if (!dRes.ok) throw new Error(dData.message || dData.error || "Couldn't load your detections.");
      setOptins(Array.isArray(oData.optins) ? oData.optins : []);
      setDetections(Array.isArray(dData.detections) ? dData.detections : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load the Content ID monitor.");
    } finally {
      setLoading(false);
    }
  }, [authed, user]);

  useEffect(() => {
    void load();
  }, [load]);

  /* Deep-link prefill from /distribute ("Protect with Content ID"):
     /analytics-hub?tab=content-id&title=…&artist=…&releaseId=… */
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const preTitle = params.get("title")?.trim().slice(0, 200);
      if (preTitle) setTitle(preTitle);
      const preArtist = params.get("artist")?.trim().slice(0, 200);
      if (preArtist) setArtist(preArtist);
      const preRelease = params.get("releaseId")?.trim();
      if (preRelease) setReleaseId(preRelease);
    } catch {
      /* ignore malformed URLs */
    }
  }, []);

  async function optInTrack(e: React.FormEvent) {
    e.preventDefault();
    if (!user || optinSaving) return;
    if (title.trim().length < 1) {
      setOptinError("Give the track a title first.");
      return;
    }
    setOptinSaving(true);
    setOptinError(null);
    try {
      const res = await authed("/api/content-id/optins", {
        method: "POST",
        body: JSON.stringify({
          track_title: title.trim(),
          artist_name: artist.trim() || null,
          release_id: releaseId.trim() || null,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { optin?: Optin; error?: string; message?: string };
      if (!res.ok || !data.optin) {
        throw new Error(data.message || data.error || "Couldn't opt the track in.");
      }
      setOptins((prev) => [data.optin!, ...prev]);
      setTitle("");
      setArtist("");
      setReleaseId("");
    } catch (err) {
      setOptinError(err instanceof Error ? err.message : "Couldn't opt the track in.");
    } finally {
      setOptinSaving(false);
    }
  }

  async function setOpted(o: Optin, optedIn: boolean) {
    if (!user) return;
    try {
      const res = await authed(`/api/content-id/optins/${o.id}`, {
        method: "PATCH",
        body: JSON.stringify({ opted_in: optedIn }),
      });
      const data = (await res.json().catch(() => ({}))) as { optin?: Optin; error?: string; message?: string };
      if (!res.ok || !data.optin) throw new Error(data.message || data.error || "Couldn't update the opt-in.");
      setOptins((prev) => prev.map((x) => (x.id === o.id ? data.optin! : x)));
    } catch (err) {
      setClaimError(err instanceof Error ? err.message : "Couldn't update the opt-in.");
    }
  }

  async function removeOptin(o: Optin) {
    if (!user) return;
    if (!window.confirm(`Remove "${o.track_title}" from the Content ID monitor?`)) return;
    try {
      const res = await authed(`/api/content-id/optins/${o.id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
        throw new Error(data.message || data.error || "Couldn't remove the opt-in.");
      }
      setOptins((prev) => prev.filter((x) => x.id !== o.id));
    } catch (err) {
      setClaimError(err instanceof Error ? err.message : "Couldn't remove the opt-in.");
    }
  }

  /* The honest claim action: always fails naming the missing partnership. */
  async function fileClaim(o: Optin) {
    if (!user || claimBusyId) return;
    setClaimBusyId(o.id);
    setClaimError(null);
    try {
      const res = await authed(`/api/content-id/claim/${o.id}`, { method: "POST" });
      const data = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
      // 409 is the EXPECTED honest outcome — surface it, never pretend success.
      setClaimError(data.message || data.error || "Claims can't be filed yet.");
    } catch (err) {
      setClaimError(err instanceof Error ? err.message : "Couldn't reach the claim endpoint.");
    } finally {
      setClaimBusyId(null);
    }
  }

  async function logDetection(e: React.FormEvent) {
    e.preventDefault();
    if (!user || detSaving) return;
    if (detChannel.trim().length < 1) {
      setDetError("Name the channel that used your music.");
      return;
    }
    setDetSaving(true);
    setDetError(null);
    try {
      const res = await authed("/api/content-id/detections", {
        method: "POST",
        body: JSON.stringify({
          optin_id: detOptinId || null,
          channel_name: detChannel.trim(),
          video_url: detUrl.trim(),
          notes: detNotes.trim(),
          detected_at: detDate || null,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { detection?: Detection; error?: string; message?: string };
      if (!res.ok || !data.detection) {
        throw new Error(data.message || data.error || "Couldn't log the detected use.");
      }
      setDetections((prev) => [data.detection!, ...prev]);
      setDetChannel("");
      setDetUrl("");
      setDetNotes("");
      setDetDate(todayYmd());
      setDetOptinId("");
      setShowDetForm(false);
    } catch (err) {
      setDetError(err instanceof Error ? err.message : "Couldn't log the detected use.");
    } finally {
      setDetSaving(false);
    }
  }

  async function cycleDetectionStatus(d: Detection) {
    const order: Detection["status"][] = ["detected", "claim_pending", "claimed", "disputed", "released"];
    const next = order[(order.indexOf(d.status) + 1) % order.length];
    try {
      const res = await authed(`/api/content-id/detections/${d.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: next }),
      });
      const data = (await res.json().catch(() => ({}))) as { detection?: Detection; error?: string; message?: string };
      if (!res.ok || !data.detection) throw new Error(data.message || data.error || "Couldn't update the detection.");
      setDetections((prev) => prev.map((x) => (x.id === d.id ? data.detection! : x)));
    } catch {
      /* non-fatal — list stays as-is */
    }
  }

  async function removeDetection(d: Detection) {
    if (!user) return;
    if (!window.confirm(`Delete the logged use on "${d.channel_name}"?`)) return;
    try {
      const res = await authed(`/api/content-id/detections/${d.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Couldn't delete the detection.");
      setDetections((prev) => prev.filter((x) => x.id !== d.id));
    } catch {
      /* non-fatal */
    }
  }

  /* Revenue attribution: posts straight into the Money Tracker ledger. */
  async function logRevenue(e: React.FormEvent) {
    e.preventDefault();
    if (!user || revSaving) return;
    const cents = Math.round(Number(revAmount) * 100);
    if (!Number.isFinite(cents) || cents < 1) {
      setRevError("Enter an amount greater than $0.");
      return;
    }
    setRevSaving(true);
    setRevError(null);
    setRevOk(false);
    try {
      const res = await authed("/api/money", {
        method: "POST",
        body: JSON.stringify({
          type: "income",
          category: "content_id_income",
          amountCents: cents,
          note: revNote.trim() || "Content ID revenue",
          source: "YouTube Content ID",
          date: todayYmd(),
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { entry?: unknown; error?: string; message?: string };
      if (!res.ok || !data.entry) {
        throw new Error(data.message || data.error || "Couldn't log the income.");
      }
      setRevAmount("");
      setRevNote("");
      setRevOk(true);
      setShowRevForm(false);
    } catch (err) {
      setRevError(err instanceof Error ? err.message : "Couldn't log the income.");
    } finally {
      setRevSaving(false);
    }
  }

  const optedInCount = useMemo(() => optins.filter((o) => o.opted_in).length, [optins]);
  const pendingCount = useMemo(
    () => optins.filter((o) => o.opted_in && o.status === "pending_partner").length,
    [optins],
  );

  if (!user) {
    return (
      <div className="relative mt-6 overflow-hidden rounded-3xl border border-primary/25 bg-gradient-to-b from-[#14100a] to-black p-10 text-center">
        <ShieldCheck className="mx-auto h-10 w-10 text-primary" aria-hidden="true" />
        <h2 className="mt-4 font-display text-2xl font-black">Content ID Monitor</h2>
        <p className="mx-auto mt-2 max-w-md text-sm text-white/55">
          Opt your tracks into YouTube Content ID monitoring, log detected uses, and attribute the revenue.
        </p>
        <Link
          href="/login"
          className="mt-6 inline-flex items-center gap-2 rounded-2xl bg-gradient-to-br from-[#f5d67b] via-primary to-[#8a6d1f] px-6 py-3 text-sm font-black text-black shadow-[0_4px_28px_rgba(212,175,55,0.4)] transition hover:scale-[1.03] active:scale-95"
        >
          Sign in to manage Content ID
        </Link>
      </div>
    );
  }

  return (
    <div className="relative mt-6 space-y-6">
      {/* ── HONESTY BANNER (always visible) ── */}
      <div className="overflow-hidden rounded-3xl border border-amber-500/30 bg-gradient-to-b from-[#171106] to-black p-6">
        <div className="flex items-start gap-3">
          <ShieldAlert className="mt-0.5 h-6 w-6 shrink-0 text-amber-400" aria-hidden="true" />
          <div>
            <h2 className="flex items-center gap-2 text-lg font-bold text-amber-200">
              <YouTubeGlyph />
              Content ID Monitor
              <span className="rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-[11px] font-bold text-emerald-300">FREE</span>
            </h2>
            <p className="mt-1.5 text-sm leading-relaxed text-white/65">{PARTNER_NOTE}</p>
            <p className="mt-1 text-xs text-white/40">
              Your opt-ins are saved and queued — the moment our distribution partner integration goes live,
              opted-in tracks activate automatically. Nothing is ever submitted to YouTube without that partnership.
            </p>
          </div>
        </div>
      </div>

      {/* ── EDUCATIONAL PANEL ── */}
      <div className="overflow-hidden rounded-3xl border border-primary/25 bg-gradient-to-b from-[#14100a] to-black">
        <button
          onClick={() => setShowEdu((v) => !v)}
          className="flex w-full items-center justify-between p-6 text-left"
          aria-expanded={showEdu}
        >
          <span className="flex items-center gap-2.5 font-bold">
            <Info className="h-5 w-5 text-primary" aria-hidden="true" />
            What is YouTube Content ID?
          </span>
          <ChevronDown className={`h-5 w-5 text-white/50 transition-transform ${showEdu ? "rotate-180" : ""}`} aria-hidden="true" />
        </button>
        {showEdu && (
          <div className="space-y-3 px-6 pb-6 text-sm leading-relaxed text-white/65">
            <p>
              <strong className="text-white">Content ID</strong> is YouTube's system for finding re-uploads of your
              music across the platform. When someone uses your song in their video, Content ID can{" "}
              <strong className="text-white">claim the video</strong> on your behalf — you choose to monetize it
              (earn ad revenue), track its stats, or take it down.
            </p>
            <ul className="list-disc space-y-1.5 pl-5">
              <li><strong className="text-white">Monetize:</strong> ads run on videos using your music and the revenue comes to you.</li>
              <li><strong className="text-white">Track:</strong> watch where your music spreads without touching the videos.</li>
              <li><strong className="text-white">Block:</strong> take down uploads you don't want out there.</li>
            </ul>
            <p>
              Opting in here registers your <em>intent</em> — your tracks are queued with the status{" "}
              <strong className="text-amber-300">"Pending partner"</strong>. Real claims start flowing the moment
              Bow Down Visuals' distribution partner integration goes live, with zero extra setup from you.
            </p>
          </div>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center rounded-3xl border border-primary/25 bg-gradient-to-b from-[#14100a] to-black p-16">
          <Loader2 className="h-8 w-8 animate-spin text-primary" aria-hidden="true" />
          <span className="sr-only">Loading Content ID monitor…</span>
        </div>
      ) : error ? (
        <div className="rounded-3xl border border-red-500/30 bg-red-500/[0.06] p-8 text-center">
          <AlertTriangle className="mx-auto h-8 w-8 text-red-400" aria-hidden="true" />
          <p className="mt-3 text-sm text-red-300">{error}</p>
          <button onClick={() => void load()} className={`${ghostBtn} mt-4`}>
            Try again
          </button>
        </div>
      ) : (
        <>
          {/* ── STATS ── */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="rounded-2xl border border-primary/25 bg-gradient-to-b from-[#14100a] to-black p-5">
              <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-white/40">
                <ShieldCheck className="h-3.5 w-3.5 text-primary" aria-hidden="true" /> Tracks opted in
              </p>
              <p className="mt-2 font-display text-4xl font-black text-white">{optedInCount}</p>
            </div>
            <div className="rounded-2xl border border-primary/25 bg-gradient-to-b from-[#14100a] to-black p-5">
              <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-white/40">
                <Clock3 className="h-3.5 w-3.5 text-primary" aria-hidden="true" /> Pending partner
              </p>
              <p className="mt-2 font-display text-4xl font-black text-amber-300">{pendingCount}</p>
            </div>
            <div className="rounded-2xl border border-primary/25 bg-gradient-to-b from-[#14100a] to-black p-5">
              <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-white/40">
                <BadgeCheck className="h-3.5 w-3.5 text-primary" aria-hidden="true" /> Detected uses
              </p>
              <p className="mt-2 font-display text-4xl font-black text-white">{detections.length}</p>
            </div>
          </div>

          {/* ── OPTED-IN TRACKS ── */}
          <div className="overflow-hidden rounded-3xl border border-primary/25 bg-gradient-to-b from-[#14100a] to-black p-6 md:p-8">
            <div className="flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-xl font-bold">
                <ShieldPlus className="h-5 w-5 text-primary" aria-hidden="true" />
                Your tracks
              </h2>
              <Link
                href="/distribute"
                className="inline-flex items-center gap-1 text-xs font-bold text-primary hover:underline"
              >
                Protect a release <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
              </Link>
            </div>

            {/* opt-in form */}
            <form onSubmit={optInTrack} className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1fr_auto]">
              <div>
                <label className={labelClass}>Track title</label>
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Midnight in Gold"
                  maxLength={200}
                  className={inputClass}
                />
              </div>
              <div>
                <label className={labelClass}>Artist name <span className="font-normal normal-case text-white/30">(optional)</span></label>
                <input
                  value={artist}
                  onChange={(e) => setArtist(e.target.value)}
                  placeholder="Your artist name"
                  maxLength={200}
                  className={inputClass}
                />
              </div>
              <div className="flex items-end">
                <button type="submit" disabled={optinSaving} className={goldBtn}>
                  {optinSaving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Plus className="h-4 w-4" aria-hidden="true" />}
                  Opt in · free
                </button>
              </div>
            </form>
            {optinError && (
              <p className="mt-3 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2.5 text-sm text-red-300">{optinError}</p>
            )}

            {/* opt-in list */}
            <div className="mt-6 space-y-2.5">
              {optins.length === 0 ? (
                <p className="rounded-2xl border border-dashed border-white/15 px-4 py-8 text-center text-sm text-white/40">
                  No tracks opted in yet — add your first one above. It costs nothing.
                </p>
              ) : (
                optins.map((o) => (
                  <div
                    key={o.id}
                    className={`flex flex-wrap items-center gap-3 rounded-2xl border p-4 ${
                      o.opted_in ? "border-white/10 bg-white/[0.03]" : "border-white/5 bg-black/40 opacity-60"
                    }`}
                  >
                    <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${o.opted_in ? "bg-primary/15 text-primary" : "bg-white/5 text-white/30"}`}>
                      {o.opted_in ? <ShieldCheck className="h-5 w-5" aria-hidden="true" /> : <ShieldOff className="h-5 w-5" aria-hidden="true" />}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-bold text-white">{o.track_title}</p>
                      <p className="flex flex-wrap items-center gap-1.5 text-xs text-white/40">
                        {o.artist_name && <span>{o.artist_name} ·</span>}
                        {o.opted_in ? (
                          <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 font-bold text-amber-300">
                            <Clock3 className="h-3 w-3" aria-hidden="true" /> Pending partner
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-full border border-white/15 bg-white/[0.04] px-2 py-0.5 font-bold text-white/50">
                            Opted out
                          </span>
                        )}
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5">
                      {o.opted_in && (
                        <button
                          onClick={() => void fileClaim(o)}
                          disabled={claimBusyId === o.id}
                          title="File a Content ID claim (requires the distribution partnership)"
                          className="inline-flex items-center gap-1 rounded-lg border border-primary/40 px-3 py-1.5 text-xs font-bold text-primary transition hover:bg-primary hover:text-black disabled:opacity-50"
                        >
                          {claimBusyId === o.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <BadgeCheck className="h-3.5 w-3.5" aria-hidden="true" />}
                          File claim
                        </button>
                      )}
                      <button
                        onClick={() => void setOpted(o, !o.opted_in)}
                        title={o.opted_in ? "Opt out" : "Opt back in"}
                        className="rounded-lg border border-white/15 px-3 py-1.5 text-xs font-bold text-white/70 transition hover:border-white/30 hover:text-white"
                      >
                        {o.opted_in ? "Opt out" : "Opt in"}
                      </button>
                      <button
                        onClick={() => void removeOptin(o)}
                        title="Remove"
                        className="rounded-lg border border-white/10 p-1.5 text-white/40 transition hover:border-red-500/40 hover:text-red-400"
                      >
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
            {claimError && (
              <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                <p>{claimError}</p>
              </div>
            )}
          </div>

          {/* ── DETECTED-USE LOG ── */}
          <div className="overflow-hidden rounded-3xl border border-primary/25 bg-gradient-to-b from-[#14100a] to-black p-6 md:p-8">
            <div className="flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-xl font-bold">
                <YouTubeGlyph />
                Detected uses
              </h2>
              <button onClick={() => { setShowDetForm((v) => !v); setDetError(null); }} className={ghostBtn}>
                <Plus className="h-4 w-4" aria-hidden="true" />
                Log a use
              </button>
            </div>
            <p className="mt-1.5 text-sm text-white/45">
              Spotted your music in someone's video? Log it here and track what happens next. Automated
              detection arrives with the distribution partnership.
            </p>

            {showDetForm && (
              <form onSubmit={logDetection} className="mt-5 rounded-2xl border border-primary/20 bg-black/50 p-4">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label className={labelClass}>Channel name</label>
                    <input value={detChannel} onChange={(e) => setDetChannel(e.target.value)} placeholder="Channel that used your music" maxLength={200} className={inputClass} />
                  </div>
                  <div>
                    <label className={labelClass}>Video URL <span className="font-normal normal-case text-white/30">(optional)</span></label>
                    <input value={detUrl} onChange={(e) => setDetUrl(e.target.value)} placeholder="https://youtube.com/watch?v=…" maxLength={500} className={inputClass} />
                  </div>
                  <div>
                    <label className={labelClass}>Your track</label>
                    <select value={detOptinId} onChange={(e) => setDetOptinId(e.target.value)} className={`${inputClass} appearance-none`}>
                      <option value="">— pick a track —</option>
                      {optins.filter((o) => o.opted_in).map((o) => (
                        <option key={o.id} value={o.id}>{o.track_title}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className={labelClass}>Date spotted</label>
                    <input type="date" value={detDate} onChange={(e) => setDetDate(e.target.value)} className={`${inputClass} [color-scheme:dark]`} />
                  </div>
                  <div className="sm:col-span-2">
                    <label className={labelClass}>Notes <span className="font-normal normal-case text-white/30">(optional)</span></label>
                    <textarea value={detNotes} onChange={(e) => setDetNotes(e.target.value)} placeholder="Timestamp, how much of the song, contact attempts…" rows={2} maxLength={1000} className={inputClass} />
                  </div>
                </div>
                {detError && (
                  <p className="mt-3 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2.5 text-sm text-red-300">{detError}</p>
                )}
                <div className="mt-4 flex gap-2">
                  <button type="submit" disabled={detSaving} className={goldBtn}>
                    {detSaving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <CheckCircle2 className="h-4 w-4" aria-hidden="true" />}
                    Log detected use
                  </button>
                  <button type="button" onClick={() => setShowDetForm(false)} className={ghostBtn}>Cancel</button>
                </div>
              </form>
            )}

            <div className="mt-5 space-y-2.5">
              {detections.length === 0 && !showDetForm ? (
                <p className="rounded-2xl border border-dashed border-white/15 px-4 py-8 text-center text-sm text-white/40">
                  Nothing logged yet. When you find your music in the wild, log it here.
                </p>
              ) : (
                detections.map((d) => {
                  const track = optins.find((o) => o.id === d.optin_id);
                  return (
                    <div key={d.id} className="flex flex-wrap items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-bold text-white">{d.channel_name}</p>
                        <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-white/40">
                          {track && <span>🎵 {track.track_title}</span>}
                          {d.detected_at && <span>{d.detected_at}</span>}
                          {d.video_url && (
                            <a href={d.video_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
                              Watch <ExternalLink className="h-3 w-3" aria-hidden="true" />
                            </a>
                          )}
                        </p>
                        {d.notes && <p className="mt-1 text-xs leading-relaxed text-white/55">{d.notes}</p>}
                      </div>
                      <button
                        onClick={() => void cycleDetectionStatus(d)}
                        title="Tap to advance status"
                        className="rounded-full border border-white/15 bg-white/[0.04] px-3 py-1.5 text-xs font-bold text-white/75 transition hover:border-primary/40 hover:text-white"
                      >
                        {DETECTION_STATUS_LABEL[d.status]}
                      </button>
                      <button
                        onClick={() => void removeDetection(d)}
                        title="Delete"
                        className="rounded-lg border border-white/10 p-1.5 text-white/40 transition hover:border-red-500/40 hover:text-red-400"
                      >
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* ── REVENUE ATTRIBUTION ── */}
          <div className="overflow-hidden rounded-3xl border border-primary/25 bg-gradient-to-b from-[#14100a] to-black p-6 md:p-8">
            <div className="flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-xl font-bold">
                <CircleDollarSign className="h-5 w-5 text-primary" aria-hidden="true" />
                Content ID revenue
              </h2>
              <div className="flex items-center gap-2">
                <button onClick={() => { setShowRevForm((v) => !v); setRevError(null); }} className={ghostBtn}>
                  <Plus className="h-4 w-4" aria-hidden="true" />
                  Log income
                </button>
                <Link href="/coach" className="inline-flex items-center gap-1 text-xs font-bold text-primary hover:underline">
                  Money Tracker <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                </Link>
              </div>
            </div>
            <p className="mt-1.5 text-sm text-white/45">
              Earned from Content ID claims elsewhere? Log it here — it posts straight into your Money Tracker
              as <span className="font-semibold text-white/75">content_id_income</span> so your P&amp;L stays honest.
            </p>
            {revOk && (
              <p className="mt-4 flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">
                <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                Logged to your Money Tracker — check the /coach tab.
              </p>
            )}
            {showRevForm && (
              <form onSubmit={logRevenue} className="mt-5 rounded-2xl border border-primary/20 bg-black/50 p-4">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_2fr]">
                  <div>
                    <label className={labelClass}>Amount (USD)</label>
                    <input
                      type="number" min={0} step="0.01"
                      value={revAmount} onChange={(e) => setRevAmount(e.target.value)}
                      placeholder="25.00" className={inputClass}
                    />
                  </div>
                  <div>
                    <label className={labelClass}>Note <span className="font-normal normal-case text-white/30">(optional)</span></label>
                    <input
                      value={revNote} onChange={(e) => setRevNote(e.target.value)}
                      placeholder="YouTube claim payout — March" maxLength={280} className={inputClass}
                    />
                  </div>
                </div>
                {revError && (
                  <p className="mt-3 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2.5 text-sm text-red-300">{revError}</p>
                )}
                <div className="mt-4 flex gap-2">
                  <button type="submit" disabled={revSaving} className={goldBtn}>
                    {revSaving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <CircleDollarSign className="h-4 w-4" aria-hidden="true" />}
                    Log to Money Tracker
                  </button>
                  <button type="button" onClick={() => setShowRevForm(false)} className={ghostBtn}>Cancel</button>
                </div>
              </form>
            )}
          </div>

          {/* ── PARTNERSHIP STATUS FOOTER ── */}
          <div className="flex items-start gap-2.5 rounded-2xl border border-white/10 bg-white/[0.02] px-5 py-4 text-xs leading-relaxed text-white/40">
            <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-white/30" aria-hidden="true" />
            <p>
              Partnership status: <strong className="text-white/65">no YouTube CMS partner yet.</strong>{" "}
              Opt-ins are stored, detections are yours to track manually, and claims are blocked until the
              distribution partner integration goes live — at which point opted-in tracks activate automatically.
            </p>
          </div>
        </>
      )}
    </div>
  );
}
