import { apiErrorMessage } from "../../lib/api-error";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { Loader2, Music2, Play, SkipForward, XCircle, ListMusic, CircleDollarSign } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useIsLightTheme } from "@/hooks/use-is-light-theme";
import { formatBucs } from "@/lib/visual-bucs";
import {
  upfrontRuleLines,
  requestStatusLabel,
  type RequestRulesDto,
  type CatalogSongDto,
  type SongRequestDto,
  type QueuePayload,
} from "@/lib/song-requests";

/* ─── Song Requests, Live (Stack-200 N18) ────────────────────────────────
   Two docked surfaces over /api/live/:id/song-requests — no standalone
   page:
   · SongRequestPanel — the fan surface, docked into the live-watch
     page. The creator's rules and the refund deal are printed UP FRONT,
     before anyone tips (the server sends both; this renders them).
   · SongRequestDesk — the creator's queue desk, docked into the
     go-live broadcast tab: rules are set here BEFORE the stream
     (persisted per creator), and while live the same desk runs the
     queue (play-next / skip / close). The Stage Manager (#166) will
     run this same queue through the same service later.
   Both themes are designed experiences, following the live surfaces'
   gold-on-black / gold-on-cream tokens. */

function shell(isLight: boolean) {
  return isLight
    ? "rounded-2xl border border-[#C9A84C]/40 bg-[#F7ECD2]/70 text-[#2A1E07]"
    : "rounded-2xl border border-[#C9A84C]/25 bg-white/[0.03] text-white";
}
function subText(isLight: boolean) {
  return isLight ? "text-[#6B5B36]" : "text-white/50";
}
function goldBtn(disabled: boolean) {
  return `inline-flex items-center gap-2 rounded-full bg-amber-400 px-5 py-2 text-sm font-bold text-black transition hover:scale-105 disabled:cursor-not-allowed disabled:opacity-50 ${disabled ? "" : ""}`;
}

function QueueList({
  queue,
  myUserId,
  isLight,
  onSkip,
  skippingId,
}: {
  queue: SongRequestDto[];
  myUserId?: string | null;
  isLight: boolean;
  onSkip?: (r: SongRequestDto) => void;
  skippingId?: string | null;
}) {
  if (queue.length === 0) {
    return <p className={`text-sm ${subText(isLight)}`}>No requests yet. The line is empty.</p>;
  }
  return (
    <ol className="space-y-2" data-testid="song-request-queue">
      {queue.map((r) => {
        const mine = !!myUserId && r.fanUserId === myUserId;
        return (
          <li
            key={r.id}
            className={`flex items-center gap-3 rounded-xl border px-3 py-2 ${
              r.status === "playing"
                ? isLight
                  ? "border-[#C9A84C]/60 bg-[#C9A84C]/15"
                  : "border-[#C9A84C]/50 bg-[#C9A84C]/10"
                : isLight
                  ? "border-[#C9A84C]/25 bg-white/40"
                  : "border-white/10 bg-black/30"
            }`}
            data-testid="song-request-row"
          >
            <Music2 className={`h-4 w-4 shrink-0 ${r.status === "playing" ? "text-amber-500" : "opacity-40"}`} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-bold">
                {r.songTitle}
                {mine && <span className="ml-2 text-xs font-black uppercase tracking-wider text-amber-500">Yours</span>}
              </span>
              <span className={`block text-xs ${subText(isLight)}`}>
                Requested by {r.fan.displayName} · {formatBucs(r.amountVb)} tip
              </span>
            </span>
            <span
              className={`shrink-0 text-xs font-bold ${r.status === "playing" ? "text-amber-500" : subText(isLight)}`}
            >
              {requestStatusLabel(r)}
            </span>
            {onSkip && r.status === "queued" && (
              <button
                type="button"
                onClick={() => onSkip(r)}
                disabled={skippingId === r.id}
                className={`shrink-0 inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-bold transition disabled:opacity-50 ${
                  isLight ? "border-[#C9A84C]/40 hover:bg-[#C9A84C]/10" : "border-white/15 hover:bg-white/10"
                }`}
                data-testid="song-request-skip"
              >
                {skippingId === r.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <XCircle className="h-3.5 w-3.5" />}
                Skip · refund
              </button>
            )}
          </li>
        );
      })}
    </ol>
  );
}

