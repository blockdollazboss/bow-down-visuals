import { useIsLightTheme } from "@/hooks/use-is-light-theme";
import { useCallback, useEffect, useState } from "react";
import {
  Loader2, ShieldCheck, Trophy, Delete, RotateCcw, AlertTriangle,
  ArrowUp, ArrowDown, ArrowLeft, ArrowRight, Play, Square, Crown, Users, Star, Wrench,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { VisualBucsIcon } from "@/components/VisualBucsIcon";
import { Button } from "@/components/ui/button";
import { useTranslation } from "react-i18next";
import { usePageTitle } from "@/hooks/use-page-title";
import { SecretChallengePopup } from "@/components/SecretChallengePopup";
import { NfcOrdersAdmin } from "@/components/NfcOrdersAdmin";
import { JewelryOrdersAdmin } from "@/components/JewelryOrdersAdmin";
import { REPORT_REASON_LABELS, type ReportReason } from "@/lib/reports";
import { REMOVAL_REASONS, parseContentId } from "@/lib/content-removal";

type Direction = "up" | "down" | "left" | "right";

interface JackpotEvent {
  id: string;
  name: string;
  codeLength: number;
  codeSequence: string | null;
  prizeCredits: number;
  startsAt: string | null;
  endsAt: string | null;
  isActive: boolean;
  winnerUserId: string | null;
  winnerDisplayName: string | null;
  claimedAt: string | null;
}

const DIR_ICON: Record<Direction, typeof ArrowUp> = {
  up: ArrowUp,
  down: ArrowDown,
  left: ArrowLeft,
  right: ArrowRight,
};

function toDatetimeLocal(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function JackpotAdmin({ authHeaders }: { authHeaders: () => Promise<HeadersInit> }) {
  const isLight = useIsLightTheme();
  const { t } = useTranslation();
  const [events, setEvents] = useState<JackpotEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState(t("admin.jackpot.defaultEventName"));
  const [sequence, setSequence] = useState<Direction[]>([]);
  const [prize, setPrize] = useState("100");
  const [startsAt, setStartsAt] = useState(() => toDatetimeLocal(new Date()));
  const [endsAt, setEndsAt] = useState(() => {
    const d = new Date();
    d.setMonth(d.getMonth() + 1);
    return toDatetimeLocal(d);
  });
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /* Load failures (500s, network) are NOT "no events" — they get their
     own error state with a retry. The empty state renders ONLY for a
     successful load with zero events. */
  const [loadError, setLoadError] = useState(false);
  const [retryNonce, setRetryNonce] = useState(0);

  const load = useCallback(async () => {
    setLoadError(false);
    try {
      const res = await fetch("/api/cheat-code/admin/events", { headers: await authHeaders() });
      const data = (await res.json()) as { events?: JackpotEvent[] };
      if (!res.ok) {
        setLoadError(true);
        return;
      }
      setEvents(data.events ?? []);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [authHeaders]);

  useEffect(() => { void load(); }, [load, retryNonce]);

  function pushDir(d: Direction) {
    setSequence((s) => (s.length >= 10 ? s : [...s, d]));
  }

  async function handleCreate() {
    setError(null);
    setMessage(null);
    if (sequence.length < 4) {
      setError(t("admin.jackpot.errorMinMoves"));
      return;
    }
    const prizeCredits = parseInt(prize, 10);
    if (!Number.isFinite(prizeCredits) || prizeCredits < 100 || prizeCredits > 1000000) {
      setError(t("admin.jackpot.errorPrizeRange"));
      return;
    }
    if (!name.trim()) {
      setError(t("admin.jackpot.errorNameRequired"));
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/cheat-code/admin/events", {
        method: "POST",
        headers: { ...(await authHeaders()), "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          codeSequence: sequence,
          prizeCredits,
          startsAt: new Date(startsAt).toISOString(),
          endsAt: new Date(endsAt).toISOString(),
        }),
      });
      const data = (await res.json()) as { error?: string; event?: JackpotEvent };
      if (!res.ok) throw new Error(data.error || t("admin.jackpot.errorCreate"));
      setMessage(t("admin.jackpot.createdMessage", { name: data.event?.name }));
      setSequence([]);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("admin.jackpot.errorCreate"));
    } finally {
      setSaving(false);
    }
  }

  async function handleToggle(ev: JackpotEvent) {
    setBusyId(ev.id);
    setError(null);
    setMessage(null);
    try {
      const action = ev.isActive ? "deactivate" : "activate";
      const res = await fetch(`/api/cheat-code/admin/events/${ev.id}/${action}`, {
        method: "POST",
        headers: await authHeaders(),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error || t("admin.jackpot.errorAction", { action }));
      setMessage(ev.isActive ? t("admin.jackpot.deactivated") : t("admin.jackpot.activatedMessage", { name: ev.name }));
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("admin.jackpot.errorActionFailed"));
    } finally {
      setBusyId(null);
    }
  }

  const phaseOf = (ev: JackpotEvent) => {
    if (ev.winnerUserId) return "claimed";
    if (ev.isActive) return "live";
    if (ev.endsAt && new Date(ev.endsAt).getTime() <= Date.now()) return "ended";
    return "upcoming";
  };

  return (
    <div className={`rounded-xl border p-5 mt-4 ${isLight ? "border-[#C9A84C]/40 bg-gradient-to-b from-[#FCF7EA] to-[#F4E7C3]" : "border-primary/25 bg-gradient-to-b from-[#14100a] to-[#0d0a04]"}`}>
      <div className="flex items-center gap-2 mb-1">
        <Trophy className="h-4 w-4 text-primary" />
        <p className="text-xs text-white/40 uppercase tracking-wider font-semibold">
          {t("admin.jackpot.title")}
        </p>
      </div>
      <p className="text-sm text-white/60 mb-4">
        {t("admin.jackpot.description")}
      </p>

      {/* Create a manual event */}
      <div className={`rounded-xl border p-4 mb-4 ${isLight ? "border-[#C9A84C]/30 bg-[#F7ECD2]/70" : "border-white/10 bg-black/40"}`}>
        <p className="text-sm font-semibold text-white mb-3">{t("admin.jackpot.runSpecialEvent")}</p>
        <div className="grid gap-3 sm:grid-cols-2 mb-4">
          <label className="block">
            <span className="text-xs text-white/50">{t("admin.jackpot.eventName")}</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={saving}
              className="mt-1 w-full rounded-xl bg-black/40 border border-white/10 px-3 py-2 text-sm text-white outline-none focus:border-white/25"
            />
          </label>
          <label className="block">
            <span className="text-xs text-white/50">{t("admin.jackpot.prizeLabel")}</span>
            <input
              type="number" min={100} max={1000000}
              value={prize}
              onChange={(e) => setPrize(e.target.value)}
              disabled={saving}
              className="mt-1 w-full rounded-xl bg-black/40 border border-white/10 px-3 py-2 text-sm text-white outline-none focus:border-white/25"
            />
          </label>
          <label className="block">
            <span className="text-xs text-white/50">{t("admin.jackpot.startsLabel")}</span>
            <input
              type="datetime-local"
              value={startsAt}
              onChange={(e) => setStartsAt(e.target.value)}
              disabled={saving}
              className="mt-1 w-full rounded-xl bg-black/40 border border-white/10 px-3 py-2 text-sm text-white outline-none focus:border-white/25"
            />
          </label>
          <label className="block">
            <span className="text-xs text-white/50">{t("admin.jackpot.endsLabel")}</span>
            <input
              type="datetime-local"
              value={endsAt}
              onChange={(e) => setEndsAt(e.target.value)}
              disabled={saving}
              className="mt-1 w-full rounded-xl bg-black/40 border border-white/10 px-3 py-2 text-sm text-white outline-none focus:border-white/25"
            />
          </label>
        </div>

        {/* D-pad code entry */}
        <p className="text-xs text-white/50 mb-2">{t("admin.jackpot.dpadHint")}</p>
        <div className="flex flex-wrap items-center gap-4 mb-4">
          <div className="grid grid-cols-3 gap-1.5 w-fit" aria-label={t("admin.jackpot.dpadAria")}>
            <span />
            <button type="button" onClick={() => pushDir("up")} disabled={saving}
              aria-label={t("admin.jackpot.dirUp")}
              className="h-12 w-12 rounded-xl bg-white/[0.06] border border-white/15 text-white flex items-center justify-center active:bg-primary/40 active:border-primary transition">
              <ArrowUp className="h-5 w-5" />
            </button>
            <span />
            <button type="button" onClick={() => pushDir("left")} disabled={saving}
              aria-label={t("admin.jackpot.dirLeft")}
              className="h-12 w-12 rounded-xl bg-white/[0.06] border border-white/15 text-white flex items-center justify-center active:bg-primary/40 active:border-primary transition">
              <ArrowLeft className="h-5 w-5" />
            </button>
            <button type="button" onClick={() => pushDir("down")} disabled={saving}
              aria-label={t("admin.jackpot.dirDown")}
              className="h-12 w-12 rounded-xl bg-white/[0.06] border border-white/15 text-white flex items-center justify-center active:bg-primary/40 active:border-primary transition">
              <ArrowDown className="h-5 w-5" />
            </button>
            <button type="button" onClick={() => pushDir("right")} disabled={saving}
              aria-label={t("admin.jackpot.dirRight")}
              className="h-12 w-12 rounded-xl bg-white/[0.06] border border-white/15 text-white flex items-center justify-center active:bg-primary/40 active:border-primary transition">
              <ArrowRight className="h-5 w-5" />
            </button>
          </div>
          <div className="flex-1 min-w-[140px]">
            <div className="flex flex-wrap gap-1 mb-2 min-h-[28px]">
              {sequence.length === 0 && (
                <span className="text-xs text-white/30">{t("admin.jackpot.noMoves")}</span>
              )}
              {sequence.map((d, i) => {
                const Icon = DIR_ICON[d];
                return (
                  <span key={i} className="h-7 w-7 rounded-lg bg-primary/20 border border-primary/40 text-primary flex items-center justify-center">
                    <Icon className="h-4 w-4" />
                  </span>
                );
              })}
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-white/40">{t("admin.jackpot.movesCount", { count: sequence.length })}</span>
              <button type="button" onClick={() => setSequence((s) => s.slice(0, -1))} disabled={saving || sequence.length === 0}
                className="rounded-lg bg-white/[0.06] border border-white/10 p-1.5 text-white/70 disabled:opacity-40" aria-label={t("admin.jackpot.deleteLastMove")}>
                <Delete className="h-4 w-4" />
              </button>
              <button type="button" onClick={() => setSequence([])} disabled={saving || sequence.length === 0}
                className="rounded-lg bg-white/[0.06] border border-white/10 p-1.5 text-white/70 disabled:opacity-40" aria-label={t("admin.jackpot.clearCode")}>
                <RotateCcw className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>

        <Button onClick={() => { void handleCreate(); }} disabled={saving} className="rounded-xl w-full sm:w-auto">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {t("admin.jackpot.createEvent")}
        </Button>
        {message && <p className="mt-3 text-sm text-green-400">{message}</p>}
        {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
      </div>

      {/* Existing events */}
      <p className="text-sm font-semibold text-white mb-2">{t("admin.jackpot.eventsTitle")}</p>
      {loading ? (
        <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-white/40" /></div>
      ) : loadError ? (
        <div className={`rounded-2xl border p-10 text-center ${isLight ? "border-[#C9A84C]/50 bg-[#F7ECD2]" : "border-primary/25 bg-zinc-950"}`}>
          <AlertTriangle className="mx-auto h-10 w-10 text-primary" />
          <p className={`mt-3 font-bold ${isLight ? "text-[#2A1E07]" : "text-white"}`}>Couldn't load jackpot events.</p>
          <p className={`mt-1 text-sm ${isLight ? "text-[#6B5B36]" : "text-white/50"}`}>
            Something went wrong on our end — the events are safe, this panel just couldn't load them.
          </p>
          <button
            type="button"
            onClick={() => { setLoading(true); setRetryNonce((n) => n + 1); }}
            className="mt-4 inline-flex items-center gap-2 rounded-full bg-primary px-6 py-2.5 font-bold text-black hover:brightness-110"
          >
            <RotateCcw className="h-4 w-4" /> Try again
          </button>
        </div>
      ) : events.length === 0 ? (
        <p className="text-sm text-white/40 py-4 text-center">{t("admin.jackpot.noEvents")}</p>
      ) : (
        <div className="space-y-2">
          {events.map((ev) => {
            const phase = phaseOf(ev);
            return (
              <div key={ev.id} className={`rounded-xl border p-3 flex flex-wrap items-center gap-3 ${isLight ? "border-[#C9A84C]/30 bg-[#F7ECD2]/70" : "border-white/10 bg-black/40"}`}>
                <div className="flex-1 min-w-[160px]">
                  <p className="text-sm font-semibold text-white">{ev.name}</p>
                  <p className="text-xs text-white/40">
                    {t("admin.jackpot.eventDetails", { credits: ev.prizeCredits, moves: ev.codeLength })}{" "}
                    {ev.endsAt ? new Date(ev.endsAt).toLocaleDateString() : t("admin.jackpot.noEnd")} ·{" "}
                    <span className={
                      phase === "live" ? "text-green-400 font-semibold"
                      : phase === "claimed" ? "text-primary font-semibold"
                      : "text-white/40"
                    }>
                      {phase === "live" ? t("admin.jackpot.phaseLive") : phase === "claimed" ? t("admin.jackpot.claimedBy", { name: ev.winnerDisplayName ?? t("admin.jackpot.aPlayer") }) : t(`admin.jackpot.phases.${phase}`)}
                    </span>
                  </p>
                  {ev.codeSequence && (
                    <p className="text-xs text-primary font-mono mt-1">
                      {t("admin.jackpot.codeLabel")} {ev.codeSequence.split(",").join(" → ")}
                    </p>
                  )}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => { void handleToggle(ev); }}
                  disabled={busyId === ev.id}
                  className="rounded-xl"
                >
                  {busyId === ev.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    : ev.isActive ? <><Square className="h-3.5 w-3.5" /> {t("admin.jackpot.deactivate")}</>
                    : <><Play className="h-3.5 w-3.5" /> {t("admin.jackpot.activate")}</>}
                </Button>
              </div>
            );
          })}
        </div>
      )}
      <p className="mt-3 text-[11px] text-white/30">
        {t("admin.jackpot.footerNote")}
      </p>
    </div>
  );
}