/* ── The fan surface (live-watch) ─────────────────────────────────────── */
export function SongRequestPanel({ streamId, isLive }: { streamId: string; isLive: boolean }) {
  const isLight = useIsLightTheme();
  const { user, getAccessToken } = useAuth();
  const tokenFnRef = useRef(getAccessToken);
  tokenFnRef.current = getAccessToken;
  const [data, setData] = useState<QueuePayload | null>(null);
  const [songId, setSongId] = useState("");
  const [amount, setAmount] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const intentKeyRef = useRef("");

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/live/${streamId}/song-requests`);
      if (!res.ok) return;
      const d = (await res.json()) as QueuePayload;
      setData(d);
    } catch {
      /* the next poll retries */
    }
  }, [streamId]);

  useEffect(() => {
    void load();
    if (!isLive) return;
    const t = setInterval(load, 10_000);
    return () => clearInterval(t);
  }, [load, isLive]);

  if (!data) return null;
  if (!data.available) {
    return (
      <section className={`mt-5 p-4 ${shell(isLight)}`} data-testid="song-requests-panel">
        <h2 className="flex items-center gap-2 text-sm font-black uppercase tracking-wider">
          <ListMusic className="h-4 w-4 text-amber-500" /> Song requests
        </h2>
        <p className={`mt-1 text-sm ${subText(isLight)}`}>Song requests aren't switched on yet.</p>
      </section>
    );
  }

  const requestable = data.catalog.filter((s) => !s.excluded);
  const amountNum = Number(amount);
  const amountValid = Number.isInteger(amountNum) && amountNum >= data.tipBounds.minVb && amountNum <= data.tipBounds.maxVb;
  const canSubmit = isLive && data.rules.requestsOpen && !!songId && amountValid && !submitting;

  async function submit() {
    if (!user || !canSubmit) return;
    setSubmitting(true);
    setError(null);
    setNote(null);
    try {
      if (!intentKeyRef.current) {
        intentKeyRef.current =
          typeof crypto !== "undefined" && "randomUUID" in crypto
            ? crypto.randomUUID()
            : `song-request-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      }
      const token = await tokenFnRef.current().catch(() => null);
      const res = await fetch(`/api/live/${streamId}/song-requests`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ songId, amountVb: amountNum, idempotencyKey: intentKeyRef.current }),
      });
      const d = (await res.json().catch(() => null)) as { error?: string; request?: SongRequestDto } | null;
      if (!res.ok) {
        setError(apiErrorMessage(d, "That request didn't go through. Try again."));
        return;
      }
      intentKeyRef.current = "";
      setNote(
        d?.request?.position
          ? `You're in line — #${d.request.position} for “${d.request.songTitle}”.`
          : "Your request is in the queue.",
      );
      setAmount("");
      await load();
    } catch {
      setError("That request didn't go through. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className={`mt-5 p-4 ${shell(isLight)}`} data-testid="song-requests-panel">
      <h2 className="flex items-center gap-2 text-sm font-black uppercase tracking-wider">
        <ListMusic className="h-4 w-4 text-amber-500" /> Song requests
      </h2>

      {/* The rules + the refund deal, up front — before anyone tips. */}
      <div
        className={`mt-3 rounded-xl border px-3 py-2.5 text-xs leading-relaxed ${
          isLight ? "border-[#C9A84C]/30 bg-white/50" : "border-white/10 bg-black/30"
        }`}
        data-testid="song-request-rules-upfront"
      >
        {data.rules.requestsOpen ? (
          <>
            {upfrontRuleLines(data.rules, data.tipBounds).map((line) => (
              <p key={line}>{line}</p>
            ))}
            <p className="mt-1 font-semibold">{data.refundCopy}</p>
          </>
        ) : (
          <p>Song requests are closed for this stream — the creator has them off.</p>
        )}
      </div>

      <div className="mt-3">
        <QueueList queue={data.queue} myUserId={user?.id ?? null} isLight={isLight} />
      </div>

      {isLive && data.rules.requestsOpen && (
        <div className="mt-4" data-testid="song-request-form">
          {data.catalog.length === 0 ? (
            <p className={`text-sm ${subText(isLight)}`}>
              This creator hasn't added songs to their catalog yet — there's nothing to request yet.
            </p>
          ) : requestable.length === 0 ? (
            <p className={`text-sm ${subText(isLight)}`}>Every catalog song is out of requests for this stream.</p>
          ) : !user ? (
            <p className={`text-sm ${subText(isLight)}`}>
              <Link href="/login" className="font-bold text-amber-500 underline">
                Sign in
              </Link>{" "}
              to request a song — requests are for signed-in fans.
            </p>
          ) : (
            <div className="flex flex-wrap items-end gap-2">
              <label className="min-w-[200px] flex-1">
                <span className={`mb-1 block text-xs font-bold uppercase tracking-wider ${subText(isLight)}`}>Song</span>
                <select
                  value={songId}
                  onChange={(e) => setSongId(e.target.value)}
                  className={`w-full rounded-xl border px-3 py-2 text-sm ${
                    isLight ? "border-[#C9A84C]/40 bg-white/70 text-[#2A1E07]" : "border-white/15 bg-black/50 text-white"
                  }`}
                  data-testid="song-request-song"
                >
                  <option value="">Pick a song…</option>
                  {data.catalog.map((s) => (
                    <option key={s.id} value={s.id} disabled={s.excluded}>
                      {s.title}
                      {s.excluded ? " — not requestable" : ""}
                    </option>
                  ))}
                </select>
              </label>
              <label className="w-36">
                <span className={`mb-1 block text-xs font-bold uppercase tracking-wider ${subText(isLight)}`}>
                  Tip (VB)
                </span>
                <input
                  value={amount}
                  onChange={(e) => setAmount(e.target.value.replace(/[^0-9]/g, ""))}
                  inputMode="numeric"
                  placeholder={
                    data.rules.minTipVb !== null
                      ? `Min ${data.rules.minTipVb.toLocaleString("en-US")}`
                      : `From ${data.tipBounds.minVb.toLocaleString("en-US")}`
                  }
                  className={`w-full rounded-xl border px-3 py-2 text-sm ${
                    isLight ? "border-[#C9A84C]/40 bg-white/70 text-[#2A1E07]" : "border-white/15 bg-black/50 text-white"
                  }`}
                  data-testid="song-request-amount"
                />
              </label>
              <button
                type="button"
                onClick={() => void submit()}
                disabled={!canSubmit}
                className={goldBtn(!canSubmit)}
                data-testid="song-request-submit"
              >
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <CircleDollarSign className="h-4 w-4" />}
                Request it
              </button>
            </div>
          )}
          {note && (
            <p className="mt-2 text-xs font-semibold text-emerald-500" role="status" data-testid="song-request-note">
              {note}
            </p>
          )}
          {error && (
            <p className="mt-2 text-xs font-semibold text-red-400" role="alert">
              {error}
            </p>
          )}
        </div>
      )}
    </section>
  );
}