/* ─── Spotlight Inbox — $99 takeover leads ─────────────────────────────── */
interface SpotlightInquiry {
  id: string;
  name: string;
  email: string;
  videoUrl: string | null;
  targetUrl: string | null;
  status: string;
  createdAt: string | null;
}

const SPOTLIGHT_STATUSES = ["new", "contacted", "approved", "rejected"] as const;

const SPOTLIGHT_STATUS_CLS: Record<string, string> = {
  new: "border-[#C9A84C]/50 bg-[#C9A84C]/10 text-[#e8c86a]",
  contacted: "border-sky-400/40 bg-sky-400/10 text-sky-300",
  approved: "border-emerald-400/40 bg-emerald-400/10 text-emerald-300",
  rejected: "border-red-400/40 bg-red-400/10 text-red-300",
};

function SpotlightInbox({ authHeaders }: { authHeaders: () => Promise<HeadersInit> }) {
  const isLight = useIsLightTheme();
  const { t } = useTranslation();
  const [inquiries, setInquiries] = useState<SpotlightInquiry[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /* Load failures (500s, network) are NOT "no inquiries" — they get
     their own error state with a retry, separate from the status-update
     error line. The empty state renders ONLY for a successful load
     with zero inquiries. */
  const [loadError, setLoadError] = useState(false);
  const [retryNonce, setRetryNonce] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const res = await fetch("/api/admin/spotlight-inquiries", { headers: await authHeaders() });
      const data = (await res.json()) as { inquiries?: SpotlightInquiry[] };
      if (res.ok) setInquiries(data.inquiries ?? []);
      else setLoadError(true);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authHeaders]);

  useEffect(() => { void load(); }, [load, retryNonce]);

  async function setStatus(id: string, status: string) {
    setBusyId(id);
    setError(null);
    try {
      const res = await fetch(`/api/admin/spotlight-inquiries/${id}`, {
        method: "PATCH",
        headers: { ...(await authHeaders()), "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error();
      setInquiries((list) => list.map((q) => (q.id === id ? { ...q, status } : q)));
    } catch {
      setError(t("admin.spotlight.statusError"));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className={`rounded-xl border p-5 mt-4 ${isLight ? "border-[#C9A84C]/40 bg-gradient-to-b from-[#FCF7EA] to-[#F4E7C3]" : "border-primary/25 bg-gradient-to-b from-[#14100a] to-[#0d0a04]"}`}>
      <div className="flex items-center gap-2 mb-1">
        <Star className="h-4 w-4 text-primary" />
        <p className="text-xs text-white/40 uppercase tracking-wider font-semibold">
          {t("admin.spotlight.title")}
        </p>
      </div>
      <p className="text-sm text-white/60 mb-4">
        {t("admin.spotlight.description")}
      </p>
      {loading ? (
        <p className="text-sm text-white/40"><Loader2 className="h-4 w-4 animate-spin inline" /></p>
      ) : loadError ? (
        <div className={`rounded-2xl border p-10 text-center ${isLight ? "border-[#C9A84C]/50 bg-[#F7ECD2]" : "border-primary/25 bg-zinc-950"}`}>
          <AlertTriangle className="mx-auto h-10 w-10 text-primary" />
          <p className={`mt-3 font-bold ${isLight ? "text-[#2A1E07]" : "text-white"}`}>Couldn't load spotlight inquiries.</p>
          <p className={`mt-1 text-sm ${isLight ? "text-[#6B5B36]" : "text-white/50"}`}>
            Something went wrong on our end — the inquiries are safe, this inbox just couldn't load them.
          </p>
          <button
            type="button"
            onClick={() => setRetryNonce((n) => n + 1)}
            className="mt-4 inline-flex items-center gap-2 rounded-full bg-primary px-6 py-2.5 font-bold text-black hover:brightness-110"
          >
            <RotateCcw className="h-4 w-4" /> Try again
          </button>
        </div>
      ) : inquiries.length === 0 ? (
        <p className="text-sm text-white/40">{t("admin.spotlight.empty")}</p>
      ) : (
        <div className="space-y-3">
          {inquiries.map((q) => (
            <div key={q.id} className="rounded-xl border border-white/[0.08] bg-black/30 p-4">
              <div className="flex flex-wrap items-center gap-2 justify-between">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-white truncate">{q.name}</p>
                  <p className="text-xs text-white/50 truncate">{q.email}</p>
                </div>
                <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${SPOTLIGHT_STATUS_CLS[q.status] ?? SPOTLIGHT_STATUS_CLS.new}`}>
                  {t(`admin.spotlight.status.${q.status}`, { defaultValue: q.status })}
                </span>
              </div>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
                {q.videoUrl && (
                  <a href={q.videoUrl} target="_blank" rel="noreferrer" className="text-[#e8c86a] underline hover:text-white">
                    {t("admin.spotlight.videoLink")}
                  </a>
                )}
                {q.targetUrl && (
                  <a href={q.targetUrl} target="_blank" rel="noreferrer" className="text-[#e8c86a] underline hover:text-white">
                    {t("admin.spotlight.targetLink")}
                  </a>
                )}
                <span className="text-white/30">
                  {q.createdAt ? new Date(q.createdAt).toLocaleString() : "—"}
                </span>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {SPOTLIGHT_STATUSES.map((s) => (
                  <Button
                    key={s}
                    size="sm"
                    variant={q.status === s ? "default" : "outline"}
                    disabled={busyId === q.id || q.status === s}
                    onClick={() => { void setStatus(q.id, s); }}
                    className="rounded-xl text-xs"
                  >
                    {busyId === q.id ? <Loader2 className="h-3 w-3 animate-spin" /> : t(`admin.spotlight.status.${s}`)}
                  </Button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
      {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
    </div>
  );
}

/* ─── Contact Inbox — contact form messages ─────────────────────────────── */
interface ContactMessage {
  id: string;
  name: string;
  email: string;
  message: string;
  read: boolean;
  createdAt: string | null;
}

function ContactInbox({ authHeaders }: { authHeaders: () => Promise<HeadersInit> }) {
  const isLight = useIsLightTheme();
  const { t } = useTranslation();
  const [messages, setMessages] = useState<ContactMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /* Load failures (500s, network) are NOT "no messages" — they get
     their own error state with a retry, separate from the mark-read
     error line. The empty state renders ONLY for a successful load
     with zero messages. */
  const [loadError, setLoadError] = useState(false);
  const [retryNonce, setRetryNonce] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const res = await fetch("/api/admin/contact-messages", { headers: await authHeaders() });
      const data = (await res.json()) as { messages?: ContactMessage[] };
      if (res.ok) setMessages(data.messages ?? []);
      else setLoadError(true);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authHeaders]);

  useEffect(() => { void load(); }, [load, retryNonce]);

  async function setRead(id: string, read: boolean) {
    setBusyId(id);
    setError(null);
    try {
      const res = await fetch(`/api/admin/contact-messages/${id}`, {
        method: "PATCH",
        headers: { ...(await authHeaders()), "Content-Type": "application/json" },
        body: JSON.stringify({ read }),
      });
      if (!res.ok) throw new Error();
      setMessages((list) => list.map((m) => (m.id === id ? { ...m, read } : m)));
    } catch {
      setError(t("admin.contact.statusError"));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className={`rounded-xl border p-5 mt-4 ${isLight ? "border-[#C9A84C]/40 bg-gradient-to-b from-[#FCF7EA] to-[#F4E7C3]" : "border-primary/25 bg-gradient-to-b from-[#14100a] to-[#0d0a04]"}`}>
      <div className="flex items-center gap-2 mb-1">
        <Users className="h-4 w-4 text-primary" />
        <p className="text-xs text-white/40 uppercase tracking-wider font-semibold">
          {t("admin.contact.title")}
        </p>
      </div>
      <p className="text-sm text-white/60 mb-4">
        {t("admin.contact.description")}
      </p>
      {loading ? (
        <p className="text-sm text-white/40"><Loader2 className="h-4 w-4 animate-spin inline" /></p>
      ) : loadError ? (
        <div className={`rounded-2xl border p-10 text-center ${isLight ? "border-[#C9A84C]/50 bg-[#F7ECD2]" : "border-primary/25 bg-zinc-950"}`}>
          <AlertTriangle className="mx-auto h-10 w-10 text-primary" />
          <p className={`mt-3 font-bold ${isLight ? "text-[#2A1E07]" : "text-white"}`}>Couldn't load contact messages.</p>
          <p className={`mt-1 text-sm ${isLight ? "text-[#6B5B36]" : "text-white/50"}`}>
            Something went wrong on our end — the messages are safe, this inbox just couldn't load them.
          </p>
          <button
            type="button"
            onClick={() => setRetryNonce((n) => n + 1)}
            className="mt-4 inline-flex items-center gap-2 rounded-full bg-primary px-6 py-2.5 font-bold text-black hover:brightness-110"
          >
            <RotateCcw className="h-4 w-4" /> Try again
          </button>
        </div>
      ) : messages.length === 0 ? (
        <p className="text-sm text-white/40">{t("admin.contact.empty")}</p>
      ) : (
        <div className="space-y-3">
          {messages.map((m) => (
            <div key={m.id} className={`rounded-xl border p-4 ${m.read ? "border-white/[0.06] bg-black/20" : "border-[#C9A84C]/40 bg-[#C9A84C]/[0.05]"}`}>
              <div className="flex flex-wrap items-center gap-2 justify-between">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-white truncate">
                    {m.name} <span className="font-normal text-white/50">· {m.email}</span>
                  </p>
                </div>
                <span className="text-[11px] text-white/30">
                  {m.createdAt ? new Date(m.createdAt).toLocaleString() : "—"}
                </span>
              </div>
              <p className="mt-2 text-sm text-white/75 whitespace-pre-wrap">{m.message}</p>
              <div className="mt-3">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busyId === m.id}
                  onClick={() => { void setRead(m.id, !m.read); }}
                  className="rounded-xl text-xs"
                >
                  {busyId === m.id ? <Loader2 className="h-3 w-3 animate-spin" />
                    : m.read ? t("admin.contact.markUnread") : t("admin.contact.markRead")}
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
      {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
    </div>
  );
}

/* ─── DMCA Reports — the moderation bench queue ─────────────────────────
   Takedown reports filed through POST /api/dmca/report. Until this
   inbox existed the reports landed in a table nothing could read;
   the intake's operator email already pointed admins here. Working
   a report = moving it through its workflow; the queue shows the
   full report context (reporter, claimed-original links, the
   allegedly infringing links, the sworn description). */
interface DmcaReport {
  id: string;
  reporterName: string;
  reporterEmail: string;
  reporterOrg: string | null;
  infringingUrls: string[];
  originalUrls: string[];
  description: string;
  status: string;
  createdAt: string | null;
}

const DMCA_STATUSES = ["new", "reviewing", "actioned", "dismissed"] as const;

const DMCA_STATUS_CLS: Record<string, string> = {
  new: "border-[#C9A84C]/50 bg-[#C9A84C]/10 text-[#e8c86a]",
  reviewing: "border-sky-400/40 bg-sky-400/10 text-sky-300",
  actioned: "border-emerald-400/40 bg-emerald-400/10 text-emerald-300",
  dismissed: "border-white/20 bg-white/5 text-white/50",
};

function DmcaReportsInbox({ authHeaders }: { authHeaders: () => Promise<HeadersInit> }) {
  const isLight = useIsLightTheme();
  const { t } = useTranslation();
  const [reports, setReports] = useState<DmcaReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /* Load failures are NOT "no reports" — they get their own error
     state with a retry. The empty state renders ONLY for a
     successful load with zero reports. */
  const [loadError, setLoadError] = useState(false);
  const [retryNonce, setRetryNonce] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const res = await fetch("/api/admin/dmca-reports", { headers: await authHeaders() });
      const data = (await res.json()) as { reports?: DmcaReport[] };
      if (res.ok) setReports(data.reports ?? []);
      else setLoadError(true);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authHeaders]);

  useEffect(() => { void load(); }, [load, retryNonce]);

  async function setStatus(id: string, status: string) {
    setBusyId(id);
    setError(null);
    try {
      const res = await fetch(`/api/admin/dmca-reports/${id}`, {
        method: "PATCH",
        headers: { ...(await authHeaders()), "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error();
      setReports((list) => list.map((r) => (r.id === id ? { ...r, status } : r)));
    } catch {
      setError(t("admin.dmca.statusError"));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className={`rounded-xl border p-5 mt-4 ${isLight ? "border-[#C9A84C]/40 bg-gradient-to-b from-[#FCF7EA] to-[#F4E7C3]" : "border-primary/25 bg-gradient-to-b from-[#14100a] to-[#0d0a04]"}`}>
      <div className="flex items-center gap-2 mb-1">
        <ShieldCheck className="h-4 w-4 text-primary" />
        <p className="text-xs text-white/40 uppercase tracking-wider font-semibold">
          {t("admin.dmca.title")}
        </p>
      </div>
      <p className="text-sm text-white/60 mb-4">
        {t("admin.dmca.description")}
      </p>
      {loading ? (
        <p className="text-sm text-white/40"><Loader2 className="h-4 w-4 animate-spin inline" /></p>
      ) : loadError ? (
        <div className={`rounded-2xl border p-10 text-center ${isLight ? "border-[#C9A84C]/50 bg-[#F7ECD2]" : "border-primary/25 bg-zinc-950"}`}>
          <AlertTriangle className="mx-auto h-10 w-10 text-primary" />
          <p className={`mt-3 font-bold ${isLight ? "text-[#2A1E07]" : "text-white"}`}>Couldn't load takedown reports.</p>
          <p className={`mt-1 text-sm ${isLight ? "text-[#6B5B36]" : "text-white/50"}`}>
            Something went wrong on our end — the reports are safe, this queue just couldn't load them.
          </p>
          <button
            type="button"
            onClick={() => setRetryNonce((n) => n + 1)}
            className="mt-4 inline-flex items-center gap-2 rounded-full bg-primary px-6 py-2.5 font-bold text-black hover:brightness-110"
          >
            <RotateCcw className="h-4 w-4" /> Try again
          </button>
        </div>
      ) : reports.length === 0 ? (
        <p className="text-sm text-white/40">{t("admin.dmca.empty")}</p>
      ) : (
        <div className="space-y-3">
          {reports.map((r) => (
            <div key={r.id} className="rounded-xl border border-white/[0.08] bg-black/30 p-4">
              <div className="flex flex-wrap items-center gap-2 justify-between">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-white truncate">
                    {r.reporterName}
                    {r.reporterOrg ? <span className="font-normal text-white/50"> · {r.reporterOrg}</span> : null}
                  </p>
                  <p className="text-xs text-white/50 truncate">{r.reporterEmail}</p>
                </div>
                <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${DMCA_STATUS_CLS[r.status] ?? DMCA_STATUS_CLS.new}`}>
                  {t(`admin.dmca.status.${r.status}`, { defaultValue: r.status })}
                </span>
              </div>
              <p className="mt-2 text-sm text-white/75 whitespace-pre-wrap">{r.description}</p>
              {r.infringingUrls.length > 0 && (
                <div className="mt-2 text-xs">
                  <span className="text-white/40 uppercase tracking-wider font-semibold">{t("admin.dmca.infringingLabel")}</span>
                  <div className="mt-1 flex flex-col gap-1">
                    {r.infringingUrls.map((u) => (
                      <a key={u} href={u} target="_blank" rel="noreferrer" className="text-[#e8c86a] underline hover:text-white break-all">
                        {u}
                      </a>
                    ))}
                  </div>
                </div>
              )}
              {r.originalUrls.length > 0 && (
                <div className="mt-2 text-xs">
                  <span className="text-white/40 uppercase tracking-wider font-semibold">{t("admin.dmca.originalsLabel")}</span>
                  <div className="mt-1 flex flex-col gap-1">
                    {r.originalUrls.map((u) => (
                      <a key={u} href={u} target="_blank" rel="noreferrer" className="text-[#e8c86a] underline hover:text-white break-all">
                        {u}
                      </a>
                    ))}
                  </div>
                </div>
              )}
              <div className="mt-2 text-xs text-white/30">
                {r.createdAt ? new Date(r.createdAt).toLocaleString() : "—"}
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {DMCA_STATUSES.map((s) => (
                  <Button
                    key={s}
                    size="sm"
                    variant={r.status === s ? "default" : "outline"}
                    disabled={busyId === r.id || r.status === s}
                    onClick={() => { void setStatus(r.id, s); }}
                    className="rounded-xl text-xs"
                  >
                    {busyId === r.id ? <Loader2 className="h-3 w-3 animate-spin" /> : t(`admin.dmca.status.${s}`)}
                  </Button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
      {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
    </div>
  );
}

/* ─── Pitch & Fix — the team review queue (Stack-200 UPGRADES 196) ────
   Every pitch, fix report, and Feedback Pop-Up submission lands here
   PENDING; nothing is public until a team member approves it from
   this bench. Approving posts it to the boards with its starting
   status; the status buttons then walk it through its lifecycle
   (pitch: Reviewing → Approved → Building → Shipped; fix/feedback:
   Received → Confirmed → Fixing → Fixed). Same honesty as the other
   inboxes: a failed load is an error card, never a fake-empty queue. */
interface PitchFixRow {
  id: string;
  kind: "pitch" | "fix" | "feedback";
  source: string;
  submitterName: string;
  title: string;
  body: string;
  why: string | null;
  category: string | null;
  page: string | null;
  severity: string | null;
  rating: number | null;
  status: string;
  moderationStatus: "pending" | "approved" | "rejected";
  upvoteCount: number;
  createdAt: string;
}

const PITCH_FIX_PITCH_STATUSES = ["reviewing", "approved", "building", "shipped"] as const;
const PITCH_FIX_FIX_STATUSES = ["received", "confirmed", "fixing", "fixed"] as const;

function PitchFixInbox({ authHeaders }: { authHeaders: () => Promise<HeadersInit> }) {
  const isLight = useIsLightTheme();
  const { t } = useTranslation();
  const [rows, setRows] = useState<PitchFixRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const res = await fetch("/api/admin/pitch-fix/queue", { headers: await authHeaders() });
      if (!res.ok) throw new Error("queue failed");
      const data = (await res.json()) as { submissions?: PitchFixRow[] };
      setRows(data.submissions ?? []);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [authHeaders]);

  useEffect(() => { void load(); }, [load]);

  async function patch(id: string, body: { moderation?: string; status?: string }) {
    setBusyId(id);
    setError(null);
    try {
      const res = await fetch(`/api/admin/pitch-fix/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error("patch failed");
      const data = (await res.json()) as { submission: PitchFixRow };
      setRows((list) => list.map((r) => (r.id === id ? data.submission : r)));
    } catch {
      setError(t("admin.pitchFix.statusError"));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className={`rounded-3xl border p-5 md:p-6 ${isLight ? "border-[#C9A84C]/40 bg-gradient-to-b from-[#FCF7EA] to-[#F4E7C3]" : "border-primary/25 bg-gradient-to-b from-[#14100a] to-[#0d0a04]"}`} data-testid="pitch-fix-inbox">
      <h2 className={`text-base font-black ${isLight ? "text-[#2A1E07]" : "text-white"}`}>{t("admin.pitchFix.title")}</h2>
      <p className={`mt-0.5 text-xs ${isLight ? "text-[#5c5138]" : "text-white/40"}`}>{t("admin.pitchFix.description")}</p>
      {error && <p className="mt-3 text-sm font-bold text-red-400">{error}</p>}
      {loading ? (
        <p className="mt-4 flex items-center gap-2 text-sm text-white/40"><Loader2 className="h-4 w-4 animate-spin" />{t("admin.pitchFix.loading")}</p>
      ) : loadError ? (
        <div className="mt-4 rounded-xl border border-red-500/30 bg-red-500/[0.06] p-4">
          <p className={`font-bold ${isLight ? "text-[#2A1E07]" : "text-white"}`}>{t("admin.pitchFix.loadErrorTitle")}</p>
          <p className="text-sm text-red-200/80">{t("admin.pitchFix.loadError")}</p>
          <button type="button" onClick={() => void load()} className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-white/15 px-3 py-1.5 text-xs font-bold text-white/80 hover:bg-white/5">
            <RotateCcw className="h-3.5 w-3.5" /> {t("admin.pitchFix.retry")}
          </button>
        </div>
      ) : rows.length === 0 ? (
        <p className={`mt-3 text-sm ${isLight ? "text-[#5c5138]" : "text-white/40"}`}>{t("admin.pitchFix.empty")}</p>
      ) : (
        <div className="mt-4 space-y-3">
          {rows.map((r) => {
            const statuses = r.kind === "pitch" ? PITCH_FIX_PITCH_STATUSES : PITCH_FIX_FIX_STATUSES;
            return (
              <article key={r.id} className={`rounded-2xl border p-4 ${isLight ? "border-[#C9A84C]/40 bg-white/60" : "border-white/10 bg-white/[0.03]"}`}>
                <div className="flex flex-wrap items-center gap-2 text-xs font-extrabold">
                  <span className="rounded-full bg-[#d4a017]/15 px-2.5 py-0.5 text-[#d4a017]">{t(`admin.pitchFix.kind.${r.kind}`)}</span>
                  <span className={`rounded-full border px-2.5 py-0.5 ${r.moderationStatus === "pending" ? "border-sky-400/30 text-sky-300" : r.moderationStatus === "approved" ? "border-emerald-400/30 text-emerald-300" : "border-red-400/30 text-red-300"}`}>
                    {t(`pitchFix.moderation.${r.moderationStatus}`)}
                  </span>
                  {r.kind === "pitch"
                    ? <span className="rounded-full border border-white/20 px-2.5 py-0.5 text-white/60">{t(`pitchFix.pitchStatus.${r.status}`, { defaultValue: r.status })}</span>
                    : <span className="rounded-full border border-white/20 px-2.5 py-0.5 text-white/60">{t(`pitchFix.fixStatus.${r.status}`, { defaultValue: r.status })}</span>}
                  {r.rating != null && <span className="text-[#d4a017]">{t("admin.pitchFix.rating", { rating: r.rating })}</span>}
                  {r.kind === "pitch" && <span className="text-white/50">{r.upvoteCount} ▲</span>}
                </div>
                <h3 className={`mt-2 font-bold ${isLight ? "text-[#2A1E07]" : "text-white"}`}>{r.title || t("pitchFix.feedbackRow", { rating: r.rating ?? 0 })}</h3>
                {r.body && <p className={`text-sm ${isLight ? "text-[#5c5138]" : "text-white/55"}`}>{r.body}</p>}
                {r.why && <p className={`text-sm ${isLight ? "text-[#5c5138]" : "text-white/55"}`}><em>{t("pitchFix.whyMatters")}:</em> {r.why}</p>}
                <p className={`mt-1.5 text-xs font-bold ${isLight ? "text-[#5c5138]" : "text-white/40"}`}>
                  {t("pitchFix.by", { name: r.submitterName })}
                  {r.category ? ` · ${t(`pitchFix.category.${r.category}`, { defaultValue: r.category })}` : ""}
                  {r.page ? ` · ${t(`pitchFix.page.${r.page}`, { defaultValue: r.page })}` : ""}
                  {r.severity ? ` · ${t(`pitchFix.severity.${r.severity}`, { defaultValue: r.severity })}` : ""}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {r.moderationStatus !== "approved" && (
                    <button type="button" disabled={busyId === r.id} onClick={() => void patch(r.id, { moderation: "approved" })} className="rounded-lg bg-[#d4a017] px-3 py-1.5 text-xs font-extrabold text-[#171408] disabled:opacity-60">
                      {busyId === r.id ? <Loader2 className="h-3 w-3 animate-spin" /> : t("admin.pitchFix.approve")}
                    </button>
                  )}
                  {r.moderationStatus !== "rejected" && (
                    <button type="button" disabled={busyId === r.id} onClick={() => void patch(r.id, { moderation: "rejected" })} className="rounded-lg border border-red-400/40 px-3 py-1.5 text-xs font-extrabold text-red-300 disabled:opacity-60">
                      {t("admin.pitchFix.reject")}
                    </button>
                  )}
                  {r.moderationStatus === "approved" && statuses.map((s) => (
                    <button key={s} type="button" disabled={busyId === r.id || r.status === s} onClick={() => void patch(r.id, { status: s })} className={`rounded-lg border px-3 py-1.5 text-xs font-extrabold disabled:opacity-50 ${r.status === s ? "border-[#d4a017] text-[#d4a017]" : "border-white/20 text-white/70 hover:border-[#d4a017]/60"}`}>
                      {r.kind === "pitch" ? t(`pitchFix.pitchStatus.${s}`) : t(`pitchFix.fixStatus.${s}`)}
                    </button>
                  ))}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

/* ─── Content Reports — the member-report queue (Stack-4 #3) ────────────
   Reports filed through POST /api/reports land in content_reports with
   status "new"; this inbox is the bench that works them, docked right
   beside the DMCA inbox it mirrors (same honesty: a failed load is an
   error card with a retry, NEVER a fake-empty queue). Working a report
   = moving it through its workflow. The row carries the filed-time
   snapshot (target type, the target's own words, who filed, who owns
   the content) because the target itself may be edited or deleted by
   the time an admin looks. */
interface ContentReportRow {
  id: string;
  reporterUserId: string;
  targetType: string;
  targetId: string;
  targetOwnerUserId: string | null;
  targetSummary: string;
  reason: string;
  note: string | null;
  status: string;
  createdAt: string | null;
}

const REPORT_STATUSES = ["new", "reviewing", "actioned", "dismissed"] as const;

function ContentReportsInbox({ authHeaders }: { authHeaders: () => Promise<HeadersInit> }) {
  const isLight = useIsLightTheme();
  const { t } = useTranslation();
  const [reports, setReports] = useState<ContentReportRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /* Same rule as the DMCA inbox: load failures are NOT "no reports" —
     the empty state renders ONLY after a successful load of zero. */
  const [loadError, setLoadError] = useState(false);
  const [retryNonce, setRetryNonce] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const res = await fetch("/api/admin/reports", { headers: await authHeaders() });
      const data = (await res.json()) as { reports?: ContentReportRow[] };
      if (res.ok) setReports(data.reports ?? []);
      else setLoadError(true);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authHeaders]);

  useEffect(() => { void load(); }, [load, retryNonce]);

  async function setStatus(id: string, status: string) {
    setBusyId(id);
    setError(null);
    try {
      const res = await fetch(`/api/admin/reports/${id}`, {
        method: "PATCH",
        headers: { ...(await authHeaders()), "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error();
      setReports((list) => list.map((r) => (r.id === id ? { ...r, status } : r)));
    } catch {
      setError(t("admin.reports.statusError"));
    } finally {
      setBusyId(null);
    }
  }

  const shortId = (id: string | null) => (id ? `${id.slice(0, 8)}…` : t("admin.reports.unknownUser"));

  return (
    <div className={`rounded-xl border p-5 mt-4 ${isLight ? "border-[#C9A84C]/40 bg-gradient-to-b from-[#FCF7EA] to-[#F4E7C3]" : "border-primary/25 bg-gradient-to-b from-[#14100a] to-[#0d0a04]"}`}>
      <div className="flex items-center gap-2 mb-1">
        <ShieldCheck className="h-4 w-4 text-primary" />
        <p className="text-xs text-white/40 uppercase tracking-wider font-semibold">
          {t("admin.reports.title")}
        </p>
      </div>
      <p className="text-sm text-white/60 mb-4">
        {t("admin.reports.description")}
      </p>
      {loading ? (
        <p className="text-sm text-white/40"><Loader2 className="h-4 w-4 animate-spin inline" /></p>
      ) : loadError ? (
        <div className={`rounded-2xl border p-10 text-center ${isLight ? "border-[#C9A84C]/50 bg-[#F7ECD2]" : "border-primary/25 bg-zinc-950"}`}>
          <AlertTriangle className="mx-auto h-10 w-10 text-primary" />
          <p className={`mt-3 font-bold ${isLight ? "text-[#2A1E07]" : "text-white"}`}>Couldn't load content reports.</p>
          <p className={`mt-1 text-sm ${isLight ? "text-[#6B5B36]" : "text-white/50"}`}>
            Something went wrong on our end — the reports are safe, this queue just couldn't load them.
          </p>
          <button
            type="button"
            onClick={() => setRetryNonce((n) => n + 1)}
            className="mt-4 inline-flex items-center gap-2 rounded-full bg-primary px-6 py-2.5 font-bold text-black hover:brightness-110"
          >
            <RotateCcw className="h-4 w-4" /> Try again
          </button>
        </div>
      ) : reports.length === 0 ? (
        <p className="text-sm text-white/40">{t("admin.reports.empty")}</p>
      ) : (
        <div className="space-y-3">
          {reports.map((r) => (
            <div key={r.id} className="rounded-xl border border-white/[0.08] bg-black/30 p-4">
              <div className="flex flex-wrap items-center gap-2 justify-between">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <span className="inline-flex items-center rounded-full border border-white/15 bg-white/5 px-2.5 py-0.5 text-[11px] font-semibold text-white/70">
                    {t(`admin.reports.target.${r.targetType}`, { defaultValue: r.targetType })}
                  </span>
                  <span className="text-sm font-semibold text-white">
                    {REPORT_REASON_LABELS[r.reason as ReportReason] ?? r.reason}
                  </span>
                </div>
                <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${DMCA_STATUS_CLS[r.status] ?? DMCA_STATUS_CLS.new}`}>
                  {t(`admin.reports.status.${r.status}`, { defaultValue: r.status })}
                </span>
              </div>
              {r.targetSummary && (
                <p className="mt-2 text-sm text-white/75">“{r.targetSummary}”</p>
              )}
              {r.note && (
                <p className="mt-1 text-sm italic text-white/55">{r.note}</p>
              )}
              <p className="mt-2 text-xs text-white/40">
                {t("admin.reports.reportedByLabel")} {shortId(r.reporterUserId)}
                {" · "}{t("admin.reports.contentByLabel")} {shortId(r.targetOwnerUserId)}
                {" · "}{r.createdAt ? new Date(r.createdAt).toLocaleString() : "—"}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {REPORT_STATUSES.map((s) => (
                  <Button
                    key={s}
                    size="sm"
                    variant={r.status === s ? "default" : "outline"}
                    disabled={busyId === r.id || r.status === s}
                    onClick={() => { void setStatus(r.id, s); }}
                    className="rounded-xl text-xs"
                  >
                    {busyId === r.id ? <Loader2 className="h-3 w-3 animate-spin" /> : t(`admin.reports.status.${s}`)}
                  </Button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
      {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
    </div>
  );
}

/* ─── Content Removal — the admin takedown rail for posts/comments ─────
   Acts on the rail in routes/admin.ts (GET/PATCH /api/admin/content).
   The current state always renders BEFORE any action is offered —
   no blind removals — and a failed lookup is an error, never a fake
   "live" state. Removal is reversible and deletes nothing. */
interface AdminContentState {
  id: string;
  kind: "post" | "comment";
  postKind: string;
  body: string;
  author: { profileId: string; userId: string; slug: string; displayName: string } | null;
  createdAt: string | null;
  removed: boolean;
  removedAt: string | null;
  removedByEmail: string | null;
  removalReason: string | null;
  removalNote: string | null;
}

function ContentRemovalPanel({ authHeaders }: { authHeaders: () => Promise<HeadersInit> }) {
  const isLight = useIsLightTheme();
  const { t } = useTranslation();
  const [input, setInput] = useState("");
  const [looking, setLooking] = useState(false);
  const [current, setCurrent] = useState<AdminContentState | null>(null);
  const [lookupMsg, setLookupMsg] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [recent, setRecent] = useState<AdminContentState[]>([]);
  const [recentLoading, setRecentLoading] = useState(true);
  /* A failed recent-load is an error with a retry — never a fake
     "nothing removed" (the DMCA bench's error-vs-empty law). */
  const [recentError, setRecentError] = useState(false);
  const [retryNonce, setRetryNonce] = useState(0);
  const [busyId, setBusyId] = useState<string | null>(null);

  const loadRecent = useCallback(async () => {
    setRecentLoading(true);
    setRecentError(false);
    try {
      const res = await fetch("/api/admin/content/removed", { headers: await authHeaders() });
      const data = (await res.json()) as { content?: AdminContentState[] };
      if (res.ok) setRecent(data.content ?? []);
      else setRecentError(true);
    } catch {
      setRecentError(true);
    } finally {
      setRecentLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authHeaders]);

  useEffect(() => { void loadRecent(); }, [loadRecent, retryNonce]);

  async function lookup() {
    const id = parseContentId(input);
    setLookupMsg(null);
    setActionError(null);
    setCurrent(null);
    if (!id) {
      setLookupMsg(t("admin.removal.lookupError"));
      return;
    }
    setLooking(true);
    try {
      const res = await fetch(`/api/admin/content/${id}`, { headers: await authHeaders() });
      if (res.status === 404) {
        setLookupMsg(t("admin.removal.notFound"));
        return;
      }
      if (!res.ok) throw new Error();
      const data = (await res.json()) as { content: AdminContentState };
      setCurrent(data.content);
      setReason("");
      setNote("");
    } catch {
      setLookupMsg(t("admin.removal.lookupError"));
    } finally {
      setLooking(false);
    }
  }

  async function patch(id: string, removed: boolean): Promise<AdminContentState | null> {
    const res = await fetch(`/api/admin/content/${id}`, {
      method: "PATCH",
      headers: { ...(await authHeaders()), "Content-Type": "application/json" },
      body: JSON.stringify(removed ? { removed: true, reason, note: note.trim() || undefined } : { removed: false }),
    });
    if (!res.ok) throw new Error();
    const data = (await res.json()) as { content: AdminContentState };
    return data.content;
  }

  async function act(removed: boolean) {
    if (!current) return;
    if (removed && !reason) {
      setActionError(t("admin.removal.reasonRequired"));
      return;
    }
    setBusy(true);
    setActionError(null);
    try {
      const updated = await patch(current.id, removed);
      if (updated) setCurrent(updated);
      setReason("");
      setNote("");
      void loadRecent();
    } catch {
      setActionError(t("admin.removal.actionError"));
    } finally {
      setBusy(false);
    }
  }

  async function restoreFromList(id: string) {
    setBusyId(id);
    setActionError(null);
    try {
      const updated = await patch(id, false);
      if (updated && current?.id === id) setCurrent(updated);
      void loadRecent();
    } catch {
      setActionError(t("admin.removal.actionError"));
    } finally {
      setBusyId(null);
    }
  }

  const statePill = (c: AdminContentState) => (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${
      c.removed
        ? "border-red-400/40 bg-red-400/10 text-red-300"
        : "border-emerald-400/40 bg-emerald-400/10 text-emerald-300"
    }`}>
      {c.removed ? t("admin.removal.removedLabel") : t("admin.removal.liveLabel")}
    </span>
  );

  return (
    <div className={`rounded-xl border p-5 mt-4 ${isLight ? "border-[#C9A84C]/40 bg-gradient-to-b from-[#FCF7EA] to-[#F4E7C3]" : "border-primary/25 bg-gradient-to-b from-[#14100a] to-[#0d0a04]"}`}>
      <div className="flex items-center gap-2 mb-1">
        <ShieldCheck className="h-4 w-4 text-primary" />
        <p className="text-xs text-white/40 uppercase tracking-wider font-semibold">
          {t("admin.removal.title")}
        </p>
      </div>
      <p className="text-sm text-white/60 mb-4">{t("admin.removal.description")}</p>

      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") void lookup(); }}
          placeholder={t("admin.removal.inputPlaceholder")}
          className="flex-1 rounded-xl bg-black/40 border border-white/10 px-3 py-2 text-sm text-white outline-none focus:border-white/25"
        />
        <Button size="sm" onClick={() => { void lookup(); }} disabled={looking || !input.trim()} className="rounded-xl text-xs">
          {looking ? <Loader2 className="h-3 w-3 animate-spin" /> : t("admin.removal.lookupButton")}
        </Button>
      </div>
      {lookupMsg && <p className="mt-3 text-sm text-red-400">{lookupMsg}</p>}

      {current && (
        <div className="mt-4 rounded-xl border border-white/10 bg-black/30 p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-white">
                {current.kind === "comment" ? t("admin.removal.kindComment") : t("admin.removal.kindPost")}
                {current.author ? <span className="font-normal text-white/50"> · {current.author.displayName} (@{current.author.slug})</span> : null}
              </p>
              <p className="text-xs text-white/40">{current.id}</p>
            </div>
            {statePill(current)}
          </div>
          <p className="mt-2 text-sm text-white/80 whitespace-pre-wrap break-words">{current.body || "—"}</p>
          <p className="mt-2 text-xs text-white/30">
            {current.createdAt ? new Date(current.createdAt).toLocaleString() : "—"}
          </p>

          {current.removed ? (
            <div className="mt-3">
              <p className="text-xs text-white/60">
                {t("admin.removal.reasonLabel")}:{" "}
                <span className="text-white font-medium">
                  {t(`admin.removal.reasons.${current.removalReason ?? "other"}`, { defaultValue: current.removalReason ?? "" })}
                </span>
                {current.removedByEmail ? <> · {t("admin.removal.removedBy", { email: current.removedByEmail })}</> : null}
                {current.removedAt ? <> · {new Date(current.removedAt).toLocaleString()}</> : null}
              </p>
              {current.removalNote && <p className="mt-1 text-xs text-white/50 whitespace-pre-wrap">{current.removalNote}</p>}
              <div className="mt-3">
                <Button size="sm" variant="outline" disabled={busy} onClick={() => { void act(false); }} className="rounded-xl text-xs">
                  {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <><RotateCcw className="h-3 w-3 mr-1" />{t("admin.removal.restoreButton")}</>}
                </Button>
              </div>
            </div>
          ) : (
            <div className="mt-3 space-y-2">
              <label className="block">
                <span className="text-[11px] text-white/40 uppercase tracking-wider font-semibold">{t("admin.removal.reasonLabel")}</span>
                <select
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  className="mt-1 w-full rounded-xl bg-black/40 border border-white/10 px-3 py-2 text-sm text-white outline-none focus:border-white/25"
                >
                  <option value="">—</option>
                  {REMOVAL_REASONS.map((r) => (
                    <option key={r} value={r}>{t(`admin.removal.reasons.${r}`)}</option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="text-[11px] text-white/40 uppercase tracking-wider font-semibold">{t("admin.removal.noteLabel")}</span>
                <input
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder={t("admin.removal.notePlaceholder")}
                  maxLength={500}
                  className="mt-1 w-full rounded-xl bg-black/40 border border-white/10 px-3 py-2 text-sm text-white outline-none focus:border-white/25"
                />
              </label>
              <Button size="sm" variant="destructive" disabled={busy} onClick={() => { void act(true); }} className="rounded-xl text-xs">
                {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : t("admin.removal.removeButton")}
              </Button>
            </div>
          )}
          {actionError && <p className="mt-3 text-sm text-red-400">{actionError}</p>}
        </div>
      )}

      <div className="mt-5">
        <p className="text-[11px] text-white/40 uppercase tracking-wider font-semibold mb-2">{t("admin.removal.recentTitle")}</p>
        {recentLoading ? (
          <Loader2 className="h-4 w-4 animate-spin text-white/40" />
        ) : recentError ? (
          <div className="rounded-xl border border-red-400/30 bg-red-400/5 p-3">
            <p className="text-sm text-red-300">{t("admin.removal.recentLoadError")}</p>
            <Button size="sm" variant="outline" className="mt-2 rounded-xl text-xs" onClick={() => setRetryNonce((n) => n + 1)}>
              Retry
            </Button>
          </div>
        ) : recent.length === 0 ? (
          <p className="text-sm text-white/40">{t("admin.removal.recentEmpty")}</p>
        ) : (
          <div className="space-y-2">
            {recent.map((c) => (
              <div key={c.id} className="flex items-start justify-between gap-3 rounded-xl border border-white/10 bg-black/30 p-3">
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-white">
                    {c.kind === "comment" ? t("admin.removal.kindComment") : t("admin.removal.kindPost")}
                    {c.author ? <span className="font-normal text-white/50"> · @{c.author.slug}</span> : null}
                    <span className="font-normal text-white/50"> · {t(`admin.removal.reasons.${c.removalReason ?? "other"}`, { defaultValue: c.removalReason ?? "" })}</span>
                  </p>
                  <p className="mt-0.5 text-xs text-white/60 truncate">{c.body || "—"}</p>
                  <p className="text-[11px] text-white/30">{c.removedAt ? new Date(c.removedAt).toLocaleString() : ""}</p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busyId === c.id}
                  onClick={() => { void restoreFromList(c.id); }}
                  className="rounded-xl text-xs shrink-0"
                >
                  {busyId === c.id ? <Loader2 className="h-3 w-3 animate-spin" /> : t("admin.removal.restoreButton")}
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── User Management — lookup, ban, unban ──────────────────────────────── */
interface AdminUserLookup {
  id: string;
  email: string;
  displayName: string | null;
  credits: number;
  plan: string | null;
  banned: boolean;
  createdAt: string | null;
}

function UserManagement({ authHeaders, adminEmail }: { authHeaders: () => Promise<HeadersInit>; adminEmail: string | null }) {
  const isLight = useIsLightTheme();
  const { t } = useTranslation();
  const [email, setEmail] = useState("");
  const [looking, setLooking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [found, setFound] = useState<AdminUserLookup | null>(null);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function lookup() {
    const q = email.trim();
    if (!q) return;
    setLooking(true);
    setError(null);
    setSearched(false);
    try {
      const res = await fetch(`/api/admin/users/lookup?email=${encodeURIComponent(q)}`, {
        headers: await authHeaders(),
      });
      const data = (await res.json()) as { user?: AdminUserLookup | null };
      if (!res.ok) throw new Error();
      setFound(data.user ?? null);
      setSearched(true);
    } catch {
      setError(t("admin.users.lookupError"));
    } finally {
      setLooking(false);
    }
  }

  async function setBan(ban: boolean) {
    if (!found) return;
    const label = ban ? t("admin.users.banConfirm", { email: found.email }) : t("admin.users.unbanConfirm", { email: found.email });
    if (!window.confirm(label)) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/users/${found.id}/${ban ? "ban" : "unban"}`, {
        method: "POST",
        headers: await authHeaders(),
      });
      if (!res.ok) throw new Error();
      setFound({ ...found, banned: ban });
    } catch {
      setError(t("admin.users.banError"));
    } finally {
      setBusy(false);
    }
  }

  const isSelf = found != null && adminEmail != null && found.email.toLowerCase() === adminEmail.toLowerCase();

  return (
    <div className={`rounded-xl border p-5 mt-4 ${isLight ? "border-[#C9A84C]/40 bg-gradient-to-b from-[#FCF7EA] to-[#F4E7C3]" : "border-primary/25 bg-gradient-to-b from-[#14100a] to-[#0d0a04]"}`}>
      <div className="flex items-center gap-2 mb-1">
        <ShieldCheck className="h-4 w-4 text-primary" />
        <p className="text-xs text-white/40 uppercase tracking-wider font-semibold">
          {t("admin.users.title")}
        </p>
      </div>
      <p className="text-sm text-white/60 mb-4">
        {t("admin.users.description")}
      </p>
      <div className="flex flex-wrap gap-2">
        <input
          type="email"
          placeholder={t("admin.users.emailPlaceholder")}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") void lookup(); }}
          disabled={looking}
          className="flex-1 min-w-[180px] rounded-xl bg-black/40 border border-white/10 px-3 py-2 text-sm text-white outline-none focus:border-white/25"
        />
        <Button onClick={() => { void lookup(); }} disabled={looking || !email.trim()} className="rounded-xl">
          {looking ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {t("admin.users.lookupButton")}
        </Button>
      </div>
      {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
      {searched && !found && !error && (
        <p className="mt-3 text-sm text-white/50">{t("admin.users.notFound")}</p>
      )}
      {found && (
        <div className="mt-4 rounded-xl border border-white/[0.08] bg-black/30 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-white truncate">
                {found.displayName ?? found.email}
              </p>
              <p className="text-xs text-white/50 truncate">{found.email}</p>
            </div>
            <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${found.banned ? "border-red-400/40 bg-red-400/10 text-red-300" : "border-emerald-400/40 bg-emerald-400/10 text-emerald-300"}`}>
              {found.banned ? t("admin.users.banned") : t("admin.users.active")}
            </span>
          </div>
          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4">
            <div><dt className="text-white/35">{t("admin.users.plan")}</dt><dd className="text-white/80">{found.plan ?? "—"}</dd></div>
            <div><dt className="text-white/35">{t("admin.users.credits")}</dt><dd className="text-white/80">{Number(found.credits).toLocaleString("en-US")}</dd></div>
            <div><dt className="text-white/35">{t("admin.users.since")}</dt><dd className="text-white/80">{found.createdAt ? new Date(found.createdAt).toLocaleDateString() : "—"}</dd></div>
            <div><dt className="text-white/35">{t("admin.users.userId")}</dt><dd className="text-white/80 truncate" title={found.id}>{found.id.slice(0, 8)}…</dd></div>
          </dl>
          {!isSelf && (
            <div className="mt-3">
              {found.banned ? (
                <Button size="sm" variant="outline" disabled={busy} onClick={() => { void setBan(false); }} className="rounded-xl text-xs">
                  {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : t("admin.users.unban")}
                </Button>
              ) : (
                <Button size="sm" disabled={busy} onClick={() => { void setBan(true); }} className="rounded-xl text-xs bg-red-600 hover:bg-red-500 text-white">
                  {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : t("admin.users.ban")}
                </Button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function AdminPage() {
  const isLight = useIsLightTheme();
  const { t } = useTranslation();
  usePageTitle(t("admin.pageTitle"), t("admin.pageDescription"));
  const { getAccessToken, profile, refreshProfile } = useAuth();
  const [checking, setChecking] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [amount, setAmount] = useState("500");
  const [granting, setGranting] = useState(false);
  const [friendEmail, setFriendEmail] = useState("");
  const [friendAmount, setFriendAmount] = useState("100");
  const [friendGranting, setFriendGranting] = useState(false);
  const [friendMessage, setFriendMessage] = useState<string | null>(null);
  const [friendError, setFriendError] = useState<string | null>(null);
  const [planEmail, setPlanEmail] = useState("");
  const [planTier, setPlanTier] = useState("1");
  const [planSaving, setPlanSaving] = useState(false);
  const [planMessage, setPlanMessage] = useState<string | null>(null);
  const [planError, setPlanError] = useState<string | null>(null);


  interface BowRaceStatus {
    period: string;
    target: number;
    totalBows: number;
    winnerUserId: string | null;
    winnerEmail: string | null;
    wonAt: string | null;
    raceOver: boolean;
  }
  interface BowRaceHistory {
    period: string;
    target: number;
    totalBows: number;
    winnerEmail: string | null;
    wonAt: string | null;
  }
  const [bowReward, setBowReward] = useState("50");
  const [bowEnabled, setBowEnabled] = useState(true);
  const [bowOverride, setBowOverride] = useState("");
  const [bowRace, setBowRace] = useState<BowRaceStatus | null>(null);
  const [bowHistory, setBowHistory] = useState<BowRaceHistory[]>([]);
  /* Bow Race load failures are NOT "no race yet" — they get their own
     error state with a retry, scoped to the Bow Race data only. The
     no-race empty state renders ONLY for a successful load with no
     race. bowMsg still carries save feedback and save failures. */
  const [bowLoading, setBowLoading] = useState(true);
  const [bowLoadError, setBowLoadError] = useState(false);
  const [bowRetryNonce, setBowRetryNonce] = useState(0);
  const [bowSaving, setBowSaving] = useState(false);
  const [bowMsg, setBowMsg] = useState<string | null>(null);
  const [bowTestPopup, setBowTestPopup] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const authHeaders = useCallback(async (): Promise<HeadersInit> => {
    const token = await getAccessToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  }, [getAccessToken]);

  const loadBowRace = useCallback(async () => {
    setBowLoading(true);
    setBowLoadError(false);
    try {
      const headers = await authHeaders();
      const res = await fetch("/api/admin/bow-challenge", { headers });
      if (!res.ok) {
        setBowLoadError(true);
        return;
      }
      const data = await res.json();
      setBowReward(String(data.rewardCredits));
      setBowEnabled(data.enabled);
      setBowOverride(data.targetOverride == null ? "" : String(data.targetOverride));
      setBowRace(data.race);
      setBowHistory(data.history ?? []);
      setBowMsg(null);
    } catch {
      setBowLoadError(true);
    } finally {
      setBowLoading(false);
    }
  }, [authHeaders]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (cancelled) return;
      await loadBowRace();
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bowRetryNonce]);

  const handleBowSave = useCallback(async () => {
    setBowSaving(true);
    setBowMsg(null);
    try {
      const headers = await authHeaders();
      const overrideRaw = bowOverride.trim();
      const res = await fetch("/api/admin/bow-challenge", {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify({
          rewardCredits: parseInt(bowReward, 10),
          enabled: bowEnabled,
          targetOverride: overrideRaw === "" ? null : parseInt(overrideRaw, 10),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || t("admin.errorSaveFailed"));
      await loadBowRace();
      setBowMsg(t("admin.bowRaceUpdated"));
    } catch (e) {
      setBowMsg(e instanceof Error ? e.message : t("admin.errorSaveFailed"));
    } finally {
      setBowSaving(false);
    }
  }, [authHeaders, loadBowRace, bowReward, bowEnabled, bowOverride]);


  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/admin/status", { headers: await authHeaders() });
        const data = (await res.json()) as { isAdmin?: boolean };
        if (!cancelled) setIsAdmin(res.ok && data.isAdmin === true);
      } catch {
        if (!cancelled) setIsAdmin(false);
      } finally {
        if (!cancelled) setChecking(false);
      }
    })();
    return () => { cancelled = true; };
  }, [authHeaders]);

  async function handleGrant() {
    const n = parseInt(amount, 10);
    if (!Number.isFinite(n) || n < 1 || n > 100000) {
      setError(t("admin.errorAmountRange"));
      return;
    }
    setGranting(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/credits/grant", {
        method: "POST",
        headers: { ...(await authHeaders()), "Content-Type": "application/json" },
        body: JSON.stringify({ amount: n }),
      });
      const data = (await res.json()) as { granted?: number; credits?: number; error?: string };
      if (!res.ok) throw new Error(data.error || t("admin.errorGrantFailed"));
      setMessage(t("admin.grantedMessage", { amount: data.granted, balance: data.credits }));
      await refreshProfile();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("admin.errorGrantFailed"));
    } finally {
      setGranting(false);
    }
  }

  async function handleFriendGrant() {
    const n = parseInt(friendAmount, 10);
    if (!Number.isFinite(n) || n < 1 || n > 100000) {
      setFriendError(t("admin.errorAmountRange"));
      return;
    }
    if (!friendEmail.trim()) {
      setFriendError(t("admin.errorFriendEmail"));
      return;
    }
    setFriendGranting(true);
    setFriendError(null);
    setFriendMessage(null);
    try {
      const res = await fetch("/api/admin/credits/grant", {
        method: "POST",
        headers: { ...(await authHeaders()), "Content-Type": "application/json" },
        body: JSON.stringify({ amount: n, email: friendEmail.trim() }),
      });
      const data = (await res.json()) as { granted?: number; credits?: number; error?: string };
      if (!res.ok) throw new Error(data.error || t("admin.errorGrantFailed"));
      setFriendMessage(t("admin.friendGrantedMessage", { amount: data.granted, email: friendEmail.trim(), balance: data.credits }));
      setFriendEmail("");
    } catch (e) {
      setFriendError(e instanceof Error ? e.message : t("admin.errorGrantFailed"));
    } finally {
      setFriendGranting(false);
    }
  }

  async function handlePlanSet() {
    const tierNum = parseInt(planTier, 10);
    if (!Number.isFinite(tierNum) || tierNum < 1 || tierNum > 6) {
      setPlanError(t("admin.errorTierRange"));
      return;
    }
    if (!planEmail.trim()) {
      setPlanError(t("admin.errorUserEmail"));
      return;
    }
    setPlanSaving(true);
    setPlanError(null);
    setPlanMessage(null);
    try {
      const res = await fetch("/api/admin/plan/set", {
        method: "POST",
        headers: { ...(await authHeaders()), "Content-Type": "application/json" },
        body: JSON.stringify({ tier: tierNum, email: planEmail.trim() }),
      });
      const data = (await res.json()) as { tier?: number; rank?: string; error?: string };
      if (!res.ok) throw new Error(data.error || t("admin.errorPlanSet"));
      setPlanMessage(t("admin.planSetMessage", { email: planEmail.trim(), rank: data.rank, tier: data.tier }));
      setPlanEmail("");
    } catch (e) {
      setPlanError(e instanceof Error ? e.message : t("admin.errorPlanSet"));
    } finally {
      setPlanSaving(false);
    }
  }

  return (
    <div className="min-h-screen bg-black text-white px-4 py-8 max-w-xl mx-auto">
      <div className="flex items-center gap-3 mb-1">
        <ShieldCheck className="h-6 w-6 text-primary" />
        <h1 className="text-2xl font-bold">{t("admin.pageTitle")}</h1>
      </div>
      <p className="text-sm text-white/50 mb-6">{t("admin.ownerOnly")}</p>





      {checking ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-white/40" />
        </div>
      ) : !isAdmin ? (
        <p className="text-sm text-white/40 py-8 text-center">{t("admin.notAuthorized")}</p>
      ) : (
        <>
          <div className={`rounded-xl border p-5 ${isLight ? "border-[#C9A84C]/40 bg-gradient-to-b from-[#FCF7EA] to-[#F4E7C3]" : "border-primary/25 bg-gradient-to-b from-[#14100a] to-[#0d0a04]"}`}>
            <div className="flex items-center gap-2 mb-1">
              <VisualBucsIcon className="h-4 w-4" />
              <p className="text-xs text-white/40 uppercase tracking-wider font-semibold">
                {t("admin.giveSelfTitle")}
              </p>
            </div>
            <p className="text-sm text-white/60 mb-4">
              {t("admin.currentBalance", { balance: profile?.credits?.toLocaleString("en-US") ?? "—" })}
            </p>
            <div className="flex gap-2">
              <input
                type="number"
                min={1}
                max={100000}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                disabled={granting}
                className="w-36 rounded-xl bg-black/40 border border-white/10 px-3 py-2 text-sm text-white outline-none focus:border-white/25"
              />
              <Button onClick={() => { void handleGrant(); }} disabled={granting} className="rounded-xl">
                {granting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {t("admin.grantButton")}
              </Button>
            </div>
            {message && <p className="mt-3 text-sm text-green-400">{message}</p>}
            {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
            <p className="mt-4 text-[11px] text-white/30">
              {t("admin.grantLogNote")}
            </p>
          </div>
          <div className={`rounded-xl border p-5 mt-4 ${isLight ? "border-[#C9A84C]/40 bg-gradient-to-b from-[#FCF7EA] to-[#F4E7C3]" : "border-primary/25 bg-gradient-to-b from-[#14100a] to-[#0d0a04]"}`}>
            <div className="flex items-center gap-2 mb-1">
              <Users className="h-4 w-4 text-primary" />
              <p className="text-xs text-white/40 uppercase tracking-wider font-semibold">
                {t("admin.giveFriendTitle")}
              </p>
            </div>
            <p className="text-sm text-white/60 mb-4">
              {t("admin.giveFriendDescription")}
            </p>
            <div className="flex flex-wrap gap-2">
              <input
                type="email"
                placeholder={t("admin.friendEmailPlaceholder")}
                value={friendEmail}
                onChange={(e) => setFriendEmail(e.target.value)}
                disabled={friendGranting}
                className="flex-1 min-w-[180px] rounded-xl bg-black/40 border border-white/10 px-3 py-2 text-sm text-white outline-none focus:border-white/25"
              />
              <input
                type="number"
                min={1}
                max={100000}
                value={friendAmount}
                onChange={(e) => setFriendAmount(e.target.value)}
                disabled={friendGranting}
                className="w-28 rounded-xl bg-black/40 border border-white/10 px-3 py-2 text-sm text-white outline-none focus:border-white/25"
              />
              <Button onClick={() => { void handleFriendGrant(); }} disabled={friendGranting} className="rounded-xl">
                {friendGranting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {t("admin.sendButton")}
              </Button>
            </div>
            {friendMessage && <p className="mt-3 text-sm text-green-400">{friendMessage}</p>}
            {friendError && <p className="mt-3 text-sm text-red-400">{friendError}</p>}
          </div>
          <div className={`rounded-xl border p-5 mt-4 ${isLight ? "border-[#C9A84C]/40 bg-gradient-to-b from-[#FCF7EA] to-[#F4E7C3]" : "border-primary/25 bg-gradient-to-b from-[#14100a] to-[#0d0a04]"}`}>
            <div className="flex items-center gap-2 mb-1">
              <Star className="h-4 w-4 text-primary" />
              <p className="text-xs text-white/40 uppercase tracking-wider font-semibold">
                {t("admin.planTitle")}
              </p>
            </div>
            <p className="text-sm text-white/60 mb-4">
              {t("admin.planDescription")}
            </p>
            <div className="flex flex-wrap gap-2">
              <input
                type="email"
                placeholder={t("admin.planEmailPlaceholder")}
                value={planEmail}
                onChange={(e) => setPlanEmail(e.target.value)}
                disabled={planSaving}
                className="flex-1 min-w-[180px] rounded-xl bg-black/40 border border-white/10 px-3 py-2 text-sm text-white outline-none focus:border-white/25"
              />
              <select
                value={planTier}
                onChange={(e) => setPlanTier(e.target.value)}
                disabled={planSaving}
                className="rounded-xl bg-black/40 border border-white/10 px-3 py-2 text-sm text-white outline-none focus:border-white/25"
              >
                <option value="1">1 — {t("admin.tiers.tier1")}</option>
                <option value="2">2 — {t("admin.tiers.tier2")}</option>
                <option value="3">3 — {t("admin.tiers.tier3")}</option>
                <option value="4">4 — {t("admin.tiers.tier4")}</option>
                <option value="5">5 — {t("admin.tiers.tier5")}</option>
                <option value="6">6 — {t("admin.tiers.tier6")}</option>
              </select>
              <Button onClick={() => { void handlePlanSet(); }} disabled={planSaving} className="rounded-xl">
                {planSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {t("admin.setTierButton")}
              </Button>
            </div>
            {planMessage && <p className="mt-3 text-sm text-green-400">{planMessage}</p>}
            {planError && <p className="mt-3 text-sm text-red-400">{planError}</p>}
          </div>
          <div className={`rounded-xl border p-5 ${isLight ? "border-[#C9A84C]/40 bg-gradient-to-b from-[#FCF7EA] to-[#F4E7C3]" : "border-primary/25 bg-gradient-to-b from-[#14100a] to-[#0d0a04]"}`}>
            <div className="flex items-center gap-2 mb-1">
              <Crown className="h-4 w-4 text-primary" />
              <p className="text-xs text-white/40 uppercase tracking-wider font-semibold">
                {t("admin.bowRaceTitle")}
              </p>
            </div>
            <p className="text-sm text-white/60 mb-4">
              {t("admin.bowRaceDescription")}
            </p>
            {bowLoading ? (
              <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-white/40" /></div>
            ) : bowLoadError ? (
              <div className={`mb-4 rounded-2xl border p-10 text-center ${isLight ? "border-[#C9A84C]/50 bg-[#F7ECD2]" : "border-primary/25 bg-zinc-950"}`}>
                <AlertTriangle className="mx-auto h-10 w-10 text-primary" />
                <p className={`mt-3 font-bold ${isLight ? "text-[#2A1E07]" : "text-white"}`}>Couldn't load the Bow Race.</p>
                <p className={`mt-1 text-sm ${isLight ? "text-[#6B5B36]" : "text-white/50"}`}>
                  Something went wrong on our end — the race is safe, this panel just couldn't load its status.
                </p>
                <button
                  type="button"
                  onClick={() => setBowRetryNonce((n) => n + 1)}
                  className="mt-4 inline-flex items-center gap-2 rounded-full bg-primary px-6 py-2.5 font-bold text-black hover:brightness-110"
                >
                  <RotateCcw className="h-4 w-4" /> Try again
                </button>
              </div>
            ) : (
              <>
                {bowRace?.raceOver && bowRace.winnerEmail && (
                  <div className="mb-4 rounded-xl border border-[#C9A84C]/60 bg-[#C9A84C]/10 px-4 py-3">
                    <div className="flex items-center gap-2">
                      <Trophy className="h-5 w-5 text-[#e8c86a]" />
                      <p className="text-sm font-semibold text-[#e8c86a]">
                        {t("admin.raceWon", { period: bowRace.period })}
                      </p>
                    </div>
                    <p className="mt-1 text-sm text-white/80">
                      {t("admin.raceWonDetail", { email: bowRace.winnerEmail, target: bowRace.target.toLocaleString(), wonAt: bowRace.wonAt ? ` ${new Date(bowRace.wonAt).toLocaleString()}` : "" })}
                    </p>
                  </div>
                )}
                {bowRace && !bowRace.raceOver && (
                  <p className="mb-4 text-sm text-white/60">
                    {t("admin.currentRacePrefix")} <span className="text-white/90 font-semibold">{bowRace.period}</span>:
                    {" "}<span className="text-white/90 font-semibold">{bowRace.totalBows.toLocaleString()}</span>
                    {" "}{t("admin.bowsSoFar")} — {t("admin.targetLabel")}{" "}
                    <span className="text-white/90 font-semibold">{bowRace.target.toLocaleString()}</span>.
                    {t("admin.noWinnerYet")}
                  </p>
                )}
                {!bowRace && (
                  <p className="mb-4 text-sm text-white/40">
                    {t("admin.noRaceYet")}
                  </p>
                )}
              </>
            )}
            <div className="flex flex-wrap items-end gap-3">
              <label className="text-xs text-white/40">
                {t("admin.bowRewardLabel")}
                <input
                  type="number" min={1} max={10000}
                  value={bowReward}
                  onChange={(e) => setBowReward(e.target.value)}
                  disabled={bowSaving}
                  className="mt-1 block w-32 rounded-xl bg-black/40 border border-white/10 px-3 py-2 text-sm text-white outline-none focus:border-white/25"
                />
              </label>
              <label className="text-xs text-white/40">
                {t("admin.targetOverrideLabel")}
                <input
                  type="number" min={1000} max={5000}
                  placeholder={t("admin.randomPlaceholder")}
                  value={bowOverride}
                  onChange={(e) => setBowOverride(e.target.value)}
                  disabled={bowSaving}
                  className="mt-1 block w-40 rounded-xl bg-black/40 border border-white/10 px-3 py-2 text-sm text-white outline-none focus:border-white/25"
                />
              </label>
              <label className="flex items-center gap-2 text-xs text-white/40 pb-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={bowEnabled}
                  onChange={(e) => setBowEnabled(e.target.checked)}
                  disabled={bowSaving}
                  className="h-4 w-4 accent-[#C9A84C]"
                />
                {t("admin.enabledLabel")}
              </label>
              <Button onClick={() => { void handleBowSave(); }} disabled={bowSaving} className="rounded-xl">
                {bowSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {t("admin.saveButton")}
              </Button>
              <Button
                variant="outline"
                onClick={() => setBowTestPopup(true)}
                className="rounded-xl"
                title={t("admin.testPopupTitle")}
              >
                {t("admin.testPopupButton")}
              </Button>
            </div>
            {bowMsg && <p className="mt-3 text-sm text-green-400">{bowMsg}</p>}
            <p className="mt-4 text-[11px] text-white/30">
              {t("admin.bowRaceFooterNote")}
            </p>
            {!bowLoadError && bowHistory.length > 0 && (
              <div className="mt-4">
                <p className="text-xs text-white/40 uppercase tracking-wider font-semibold mb-2">
                  {t("admin.winHistory")}
                </p>
                <div className="overflow-x-auto rounded-xl border border-white/[0.06]">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-white/[0.03] text-left text-xs text-white/40">
                        <th className="px-3 py-2 font-semibold">{t("admin.tableMonth")}</th>
                        <th className="px-3 py-2 font-semibold">{t("admin.tableTarget")}</th>
                        <th className="px-3 py-2 font-semibold">{t("admin.tableWinner")}</th>
                        <th className="px-3 py-2 font-semibold">{t("admin.tableWonAt")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {bowHistory.map((h) => (
                        <tr key={h.period} className="border-t border-white/[0.06] text-white/70">
                          <td className="px-3 py-2">{h.period}</td>
                          <td className="px-3 py-2">{h.target.toLocaleString()}</td>
                          <td className="px-3 py-2">{h.winnerEmail ?? "—"}</td>
                          <td className="px-3 py-2">
                            {h.wonAt ? new Date(h.wonAt).toLocaleString() : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
            {/* Test-only preview of the winner popup: purely client-side,
                grants nothing and touches no race state. */}
            {bowTestPopup && (
              <SecretChallengePopup
                credits={parseInt(bowReward, 10) || 50}
                onClaim={() => setBowTestPopup(false)}
              />
            )}
          </div>
          <JackpotAdmin authHeaders={authHeaders} />
          <SpotlightInbox authHeaders={authHeaders} />
          <ContactInbox authHeaders={authHeaders} />
          <DmcaReportsInbox authHeaders={authHeaders} />
          <PitchFixInbox authHeaders={authHeaders} />
          <ContentReportsInbox authHeaders={authHeaders} />
          <ContentRemovalPanel authHeaders={authHeaders} />
          <UserManagement authHeaders={authHeaders} adminEmail={profile?.email ?? null} />
          <NfcOrdersAdmin authHeaders={authHeaders} />
          <JewelryOrdersAdmin authHeaders={authHeaders} />
        </>
      )}
    </div>
  );
}