/* ── The creator's queue desk (go-live broadcast tab) ─────────────────── */
interface RulesPayload {
  available: boolean;
  rules: RequestRulesDto;
  refundCopy: string;
  tipBounds: { minVb: number; maxVb: number };
  catalog: CatalogSongDto[];
  liveStreamId: string | null;
}

export function SongRequestDesk() {
  const isLight = useIsLightTheme();
  const { user, getAccessToken } = useAuth();
  const tokenFnRef = useRef(getAccessToken);
  tokenFnRef.current = getAccessToken;
  const [payload, setPayload] = useState<RulesPayload | null>(null);
  const [queueData, setQueueData] = useState<QueuePayload | null>(null);
  const [open, setOpen] = useState(true);
  const [catalogOnly, setCatalogOnly] = useState(true);
  const [minTip, setMinTip] = useState("");
  const [excluded, setExcluded] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [savedNote, setSavedNote] = useState<string | null>(null);
  const [deskError, setDeskError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [skippingId, setSkippingId] = useState<string | null>(null);

  const authed = useCallback(async (): Promise<Record<string, string>> => {
    const token = await tokenFnRef.current().catch(() => null);
    return token ? { Authorization: `Bearer ${token}` } : {};
  }, []);

  const loadRules = useCallback(async () => {
    try {
      const headers = await authed();
      const res = await fetch("/api/song-request-rules", { headers });
      if (!res.ok) return;
      const d = (await res.json()) as RulesPayload;
      setPayload(d);
      setOpen(d.rules.requestsOpen);
      setCatalogOnly(d.rules.catalogOnly);
      setMinTip(d.rules.minTipVb !== null ? String(d.rules.minTipVb) : "");
      setExcluded(d.rules.excludedSongIds);
    } catch {
      /* best-effort load; saving reports its own errors */
    }
  }, [authed]);

  const liveStreamId = payload?.liveStreamId ?? null;
  const loadQueue = useCallback(async () => {
    if (!liveStreamId) return;
    try {
      const res = await fetch(`/api/live/${liveStreamId}/song-requests`);
      if (!res.ok) return;
      setQueueData((await res.json()) as QueuePayload);
    } catch {
      /* the next poll retries */
    }
  }, [liveStreamId]);

  useEffect(() => {
    void loadRules();
  }, [loadRules]);
  useEffect(() => {
    void loadQueue();
    if (!liveStreamId) return;
    const t = setInterval(loadQueue, 8_000);
    return () => clearInterval(t);
  }, [loadQueue, liveStreamId]);

  if (!user || !payload) return null;

  async function saveRules() {
    setSaving(true);
    setSavedNote(null);
    setDeskError(null);
    try {
      const headers = await authed();
      const minTipNum = minTip.trim() === "" ? null : Number(minTip);
      const res = await fetch("/api/song-request-rules", {
        method: "PUT",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({
          requestsOpen: open,
          catalogOnly,
          excludedSongIds: excluded,
          minTipVb: minTipNum,
        }),
      });
      const d = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) {
        setDeskError(apiErrorMessage(d, "Your rules couldn't be saved. Try again."));
        return;
      }
      setSavedNote("Rules saved — fans see them up front on the request panel.");
      await loadRules();
    } catch {
      setDeskError("Your rules couldn't be saved. Try again.");
    } finally {
      setSaving(false);
    }
  }

  async function queueAction(path: string, key: string) {
    if (!liveStreamId) return;
    setBusy(key);
    setDeskError(null);
    try {
      const headers = await authed();
      const res = await fetch(`/api/live/${liveStreamId}/song-requests/${path}`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const d = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) setDeskError(apiErrorMessage(d, "That didn't go through. Try again."));
      await loadQueue();
    } catch {
      setDeskError("That didn't go through. Try again.");
    } finally {
      setBusy(null);
    }
  }

  async function skip(r: SongRequestDto) {
    if (!liveStreamId) return;
    setSkippingId(r.id);
    try {
      const headers = await authed();
      const res = await fetch(`/api/live/${liveStreamId}/song-requests/${r.id}/skip`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const d = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) setDeskError(apiErrorMessage(d, "That skip didn't go through. Try again."));
      await loadQueue();
    } catch {
      setDeskError("That skip didn't go through. Try again.");
    } finally {
      setSkippingId(null);
    }
  }

  const toggleExcluded = (id: string) =>
    setExcluded((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  return (
    <section className={`mx-auto mt-6 w-full max-w-5xl p-5 ${shell(isLight)}`} data-testid="song-request-desk">
      <h2 className="flex items-center gap-2 text-base font-black tracking-wide">
        <ListMusic className="h-5 w-5 text-amber-500" /> Song Requests — your queue desk
      </h2>
      <p className={`mt-1 text-sm ${subText(isLight)}`}>
        Set your rules before you go live — fans see them, and the refund deal, up front before anyone tips.{" "}
        {payload.refundCopy}
      </p>
      {!payload.available && (
        <p className="mt-2 text-sm font-semibold text-amber-500">Song requests aren't switched on yet — your rules will save once the queue is live.</p>
      )}

      {/* Rules — set before the stream, editable between streams. */}
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <label className="flex items-center gap-2.5 text-sm font-semibold select-none">
          <input type="checkbox" checked={open} onChange={(e) => setOpen(e.target.checked)} className="h-4 w-4 accent-amber-400" data-testid="rules-open" />
          Requests open
        </label>
        <label className="flex items-center gap-2.5 text-sm font-semibold select-none">
          <input type="checkbox" checked={catalogOnly} onChange={(e) => setCatalogOnly(e.target.checked)} className="h-4 w-4 accent-amber-400" data-testid="rules-catalog-only" />
          Catalog only — requests must be my own songs
        </label>
        <label className="block">
          <span className={`mb-1 block text-xs font-bold uppercase tracking-wider ${subText(isLight)}`}>
            Minimum tip (VB) — yours to set, blank = none
          </span>
          <input
            value={minTip}
            onChange={(e) => setMinTip(e.target.value.replace(/[^0-9]/g, ""))}
            inputMode="numeric"
            placeholder="No minimum"
            className={`w-full rounded-xl border px-3 py-2 text-sm ${
              isLight ? "border-[#C9A84C]/40 bg-white/70 text-[#2A1E07]" : "border-white/15 bg-black/50 text-white"
            }`}
            data-testid="rules-min-tip"
          />
        </label>
      </div>

      {payload.catalog.length > 0 ? (
        <fieldset className="mt-4">
          <legend className={`text-xs font-bold uppercase tracking-wider ${subText(isLight)}`}>
            Take songs out of requests
          </legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {payload.catalog.map((s) => (
              <label
                key={s.id}
                className={`inline-flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold select-none ${
                  excluded.includes(s.id)
                    ? isLight
                      ? "border-red-400/50 bg-red-500/10 text-red-700"
                      : "border-red-400/40 bg-red-500/10 text-red-200"
                    : isLight
                      ? "border-[#C9A84C]/30 bg-white/40"
                      : "border-white/10 bg-black/30"
                }`}
              >
                <input
                  type="checkbox"
                  checked={excluded.includes(s.id)}
                  onChange={() => toggleExcluded(s.id)}
                  className="h-3.5 w-3.5 accent-red-400"
                />
                {s.title}
                {excluded.includes(s.id) ? " · out" : ""}
              </label>
            ))}
          </div>
        </fieldset>
      ) : (
        <p className={`mt-4 text-sm ${subText(isLight)}`}>
          You have no songs in your catalog yet — once you add songs, fans can request them here.
        </p>
      )}

      <div className="mt-4 flex items-center gap-3">
        <button type="button" onClick={() => void saveRules()} disabled={saving} className={goldBtn(saving)} data-testid="rules-save">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Save rules
        </button>
        {savedNote && (
          <span className="text-xs font-semibold text-emerald-500" role="status">
            {savedNote}
          </span>
        )}
      </div>

      {/* The live queue controls — only while this creator is live. */}
      {liveStreamId ? (
        <div className="mt-6 border-t border-[#C9A84C]/20 pt-4" data-testid="song-request-live-controls">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="mr-auto text-sm font-black uppercase tracking-wider">Live queue</h3>
            <button
              type="button"
              onClick={() => void queueAction("play-next", "play")}
              disabled={busy === "play"}
              className={goldBtn(busy === "play")}
              data-testid="queue-play-next"
            >
              {busy === "play" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              Play next
            </button>
            <button
              type="button"
              onClick={() => void queueAction("close", "close")}
              disabled={busy === "close"}
              className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-bold transition disabled:opacity-50 ${
                isLight ? "border-[#C9A84C]/40 hover:bg-[#C9A84C]/10" : "border-white/15 hover:bg-white/10"
              }`}
              data-testid="queue-close"
            >
              {busy === "close" ? <Loader2 className="h-4 w-4 animate-spin" /> : <SkipForward className="h-4 w-4" />}
              Close queue · refund the line
            </button>
          </div>
          <div className="mt-3">
            <QueueList queue={queueData?.queue ?? []} isLight={isLight} onSkip={(r) => void skip(r)} skippingId={skippingId} />
          </div>
        </div>
      ) : (
        <p className={`mt-6 border-t border-[#C9A84C]/20 pt-4 text-sm ${subText(isLight)}`}>
          You're not live right now — your queue controls appear here while you stream. Ending a stream automatically
          refunds every request that never played.
        </p>
      )}
      {deskError && (
        <p className="mt-3 text-xs font-semibold text-red-400" role="alert">
          {deskError}
        </p>
      )}
    </section>
  );
}
